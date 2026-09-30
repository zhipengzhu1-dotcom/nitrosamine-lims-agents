-- Ledgers, the audit context, the capture and blocking triggers, and the hash chains.
-- Everything here is owned by lims_owner. The functions that write audit rows are SECURITY
-- DEFINER and are never granted to lims_app, so the app can cause audit entries only by writing
-- business rows through a table's capture trigger.

-- A ledger is the company or one Lab. Each ledger has exactly one audit chain. A Lab's id is
-- its ledger id, so lab_id and ledger_id columns hold the same values and composite foreign
-- keys line up. Company tables never carry a lab_id (ADR 0002).
create table lims.ledger (
  id   uuid primary key,
  kind text not null check (kind in ('company', 'lab')),
  code text not null unique
);
create unique index one_company_ledger on lims.ledger ((kind)) where kind = 'company';
insert into lims.ledger values ('00000000-0000-4000-8000-000000000001', 'company', 'CO');

create function lims.company_ledger() returns uuid
language sql stable as $$ select id from lims.ledger where kind = 'company' $$;

create table lims.lab (
  id        uuid primary key references lims.ledger (id),
  code      text not null unique,
  iana_zone text not null
);

create table lims.audit_chain_head (
  ledger_id uuid primary key references lims.ledger (id),
  head_seq  bigint not null default 0,
  head_hash bytea  not null default '\x00'::bytea
);
insert into lims.audit_chain_head (ledger_id) values (lims.company_ledger());

-- Each app release identifies itself here before its first audited write. The row is not
-- audited: it is the referent every audit entry and signature names, and the trail of a release
-- is the deploy log, not the database.
create table lims.release (
  id           text primary key,
  image_digest text,
  deployed_at  timestamptz not null default clock_timestamp()
);

-- entry_bytes is the canonical text that was hashed. Verification hashes the stored bytes and
-- never re-serialises the columns. The decomposed columns exist for search and the inline panel.
create table lims.audit_entry (
  ledger_id     uuid        not null references lims.ledger (id),
  seq           bigint      not null,
  at            timestamptz not null,
  person_id     uuid        not null,
  role          text        not null,
  acting_lab_id uuid,
  customer_id   uuid,
  action        text        not null,
  reason_code   text        not null,
  reason_text   text,
  table_name    text        not null,
  row_pk        text        not null,
  record_id     uuid,
  op            text        not null check (op in ('insert', 'update')),
  changes       jsonb       not null,
  app_release   text        not null references lims.release (id),
  session_id    uuid,
  commit_key    uuid,
  prev_hash     bytea       not null,
  entry_bytes   bytea       not null,
  entry_hash    bytea       not null generated always as (sha256(entry_bytes)) stored,
  primary key (ledger_id, seq)
);

-- The audit context: one GUC, lims.ctx, set once per audited transaction by runAudited(). Every
-- trigger validates it on every row, because lims_app could set the GUC by hand. The checks are
-- the ones the design lists as LA001 to LA004, plus the actor assertion: a person acts only
-- through a live session of their own, in the Lab or for the Customer the session was opened for.
create function lims.require_context() returns jsonb
language plpgsql volatile security definer set search_path = lims, pg_temp as $$
declare
  ctx      jsonb := nullif(current_setting('lims.ctx', true), '')::jsonb;
  v_person   uuid;
  v_role     text;
  v_lab      uuid;
  v_customer uuid;
  v_sess     uuid;
begin
  if ctx is null then
    raise exception 'audited write without an audit context' using errcode = 'LA001';
  end if;
  if ctx->>'person_id' is null or ctx->>'role' is null or ctx->>'action' is null
     or ctx->>'reason_code' is null or ctx->>'app_release' is null
     or jsonb_typeof(ctx->'ledgers') <> 'array' then
    raise exception 'audit context missing person, role, action, reason, release or ledgers' using errcode = 'LA002';
  end if;
  if ctx->>'reason_code' = 'other' and coalesce(ctx->>'reason_text', '') = '' then
    raise exception 'reason "Other" needs free text' using errcode = 'LA003';
  end if;
  v_person   := (ctx->>'person_id')::uuid;
  v_role     := ctx->>'role';
  v_lab      := (ctx->>'acting_lab_id')::uuid;
  v_customer := (ctx->>'customer_id')::uuid;
  v_sess     := (ctx->>'session_id')::uuid;
  if not exists (
    select 1 from lims.role_grant g
     where g.person_id = v_person and g.role = v_role and g.revoked_at is null
       and (g.role like 'svc:%' or g.role = 'Admin' or g.lab_id = v_lab or g.customer_id = v_customer)
  ) then
    raise exception 'person does not hold role % in the acting Lab', v_role using errcode = 'LA004';
  end if;
  if v_role not like 'svc:%' and not exists (
    select 1 from lims.session s
      left join lims.session_activity a on a.session_id = s.id
     where s.id = v_sess and s.person_id = v_person
       and s.acting_lab_id is not distinct from v_lab
       and s.customer_id is not distinct from v_customer
       and lims.session_state(s, coalesce(a.last_activity_at, s.started_at), now()) = 'active'
  ) then
    raise exception 'no live session of this person in the acting Lab' using errcode = 'LA009';
  end if;
  return ctx;
end $$;

-- Pre-locks the chain heads the context declares, in ledger-id order, and returns the database
-- clock read under the locks. Called once at the start of every audited transaction, so two
-- audited transactions can never deadlock on chains, and chain order and time order agree.
create function lims.lock_chains() returns timestamptz
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  declared uuid[] := (select array_agg(distinct x::uuid) from jsonb_array_elements_text(lims.require_context()->'ledgers') x);
  locked   int := 0;
  r        record;
begin
  for r in select h.ledger_id from lims.audit_chain_head h where h.ledger_id = any (declared) order by h.ledger_id for update loop
    locked := locked + 1;
  end loop;
  if locked <> coalesce(cardinality(declared), 0) then
    raise exception 'context declares a ledger that has no chain' using errcode = 'LA010';
  end if;
  return clock_timestamp();
end $$;

create function lims.append_audit(p_ledger uuid, p_table text, p_pk text, p_record uuid, p_op text, p_changes jsonb)
returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx   jsonb := lims.require_context();
  head  lims.audit_chain_head;
  ts    timestamptz;
  seq   bigint;
  bytes bytea;
begin
  if not (ctx->'ledgers') ? p_ledger::text then
    raise exception 'write to ledger % that the transaction did not declare', p_ledger using errcode = 'LA005';
  end if;
  select * into head from lims.audit_chain_head where ledger_id = p_ledger for update;
  ts  := clock_timestamp();
  seq := head.head_seq + 1;
  bytes := convert_to(json_build_object(
    'ledger', p_ledger, 'seq', seq,
    'at', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'person', ctx->>'person_id', 'role', ctx->>'role',
    'acting_lab', ctx->>'acting_lab_id', 'customer', ctx->>'customer_id',
    'action', ctx->>'action', 'reason_code', ctx->>'reason_code', 'reason_text', ctx->>'reason_text',
    'table', p_table, 'pk', p_pk, 'record', p_record, 'op', p_op, 'changes', p_changes,
    'app_release', ctx->>'app_release', 'session', ctx->>'session_id', 'commit_key', ctx->>'commit_key',
    'prev_hash', encode(head.head_hash, 'hex')
  )::text, 'UTF8');
  insert into lims.audit_entry (ledger_id, seq, at, person_id, role, acting_lab_id, customer_id, action,
                                reason_code, reason_text, table_name, row_pk, record_id, op, changes,
                                app_release, session_id, commit_key, prev_hash, entry_bytes)
  values (p_ledger, seq, ts, (ctx->>'person_id')::uuid, ctx->>'role',
          (ctx->>'acting_lab_id')::uuid, (ctx->>'customer_id')::uuid, ctx->>'action',
          ctx->>'reason_code', ctx->>'reason_text', p_table, p_pk, p_record, p_op, p_changes,
          ctx->>'app_release', (ctx->>'session_id')::uuid, (ctx->>'commit_key')::uuid,
          head.head_hash, bytes);
  update lims.audit_chain_head
     set head_seq = seq, head_hash = sha256(head.head_hash || sha256(bytes))
   where ledger_id = p_ledger;
end $$;

-- Capture trigger, AFTER INSERT OR UPDATE FOR EACH ROW. Arguments, set by register_table:
--   0  where the ledger comes from: 'lab_id', 'ledger_id' or 'company'
--   1  the primary-key columns, comma-separated, read from the catalog at registration
--   2  the column naming the record the row belongs to, or ''
--   3  columns whose values are redacted in the trail, comma-separated
create function lims.capture() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx      jsonb := lims.require_context();
  newj     jsonb := to_jsonb(new);
  oldj     jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  redacted text[] := string_to_array(tg_argv[3], ',');
  diff     jsonb := '{}'::jsonb;
  ledger   uuid;
  k        text;
begin
  ledger := case tg_argv[0] when 'company' then lims.company_ledger() else (newj->>tg_argv[0])::uuid end;
  if ledger is null then
    raise exception 'row on % names no ledger', tg_table_name using errcode = 'LA006';
  end if;
  -- The database half of the lab-scoped seam: a Lab's row is written only while acting in that
  -- Lab, unless a named service identity acts.
  if ctx->>'role' not like 'svc:%'
     and exists (select 1 from lims.lab where id = ledger)
     and ledger is distinct from (ctx->>'acting_lab_id')::uuid then
    raise exception 'row for Lab % written while acting in Lab %', ledger, ctx->>'acting_lab_id' using errcode = 'LA006';
  end if;
  if tg_op = 'UPDATE' and ctx->>'reason_code' = 'first_save' then
    raise exception 'a change after first save needs a Reason for Change' using errcode = 'LA007';
  end if;
  for k in select jsonb_object_keys(newj) loop
    if oldj is null or (oldj->k) is distinct from (newj->k) then
      if k = any (redacted) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(case when oldj is null then null else '[changed]' end, '[changed]'));
      else
        diff := diff || jsonb_build_object(k, jsonb_build_array(oldj->k, newj->k));
      end if;
    end if;
  end loop;
  if diff = '{}'::jsonb then
    return null;
  end if;
  perform lims.append_audit(
    ledger, tg_table_name,
    (select jsonb_agg(newj->c) from unnest(string_to_array(tg_argv[1], ',')) c)::text,
    case when tg_argv[2] <> '' then (newj->>tg_argv[2])::uuid end,
    lower(tg_op), diff);
  return null;
end $$;

create function lims.block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: regulated rows are never changed or deleted', tg_op, tg_table_name
    using errcode = 'LA008';
end $$;

create trigger block_mutation before update or delete on lims.audit_entry
  for each row execute function lims.block_mutation();
create trigger block_truncate before truncate on lims.audit_entry
  for each statement execute function lims.block_mutation();
create trigger block_mutation before update or delete on lims.release
  for each row execute function lims.block_mutation();
create trigger block_truncate before truncate on lims.release
  for each statement execute function lims.block_mutation();

-- Every audited table goes through register_table, which reads the primary key from the catalog
-- and issues the grants, the capture trigger and the blocking triggers together, so none can be
-- forgotten for a new table. record_col names the column holding the record the row belongs
-- to; when null, a column called record_id is used if the table has one.
create function lims.register_table(tbl regclass, ledger_source text, insert_only boolean,
                                    record_col text default null, redact text[] default '{}')
returns void language plpgsql as $$
declare
  pk  text[];
  rec text;
begin
  if ledger_source not in ('lab_id', 'ledger_id', 'company') then
    raise exception 'ledger source must be lab_id, ledger_id or company';
  end if;
  select array_agg(a.attname order by k.ord) into pk
    from pg_index i
    cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = tbl and i.indisprimary;
  if pk is null then
    raise exception 'table % has no primary key', tbl;
  end if;
  rec := coalesce(record_col, (select a.attname::text from pg_attribute a
                                where a.attrelid = tbl and a.attname = 'record_id' and not a.attisdropped));
  execute format('create trigger capture after insert or update on %s for each row execute function lims.capture(%L, %L, %L, %L)',
                 tbl, ledger_source, array_to_string(pk, ','), coalesce(rec, ''), array_to_string(redact, ','));
  execute format('create trigger block_truncate before truncate on %s for each statement execute function lims.block_mutation()', tbl);
  if insert_only then
    execute format('create trigger block_mutation before update or delete on %s for each row execute function lims.block_mutation()', tbl);
    execute format('grant select, insert on %s to lims_app', tbl);
  else
    execute format('create trigger block_delete before delete on %s for each row execute function lims.block_mutation()', tbl);
    execute format('grant select, insert, update on %s to lims_app', tbl);
  end if;
end $$;

select lims.register_table('lims.lab', 'company', false);

-- Creating a Lab creates its ledger and chain head, which the app may not write directly. The
-- lab row itself is captured on the company chain.
create function lims.create_lab(p_id uuid, p_code text, p_iana_zone text) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  insert into lims.ledger (id, kind, code) values (p_id, 'lab', p_code);
  insert into lims.audit_chain_head (ledger_id) values (p_id);
  insert into lims.lab (id, code, iana_zone) values (p_id, p_code, p_iana_zone);
end $$;

-- Recomputes a ledger's chain from the stored entry_bytes. Entry k is checked against the
-- commitment made to it by entry k+1's prev_hash (or by the head for the last entry), so a
-- tampered entry is reported at its own seq. Anchors are deferred (decision 34), so there is no
-- off-server comparison yet.
create function lims.verify_chain(p_ledger uuid)
returns table (intact_through bigint, first_break bigint, head_matches boolean)
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  head     lims.audit_chain_head;
  running  bytea  := '\x00'::bytea;
  expected bigint := 1;
  after    bytea;
  r        record;
begin
  select * into head from lims.audit_chain_head where ledger_id = p_ledger;
  if not found then
    raise exception 'unknown ledger %', p_ledger;
  end if;
  for r in select e.seq, e.prev_hash, e.entry_bytes, lead(e.prev_hash) over (order by e.seq) as next_prev
             from lims.audit_entry e where e.ledger_id = p_ledger order by e.seq loop
    after := sha256(running || sha256(r.entry_bytes));
    if r.seq <> expected or r.prev_hash <> running or after <> coalesce(r.next_prev, head.head_hash) then
      return query select expected - 1, r.seq, false;
      return;
    end if;
    running := after;
    expected := expected + 1;
  end loop;
  return query select expected - 1, null::bigint, running = head.head_hash;
end $$;

grant select on lims.ledger, lims.audit_chain_head, lims.audit_entry to lims_app;
grant select, insert on lims.release to lims_app;
grant execute on function lims.company_ledger(), lims.lock_chains(), lims.create_lab(uuid, text, text),
                          lims.verify_chain(uuid) to lims_app;

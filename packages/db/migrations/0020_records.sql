-- Records, Record Versions, Recorded Values, Electronic Signatures, Critical Data Change, locks.
--
-- A signable record is a head row (identity and in-place lifecycle state only) plus insert-only
-- Record Versions. A Record Version stores its canonical content as bytes, and the database
-- computes the SHA-256 of those bytes as a generated column. A signature carries (version id,
-- hash) through a composite foreign key onto (id, content_hash), so a signature bound to a hash
-- other than the stored content's cannot be inserted. Nothing ever re-derives canonical content
-- to check a signature. Every typed value on a signable record is a Recorded Value: a tiny record
-- whose versions are the value's history. A later version of a critical value requires approval
-- and is not effective until someone other than its author signs it Verified or Approved. That is
-- ADR 0001, enforced by the effective_version view, not by application code.
--
-- The app never inserts a version or a signature: lims_app has SELECT only on record_version,
-- record_version_cite and signature, and writes them through lims.seal() and lims.sign().

create table lims.record_kind (
  kind                      text primary key,
  ledger_class              text not null check (ledger_class in ('lab', 'company')),
  approval_after_first_save boolean not null,
  meanings                  text[] not null
);
grant select on lims.record_kind to lims_app;

create table lims.record (
  ledger_id  uuid not null references lims.ledger (id),
  id         uuid not null,
  kind       text not null references lims.record_kind (kind),
  parent_id  uuid,
  created_at timestamptz not null default clock_timestamp(),
  primary key (id),
  unique (ledger_id, id),
  foreign key (ledger_id, parent_id) references lims.record (ledger_id, id)
);
select lims.register_table('lims.record', 'ledger_id', true, 'id');

create table lims.record_version (
  ledger_id         uuid   not null,
  id                uuid   not null primary key,
  record_id         uuid   not null,
  version_no        int    not null check (version_no >= 1),
  content           bytea  not null,
  content_hash      bytea  not null generated always as (sha256(content)) stored,
  content_schema    text   not null,
  requires_approval boolean not null default false,
  created_by        uuid   not null,
  created_at        timestamptz not null default clock_timestamp(),
  app_release       text   not null references lims.release (id),
  foreign key (ledger_id, record_id) references lims.record (ledger_id, id),
  unique (record_id, version_no),
  unique (ledger_id, id, content_hash)
);
select lims.register_table('lims.record_version', 'ledger_id', true);
revoke insert on lims.record_version from lims_app;

-- What a version cites: child value versions, Run Versions a Test used, Test versions a report
-- holds. The same ids and hashes are inside content; this table lets the database answer "does
-- everything this version cites still stand?" without parsing bytes.
create table lims.record_version_cite (
  ledger_id     uuid  not null,
  version_id    uuid  not null references lims.record_version (id),
  cited_version uuid  not null references lims.record_version (id),
  cited_hash    bytea not null,
  primary key (version_id, cited_version)
);
select lims.register_table('lims.record_version_cite', 'ledger_id', true, 'version_id');
revoke insert on lims.record_version_cite from lims_app;

create table lims.record_lock (
  ledger_id    uuid not null,
  record_id    uuid not null primary key references lims.record (id),
  signature_id uuid not null,
  at           timestamptz not null default clock_timestamp()
);
select lims.register_table('lims.record_lock', 'ledger_id', true);
revoke insert on lims.record_lock from lims_app;

create table lims.recorded_value (
  ledger_id  uuid not null,
  record_id  uuid not null primary key,
  parent_id  uuid not null,
  field      text not null,
  subject    text not null default '',
  critical   boolean not null,
  value_type text not null check (value_type in ('decimal', 'text', 'ref', 'blob', 'boolean')),
  unit       text,
  foreign key (ledger_id, record_id) references lims.record (ledger_id, id),
  foreign key (ledger_id, parent_id) references lims.record (ledger_id, id),
  unique (parent_id, field, subject)
);
select lims.register_table('lims.recorded_value', 'ledger_id', true);

create function lims.recorded_value_guard() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from lims.record r where r.id = new.record_id and r.kind = 'value' and r.parent_id = new.parent_id) then
    raise exception 'a Recorded Value is a record of kind value under its parent' using errcode = 'LV004';
  end if;
  return new;
end $$;
create trigger recorded_value_guard before insert on lims.recorded_value
  for each row execute function lims.recorded_value_guard();

-- Typed detail of each value version, for queries. Written in the same transaction as the version
-- whose content bytes were built from it; both are immutable, so they cannot drift.
create table lims.recorded_value_version (
  ledger_id  uuid not null,
  version_id uuid not null primary key references lims.record_version (id),
  value_text text not null,
  decimals   int,
  blob_hash  bytea
);
select lims.register_table('lims.recorded_value_version', 'ledger_id', true, 'version_id');

create function lims.version_defaults() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx     jsonb := lims.require_context();
  k       lims.record_kind;
  parent  uuid;
  last_no int;
begin
  select parent_id into parent from lims.record where id = new.record_id;
  select rk.* into k from lims.record r join lims.record_kind rk on rk.kind = r.kind where r.id = new.record_id;
  select max(version_no) into last_no from lims.record_version where record_id = new.record_id;
  if new.version_no <> coalesce(last_no, 0) + 1 then
    raise exception 'version % of record % is not the next version', new.version_no, new.record_id using errcode = 'LV005';
  end if;
  if exists (select 1 from lims.record_lock l where l.record_id in (new.record_id, parent)) then
    raise exception 'record % is locked by a Released Test Report', new.record_id using errcode = 'LR001';
  end if;
  -- The app cannot opt out: a later version of a critical Recorded Value awaits approval.
  new.requires_approval := last_no is not null
                           and k.approval_after_first_save
                           and coalesce((select rv.critical from lims.recorded_value rv where rv.record_id = new.record_id), true);
  new.created_at  := clock_timestamp();
  new.created_by  := (ctx->>'person_id')::uuid;
  new.app_release := ctx->>'app_release';
  return new;
end $$;
create trigger version_defaults before insert on lims.record_version
  for each row execute function lims.version_defaults();

-- The seal door. Freezes canonical bytes as the record's next version, or returns the latest
-- version when the bytes are identical, so re-opening a signing prompt makes nothing new. Each
-- cite is checked against the cited version's stored hash and must appear in the content.
create function lims.seal(p_record uuid, p_content bytea, p_schema text, p_cites jsonb default '[]'::jsonb)
returns table (version_id uuid, version_no int, content_hash bytea, reused boolean)
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx    jsonb := lims.require_context();
  rec    lims.record;
  latest lims.record_version;
  cited  lims.record_version;
  h      bytea := sha256(p_content);
  vid    uuid  := gen_random_uuid();
  c      jsonb;
begin
  select * into rec from lims.record where id = p_record;
  if not found then
    raise exception 'record % does not exist', p_record using errcode = 'LV001';
  end if;
  select * into latest from lims.record_version v where v.record_id = p_record order by v.version_no desc limit 1;
  if found and latest.content_hash = h then
    return query select latest.id, latest.version_no, latest.content_hash, true;
    return;
  end if;
  insert into lims.record_version (ledger_id, id, record_id, version_no, content, content_schema, created_by, app_release)
  values (rec.ledger_id, vid, p_record, coalesce(latest.version_no, 0) + 1, p_content, p_schema,
          (ctx->>'person_id')::uuid, ctx->>'app_release');
  for c in select * from jsonb_array_elements(p_cites) loop
    select * into cited from lims.record_version where id = (c->>'version_id')::uuid;
    if not found or cited.content_hash <> decode(c->>'hash', 'hex') then
      raise exception 'cite of version % does not match its stored hash', c->>'version_id' using errcode = 'LV002';
    end if;
    if position(encode(cited.content_hash, 'hex') in convert_from(p_content, 'UTF8')) = 0 then
      raise exception 'content does not carry the hash it cites (%)', c->>'version_id' using errcode = 'LV003';
    end if;
    insert into lims.record_version_cite (ledger_id, version_id, cited_version, cited_hash)
    values (rec.ledger_id, vid, cited.id, cited.content_hash);
  end loop;
  return query select vid, coalesce(latest.version_no, 0) + 1, h, false;
end $$;

create table lims.signature (
  ledger_id              uuid not null,
  id                     uuid not null primary key,
  record_version_id      uuid not null,
  content_hash           bytea not null,
  meaning                text not null check (meaning in
                           ('Performed', 'Verified', 'Reviewed', 'Approved', 'Released', 'Authored', 'Acknowledged')),
  signer_person_id       uuid not null,
  printed_name           text not null,
  username               text not null,
  role                   text not null,
  signer_lab_id          uuid,
  signed_at              timestamptz not null,
  authenticator          text not null check (authenticator in ('totp', 'passkey')),
  session_id             uuid not null,
  app_release            text not null references lims.release (id),
  commit_key             uuid not null,
  group_id               uuid not null,
  attestation_version_id uuid,
  attestation_hash       bytea,
  foreign key (ledger_id, record_version_id, content_hash)
    references lims.record_version (ledger_id, id, content_hash),
  foreign key (ledger_id, attestation_version_id, attestation_hash)
    references lims.record_version (ledger_id, id, content_hash),
  check ((attestation_version_id is null) = (attestation_hash is null)),
  unique (record_version_id, meaning, signer_person_id)
);
select lims.register_table('lims.signature', 'ledger_id', true);
revoke insert on lims.signature from lims_app;

-- Separation of duties that is about rows alone. Rules that need Authorisations, Training Records
-- or the Test tree live in the pure gates; these stay true even if a gate has a bug.
-- LS002 is the strict reading recorded in the design: nobody who authored any version of a value
-- signs it Verified.
create function lims.signature_guard() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx jsonb := lims.require_context();
  v   lims.record_version;
begin
  new.signed_at := clock_timestamp();
  if new.signer_person_id <> (ctx->>'person_id')::uuid then
    raise exception 'a signature is written only in its signer''s own audited transaction' using errcode = 'LS000';
  end if;
  select * into v from lims.record_version where id = new.record_version_id;
  if v.requires_approval and new.meaning in ('Verified', 'Approved') and new.signer_person_id = v.created_by then
    raise exception 'nobody approves a change they proposed' using errcode = 'LS001';
  end if;
  if new.meaning = 'Verified' and exists (
    select 1 from lims.record_version a where a.record_id = v.record_id and a.created_by = new.signer_person_id
  ) then
    raise exception 'the Verified signer entered a version of this value' using errcode = 'LS002';
  end if;
  if not exists (
    select 1 from lims.record r join lims.record_kind k on k.kind = r.kind
     where r.id = v.record_id and new.meaning = any (k.meanings)
  ) then
    raise exception 'this record kind does not carry the meaning %', new.meaning using errcode = 'LS003';
  end if;
  return new;
end $$;
create trigger signature_guard before insert on lims.signature
  for each row execute function lims.signature_guard();

-- The sign door. The signer's name, username, role, Lab, session, release and commit key come
-- from the context and the account, never from the caller; the caller names the signer only so a
-- mismatch with the context is refused (LS000). The hash must be the one the prompt showed: the
-- composite foreign key refuses any other.
create function lims.sign(p_signer uuid, p_version uuid, p_hash bytea, p_meaning text, p_authenticator text,
                          p_group uuid, p_attestation_version uuid default null, p_attestation_hash bytea default null)
returns table (signature_id uuid, signed_at timestamptz)
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx jsonb := lims.require_context();
  v   lims.record_version;
  s   lims.signature;
begin
  select * into v from lims.record_version where id = p_version;
  if not found then
    raise exception 'version % does not exist', p_version using errcode = 'LV001';
  end if;
  insert into lims.signature (ledger_id, id, record_version_id, content_hash, meaning, signer_person_id, printed_name,
                              username, role, signer_lab_id, signed_at, authenticator, session_id, app_release,
                              commit_key, group_id, attestation_version_id, attestation_hash)
  select v.ledger_id, gen_random_uuid(), p_version, p_hash, p_meaning, p_signer, p.printed_name, a.username,
         ctx->>'role', (ctx->>'acting_lab_id')::uuid, clock_timestamp(), p_authenticator, (ctx->>'session_id')::uuid,
         ctx->>'app_release', (ctx->>'commit_key')::uuid, p_group, p_attestation_version, p_attestation_hash
    from lims.person p join lims.account a on a.person_id = p.id
   where p.id = p_signer
  returning * into s;
  if s.id is null then
    raise exception 'signer % has no account', p_signer using errcode = 'LS004';
  end if;
  return query select s.id, s.signed_at;
end $$;

create table lims.version_rejection (
  ledger_id   uuid not null,
  version_id  uuid not null primary key references lims.record_version (id),
  rejected_by uuid not null,
  reason_code text not null,
  reason_text text,
  at          timestamptz not null default clock_timestamp()
);
select lims.register_table('lims.version_rejection', 'ledger_id', true, 'version_id');

-- Effective state, derived. There is no current_version_id column to keep in sync.
create view lims.effective_version as
select distinct on (v.record_id) v.*
  from lims.record_version v
 where not exists (select 1 from lims.version_rejection r where r.version_id = v.id)
   and (not v.requires_approval
        or exists (select 1 from lims.signature s where s.record_version_id = v.id and s.meaning in ('Verified', 'Approved')))
 order by v.record_id, v.version_no desc;

-- A proposed Critical Data Change: newer than the effective version, not approved, not rejected.
create view lims.pending_version as
select v.*
  from lims.record_version v
  join lims.effective_version e on e.record_id = v.record_id
 where v.version_no > e.version_no
   and not exists (select 1 from lims.version_rejection r where r.version_id = v.id);
grant select on lims.effective_version, lims.pending_version to lims_app;

-- "UNSIGNED, changed after signature", as the reasons a version no longer stands. A version stands
-- when it is its record's effective version, no Recorded Value was added under its record since
-- it was sealed, and everything it cites stands. A cited value that changed is reported by the
-- recursion as the cited version being superseded. Nothing here recomputes a hash.
create function lims.version_standing_failures(p_version uuid)
returns table (version_id uuid, reason text)
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  v lims.record_version;
  c record;
begin
  select * into v from lims.record_version where id = p_version;
  if not found then
    return query select p_version, 'missing';
    return;
  end if;
  if (select e.id from lims.effective_version e where e.record_id = v.record_id) is distinct from v.id then
    return query select v.id, 'superseded';
  end if;
  return query
    select v.id, 'child-added:' || ch.id
      from lims.record ch
     where ch.parent_id = v.record_id and ch.kind = 'value'
       and not exists (select 1 from lims.record_version_cite ct
                        join lims.record_version cv on cv.id = ct.cited_version
                       where ct.version_id = v.id and cv.record_id = ch.id);
  for c in select ct.cited_version from lims.record_version_cite ct where ct.version_id = v.id loop
    return query select * from lims.version_standing_failures(c.cited_version);
  end loop;
end $$;

create function lims.version_stands(p_version uuid) returns boolean
language sql stable security definer set search_path = lims, pg_temp as $$
  select not exists (select 1 from lims.version_standing_failures(p_version))
$$;

-- The release lock: every record whose version is in the cite closure of the Released version
-- (the report, its Tests, their Recorded Values, the Run Versions they used and those Runs'
-- values). version_defaults refuses a new version of a locked record or of a value under one, and
-- head_guard refuses in-place changes to a locked head. The releasing transaction therefore
-- makes its own lifecycle updates (Test to Reported, report to Released) before calling this.
create function lims.lock_released(p_signature uuid) returns int
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  s lims.signature;
  n int;
begin
  select * into s from lims.signature where id = p_signature;
  if not found or s.meaning <> 'Released' then
    raise exception 'only a Released signature locks records' using errcode = 'LR003';
  end if;
  with recursive closure (vid) as (
    select s.record_version_id
    union
    select c.cited_version from lims.record_version_cite c join closure on c.version_id = closure.vid
  )
  insert into lims.record_lock (ledger_id, record_id, signature_id)
  select distinct v.ledger_id, v.record_id, p_signature
    from closure join lims.record_version v on v.id = closure.vid
  on conflict (record_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Head rows: only the lifecycle columns named at registration change in place. Any other column
-- is identity and may only be set once, from null. A locked head changes no more at all.
create function lims.head_guard() returns trigger
language plpgsql as $$
declare
  mutable text[] := tg_argv;
  oldj    jsonb := to_jsonb(old);
  newj    jsonb := to_jsonb(new);
  k       text;
begin
  for k in select jsonb_object_keys(newj) loop
    if not (k = any (mutable)) and (oldj->k) is distinct from (newj->k) and jsonb_typeof(oldj->k) <> 'null' then
      raise exception 'column %.% is identity and never changes in place', tg_table_name, k using errcode = 'LR002';
    end if;
  end loop;
  if exists (select 1 from lims.record_lock l where l.record_id = new.id) then
    raise exception '% is locked by a Released Test Report', tg_table_name using errcode = 'LR001';
  end if;
  return new;
end $$;

-- Plug-in contract for a new signable record type: one record_kind row, a head table with
-- (lab_id, id) referencing record (ledger_id, id), and this one call.
create function lims.register_signable_head(tbl regclass, mutable_columns text[])
returns void language plpgsql as $$
begin
  perform lims.register_table(tbl, 'lab_id', false, 'id');
  execute format('create trigger head_guard before update on %s for each row execute function lims.head_guard(%s)',
                 tbl, coalesce((select string_agg(quote_literal(c), ',') from unnest(mutable_columns) c), ''));
end $$;

create table lims.blob (
  ledger_id  uuid  not null,
  sha256     bytea not null,
  size_bytes bigint not null,
  media_type text  not null,
  stored_at  timestamptz not null default clock_timestamp(),
  primary key (ledger_id, sha256)
);
select lims.register_table('lims.blob', 'ledger_id', true);

insert into lims.record_kind values
  ('value',           'lab',     true,  array['Verified', 'Approved']),
  ('test',            'lab',     false, array['Performed', 'Reviewed']),
  ('run',             'lab',     false, array['Performed', 'Reviewed']),
  ('review',          'lab',     false, array[]::text[]),
  ('test_report',     'lab',     false, array['Released']),
  ('authorisation',   'lab',     false, array['Approved']),
  ('method_adoption', 'lab',     false, array['Approved']),
  ('training_record', 'company', false, array['Acknowledged', 'Performed', 'Verified']),
  ('method_version',  'company', true,  array['Authored', 'Reviewed', 'Approved']),
  ('specification',   'company', true,  array['Authored', 'Approved']);

grant execute on function
  lims.seal(uuid, bytea, text, jsonb),
  lims.sign(uuid, uuid, bytea, text, text, uuid, uuid, bytea),
  lims.lock_released(uuid),
  lims.version_stands(uuid),
  lims.version_standing_failures(uuid)
to lims_app;

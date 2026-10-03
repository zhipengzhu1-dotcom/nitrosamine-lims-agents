set local role lims_owner;

-- The Release Log (#102; ADR 0002, change control): every release, configuration change and host move is an entry
-- the owner signs Approved through lims.sign. An entry may also declare service identities, record or lapse a demo
-- exception, bring a signature statement version into force (QA signs that one) or set the deployment's data
-- class. Each effect takes hold in the transaction that writes the Approved Signature, and never before.
create type lims.data_class as enum ('fictional', 'real');
create type lims.release_log_kind as enum ('Release', 'ConfigurationChange', 'HostMove');
create type lims.demo_exception as enum ('TwoRole', 'Anchoring', 'FileVault', 'PlaintextAtCloudflare', 'DemoLogin');

-- True when every element of a list of images names its image and sha256 digest, as `name@sha256:<64 hex>`.
create function lims.image_digest_refs(p_refs text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(x is not null and x ~ '^[^@[:space:]]+@sha256:[0-9a-f]{64}$'), true) from unnest(p_refs) x
$$;

-- A Release carries its validation evidence (ADR 0002): the digests of the images it ships, the CI run that tested
-- them and its result, and the ZAP baseline scan's result. The Approved Signature covers them through the content.
create table lims.release_log_entry (
  id                      uuid                   primary key default gen_random_uuid(),
  kind                    lims.release_log_kind  not null,
  title                   text                   not null check (title <> ''),
  summary                 text                   not null check (summary <> ''),
  release                 text                   check (release <> ''),
  image_digests           text[]                 check (cardinality(image_digests) > 0 and lims.image_digest_refs(image_digests)),
  ci_run                  text                   check (ci_run <> ''),
  ci_result               text                   check (ci_result in ('Passed', 'Failed')),
  zap_baseline_result     text                   check (zap_baseline_result in ('Passed', 'Warned', 'Failed')),
  sets_data_class         lims.data_class,
  file_vault_personal_key boolean,
  records_exceptions      lims.demo_exception[]  not null default '{}',
  lapses_exceptions       lims.demo_exception[]  not null default '{}',
  statement_version       integer                check (statement_version >= 1),
  statement               bytea,
  recorded_at             timestamptz            not null default clock_timestamp(),
  constraint release_log_entry_kind_release_check check (kind <> 'Release' or release is not null),
  constraint release_log_entry_release_evidence_check check (
    num_nulls(image_digests, ci_run, ci_result, zap_baseline_result) = case when kind = 'Release' then 0 else 4 end),
  constraint release_log_entry_statement_pair_check check ((statement_version is null) = (statement is null)),
  constraint release_log_entry_file_vault_check check (sets_data_class is null or file_vault_personal_key is not null),
  -- QA approves a statement entry alone, so it may carry no effect the Platform Operator approves.
  constraint release_log_entry_statement_alone_check check (
    statement_version is null
    or (sets_data_class is null and file_vault_personal_key is null and records_exceptions = '{}' and lapses_exceptions = '{}')),
  constraint release_log_entry_exception_twice_check check (not (records_exceptions && lapses_exceptions))
);

-- True when every element of a scope is one 'table:OP' pair.
create function lims.scope_pairs(p_scope text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(x is not null and x ~ '^[a-z_]+:(INSERT|UPDATE|DELETE)$'), true) from unnest(p_scope) x
$$;

-- A service identity acts only inside the record types and actions its entry declares, as 'table:OP' pairs.
create table lims.service_identity (
  name                text primary key check (name like 'svc:_%'),
  scope               text[] not null check (cardinality(scope) > 0),
  created_by_entry_id uuid not null references lims.release_log_entry,
  retired_by_entry_id uuid references lims.release_log_entry,
  constraint service_identity_scope_pair_check check (lims.scope_pairs(scope))
);

-- The one deployment and its data class. Every deployment starts fictional.
create table lims.deployment (
  single          boolean         primary key default true check (single),
  data_class      lims.data_class not null default 'fictional',
  set_by_entry_id uuid            references lims.release_log_entry
);

do $$
declare
  t text;
begin
  foreach t in array array['release_log_entry', 'service_identity', 'deployment'] loop
    execute format('create trigger capture after insert or update or delete on lims.%I
                    for each row execute function lims.capture()', t);
    execute format('create trigger refuse_truncate before truncate on lims.%I
                    for each statement execute function lims.refuse_change()', t);
  end loop;
  execute 'create trigger refuse_change before update or delete on lims.release_log_entry
           for each row execute function lims.refuse_change()';
  execute 'create trigger refuse_change before delete on lims.deployment
           for each row execute function lims.refuse_change()';
end $$;

select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Every deployment starts with the fictional data class', true);
insert into lims.deployment default values;

-- Every captured insert takes a share lock on the one deployment row here, so a change of the class serialises with
-- captured writes: the approval waits for a write in flight to commit, and then the gate sees its record.
create function lims.current_data_class() returns lims.data_class
language sql volatile security definer set search_path = lims, pg_temp as $$
  select data_class from deployment for share
$$;

-- The deployment row is locked before any Audit Trail chain, by every transaction that writes a captured row: a share
-- lock for an ordinary write, and for a transaction that declared it changes the data class, the lock its update
-- takes. A change of the class that took a chain first would wait on a writer's share lock while the writer waits on
-- that chain. The transaction declares the change before its first chain, so lock_chain takes the update's lock.
create function lims.declare_data_class_change() returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  if this_transaction('lims.chains') is not null then
    raise exception 'a change of the data class is declared before the transaction takes any Audit Trail chain'
      using errcode = 'LA004';
  end if;
  perform set_this_transaction('lims.data_class_change', 'declared');
end $$;

create or replace function lims.lock_chain(p_chain text) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  held   text[] := coalesce(string_to_array(this_transaction('lims.chains'), ','), '{}');
  latest text   := held[cardinality(held)];
begin
  if not p_chain = any(held) then
    if latest is not null and (p_chain = 'company' or (latest <> 'company' and p_chain::uuid < latest::uuid)) then
      raise exception 'chain % is locked after chain %; declare both chains when the transaction starts', p_chain, latest
        using errcode = 'LA004';
    end if;
    if latest is null then
      if this_transaction('lims.data_class_change') = 'declared' then
        perform from deployment for no key update;
        perform set_this_transaction('lims.data_class_change', 'locked');
      else
        perform from deployment for share;
      end if;
    end if;
    insert into audit_chain (chain) values (p_chain) on conflict do nothing;
    perform set_this_transaction('lims.chains', array_to_string(held || p_chain, ','));
  end if;
  perform from audit_chain where chain = p_chain for update;
end $$;

-- Every captured record carries the data class it was created under, so the gate can find a fictional one.
do $$
declare
  t text;
begin
  for t in select c.relname from pg_trigger g join pg_class c on c.oid = g.tgrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'lims' and g.tgname = 'capture' and c.relname <> 'deployment' order by 1 loop
    execute format('alter table lims.%I add column data_class lims.data_class not null default lims.current_data_class()', t);
  end loop;
end $$;

-- The tables the gate does not read for any fictional record, among those that carry the class: the Lab (a real
-- deployment creates its Lab before its class can change), the accounts, which lims.fictional_accounts reads by person
-- instead, sign-in and signing infrastructure (whose rows hang off a record the gate finds) and change control itself.
-- Every other table that carries the class is read, so a captured table added later is read unless it is named here.
create function lims.gate_exempt_tables() returns text[]
language sql immutable as $$
  select array['access_event', 'credential_link', 'deployment', 'identity_verification', 'lab', 'membership', 'person',
               'reauthentication', 'record_version', 'release_log_entry', 'service_identity', 'signature',
               'signature_statement', 'signing_role']
$$;

-- The account tables holding a row created under fictional for anyone but p_person: an account, a Membership, an
-- Identity Verification or a one-time link. The person approving the entry that sets real is the one account the
-- deployment needed before its class could change; every other was granted, checked or issued under fictional, with
-- nothing signed for it.
create function lims.fictional_accounts(p_person uuid) returns text[]
language sql volatile security definer set search_path = lims, pg_temp as $$
  select array_remove(array[
    case when exists (select from credential_link where data_class = 'fictional' and person_id is distinct from p_person)
         then 'credential_link' end,
    case when exists (select from identity_verification v
                       where v.data_class = 'fictional'
                         and not exists (select from person p where p.identity_verification_id = v.id and p.id = p_person))
         then 'identity_verification' end,
    case when exists (select from membership where data_class = 'fictional' and person_id is distinct from p_person)
         then 'membership' end,
    case when exists (select from person where data_class = 'fictional' and id is distinct from p_person)
         then 'person' end], null)
$$;

-- The usernames of the people holding Admin together with another role in any Lab: the TwoRole demo exception in fact.
create function lims.admins_with_another_role() returns text[]
language sql volatile security definer set search_path = lims, pg_temp as $$
  select coalesce(array_agg(p.username order by p.username), '{}') from person p
   where exists (select from membership m where m.person_id = p.id and m.role = 'Admin')
     and exists (select from membership m where m.person_id = p.id and m.role <> 'Admin')
$$;

create function lims.fictional_records() returns text[]
language plpgsql volatile security definer set search_path = lims, pg_temp as $$
declare
  t     text;
  found boolean;
  out   text[] := '{}';
begin
  -- The catalog, not information_schema, which would hide a table this role holds no privilege on.
  for t in select c.relname from pg_attribute a join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'lims' and c.relkind = 'r' and a.attname = 'data_class' and not a.attisdropped
              and c.relname <> all (gate_exempt_tables())
            order by 1 loop
    execute format('select exists (select from lims.%I where data_class = ''fictional'')', t) into found;
    if found then out := out || t; end if;
  end loop;
  return out;
end $$;

-- Only a Release Log entry is signed Approved, so these index the approvals the scope check and the gate look up.
create index signature_approved_idx on lims.signature (record_version_id) where meaning = 'Approved';
create index record_version_record_idx on lims.record_version (record_table, record_id);

-- True once a Release Log entry carries an Approved Signature.
create function lims.release_log_entry_approved(p_id uuid) returns boolean
language sql stable set search_path = lims, pg_temp as $$
  select exists (select from signature g join record_version v on v.id = g.record_version_id
                  where v.record_table = 'release_log_entry' and v.record_id = p_id and g.meaning = 'Approved')
$$;

-- The demo exceptions in force: each approved entry records or lapses some, in the order of their Approved
-- Signatures, and the last approved word on an exception stands.
create function lims.open_demo_exceptions() returns lims.demo_exception[]
language sql volatile security definer set search_path = lims, pg_temp as $$
  select coalesce(array_agg(x order by x), '{}')
    from (select distinct on (ev.x) ev.x, ev.recorded
            from (select g.signed_at, g.id, x, true as recorded
                    from signature g join record_version v on v.id = g.record_version_id
                    join release_log_entry e on e.id = v.record_id, unnest(e.records_exceptions) x
                   where g.meaning = 'Approved' and v.record_table = 'release_log_entry'
                  union all
                  select g.signed_at, g.id, x, false
                    from signature g join record_version v on v.id = g.record_version_id
                    join release_log_entry e on e.id = v.record_id, unnest(e.lapses_exceptions) x
                   where g.meaning = 'Approved' and v.record_table = 'release_log_entry') ev
           order by ev.x, ev.signed_at desc, ev.id desc) last
   where last.recorded
$$;

-- The data class changes only in the transaction that approves the entry setting it, never to real while a fictional
-- record is held, and never from real back to fictional, which would stamp later real records fictional.
create function lims.data_class_through_release_log() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  held text[];
  standing demo_exception[];
  signer uuid;
begin
  if new.set_by_entry_id is null or this_transaction('lims.release_log') is distinct from new.set_by_entry_id::text then
    raise exception 'the data class changes only when a Release Log entry setting it is signed Approved' using errcode = 'LA011';
  end if;
  if this_transaction('lims.data_class_change') is distinct from 'locked' then
    raise exception 'the data class changes only in a transaction that declared it before taking any Audit Trail chain'
      using errcode = 'LA004';
  end if;
  if old.data_class = 'real' and new.data_class = 'fictional' then
    raise exception 'a deployment holding real data does not return to the fictional data class' using errcode = 'LA011';
  end if;
  if new.data_class = 'real' then
    standing := open_demo_exceptions();
    if standing <> '{}' then
      raise exception 'these demo exceptions still stand: %', array_to_string(standing, ', ') using errcode = 'LA011';
    end if;
    if (select file_vault_personal_key from release_log_entry where id = new.set_by_entry_id) is not true then
      raise exception 'the host records no personal FileVault key' using errcode = 'LA011';
    end if;
    held := fictional_records();
    if held <> '{}' then
      raise exception 'the database holds records created under fictional: %', array_to_string(held, ', ') using errcode = 'LA011';
    end if;
    -- The signer of the Approved Signature this transaction is inserting, whose own account carries into real.
    select g.person_id into signer from signature g join record_version v on v.id = g.record_version_id
     where v.record_table = 'release_log_entry' and v.record_id = new.set_by_entry_id and g.meaning = 'Approved';
    held := fictional_accounts(signer);
    if held <> '{}' then
      raise exception 'the database holds accounts created under fictional for someone other than the signer: %',
        array_to_string(held, ', ') using errcode = 'LA011';
    end if;
    held := admins_with_another_role();
    if held <> '{}' then
      raise exception 'a person holds Admin together with another role: %', array_to_string(held, ', ') using errcode = 'LA011';
    end if;
  end if;
  return new;
end $$;
create trigger data_class_through_release_log before update on lims.deployment
  for each row execute function lims.data_class_through_release_log();

-- A service identity is created, and retired, only by the Release Log entry written in the same transaction.
create function lims.service_identity_through_release_log() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  entry_xmin xid;
  entry_id   uuid;
begin
  if tg_op = 'UPDATE' then
    if new.name <> old.name or new.scope <> old.scope or new.created_by_entry_id <> old.created_by_entry_id
       or old.retired_by_entry_id is not null or new.retired_by_entry_id is null then
      raise exception 'a service identity changes only by being retired, once, by a Release Log entry' using errcode = 'LA011';
    end if;
    entry_id := new.retired_by_entry_id;
  else
    entry_id := new.created_by_entry_id;
  end if;
  select xmin into entry_xmin from release_log_entry where id = entry_id;
  if entry_xmin is null or not written_here(entry_xmin) then
    raise exception 'a service identity is created or retired only by the Release Log entry written with it' using errcode = 'LA011';
  end if;
  if (select statement_version from release_log_entry where id = entry_id) is not null then
    raise exception 'an entry bringing a signature statement into force declares no service identity' using errcode = 'LA011';
  end if;
  return new;
end $$;
create trigger service_identity_through_release_log before insert or update on lims.service_identity
  for each row execute function lims.service_identity_through_release_log();

-- Approving a Release Log entry applies what it declares, in the signing transaction. A statement entry takes QA's
-- Approved and any other the owner's, as Platform Operator; an entry is approved once, and is signed with no other
-- Signature Meaning, and no other record is signed Approved. A statement entry brings in the version after the one in
-- force.
create function lims.apply_release_log_entry() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  v        record_version;
  e        release_log_entry;
  approver text;
begin
  select * into v from record_version where id = new.record_version_id;
  if v.record_table <> 'release_log_entry' and new.meaning = 'Approved' then
    raise exception 'only a Release Log entry is signed Approved' using errcode = 'LA011';
  end if;
  if v.record_table <> 'release_log_entry' then return null; end if;
  if new.meaning <> 'Approved' then
    raise exception 'a Release Log entry is signed Approved, not %', new.meaning using errcode = 'LA011';
  end if;
  -- The row lock makes a second approval of the entry wait for the first, and then see it.
  select * into e from release_log_entry where id = v.record_id for no key update;
  approver := case when e.statement_version is not null then 'QA' else 'PlatformOperator' end;
  if new.role::text <> approver then
    raise exception 'a Release Log entry % is approved by %, not %',
      case when e.statement_version is not null then 'bringing a signature statement into force' else 'of the system' end,
      approver, new.role using errcode = 'LA011';
  end if;
  if exists (select from signature g join record_version x on x.id = g.record_version_id
              where x.record_table = 'release_log_entry' and x.record_id = e.id and g.meaning = 'Approved'
                and g.id <> new.id) then
    raise exception 'the Release Log entry is already approved' using errcode = 'LA011';
  end if;
  if e.sets_data_class is not null then
    perform set_this_transaction('lims.release_log', e.id::text);
    update deployment set data_class = e.sets_data_class, set_by_entry_id = e.id;
    perform set_this_transaction('lims.release_log', '');
  end if;
  if e.statement_version is not null then
    if e.statement_version <> (select max(version) + 1 from signature_statement) then
      raise exception 'the signature statement version % does not follow the version in force', e.statement_version
        using errcode = 'LA011';
    end if;
    insert into signature_statement (version, statement) values (e.statement_version, e.statement);
  end if;
  return null;
end $$;
-- Named to fire after the Signature's capture, which holds the Signature to the class it was created under.
create trigger take_effect_on_approval after insert on lims.signature
  for each row execute function lims.apply_release_log_entry();

insert into lims.signing_role (role, meaning) values ('PlatformOperator', 'Approved'), ('QA', 'Approved');

-- A Release Log entry is a company record: its Record Versions carry no Lab, and a Signature on one references the
-- version alone (the Signature keeps the Lab its signer acted in).
alter table lims.signature drop constraint signature_record_version_fkey;
alter table lims.record_version
  drop constraint record_version_pkey,
  drop constraint record_version_lab_id_id_content_hash_canonical_form_key,
  drop constraint record_version_lab_id_record_table_record_id_version_key,
  drop constraint record_version_record_table_check,
  alter column lab_id drop not null,
  add primary key (id),
  add unique (id, content_hash, canonical_form),
  add unique nulls not distinct (lab_id, record_table, record_id, version),
  add constraint record_version_record_table_check check (record_table in ('test', 'test_report', 'release_log_entry')),
  add constraint record_version_company_check check ((lab_id is null) = (record_table = 'release_log_entry'));
alter table lims.signature
  add constraint signature_record_version_fkey foreign key (record_version_id, content_hash, canonical_form)
    references lims.record_version (id, content_hash, canonical_form);

-- Canonical form 1 of a Release Log entry: everything it declares.
create function lims.release_log_entry_content(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', e.id,
    'kind', e.kind,
    'title', e.title,
    'summary', e.summary,
    'release', e.release,
    'imageDigests', to_jsonb(e.image_digests),
    'ciRun', e.ci_run,
    'ciResult', e.ci_result,
    'zapBaselineResult', e.zap_baseline_result,
    'setsDataClass', e.sets_data_class,
    'fileVaultPersonalKey', e.file_vault_personal_key,
    'recordsExceptions', to_jsonb(e.records_exceptions),
    'lapsesExceptions', to_jsonb(e.lapses_exceptions),
    'statementVersion', e.statement_version,
    'statement', case when e.statement is null then null else convert_from(e.statement, 'UTF8') end,
    'serviceIdentities', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'scope', to_jsonb(s.scope))
                                                     order by s.name)
                                     from lims.service_identity s where s.created_by_entry_id = e.id), '[]'::jsonb),
    'retiresServiceIdentities', coalesce((select jsonb_agg(s.name order by s.name)
                                            from lims.service_identity s where s.retired_by_entry_id = e.id), '[]'::jsonb))
  from lims.release_log_entry e
  where e.id = p_id
$$;
revoke execute on function lims.release_log_entry_content(uuid) from public;

create or replace function lims.save_record_version(p_lab_id uuid, p_table text, p_record_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  bytes bytea;
  latest record_version;
begin
  bytes := convert_to((case p_table
    when 'test' then test_content(p_lab_id, p_record_id)
    when 'test_report' then test_report_content(p_lab_id, p_record_id)
    when 'release_log_entry' then release_log_entry_content(p_record_id)
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id is not distinct from p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

-- A service identity declared or retired by an entry is part of that entry's content, so the entry is versioned once
-- the identities are written: the trigger fires on both tables. A retirement versions the retiring entry alone, so the
-- approved entry that declared the identity keeps its signed Record Version.
create or replace function lims.version_on_change() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  case tg_table_name
    when 'test' then perform version_test(r.lab_id, r.id);
    when 'result' then perform version_test(r.lab_id, r.test_id);
    when 'test_report' then perform save_record_version(r.lab_id, 'test_report', r.id);
    when 'sample' then perform version_test(lab_id, id) from test where lab_id = r.lab_id and sample_id = r.id;
    when 'method' then perform version_test(lab_id, id) from test where method_id = r.id;
    when 'submission' then perform version_test(t.lab_id, t.id) from test t
      join sample s on s.lab_id = t.lab_id and s.id = t.sample_id
      where s.submission_id = r.id;
    when 'customer' then perform version_test(t.lab_id, t.id) from test t
      join sample s on s.lab_id = t.lab_id and s.id = t.sample_id
      join submission sub on sub.id = s.submission_id
      where sub.customer_id = r.id;
    when 'release_log_entry' then perform save_record_version(null, 'release_log_entry', r.id);
    when 'service_identity' then
      perform save_record_version(null, 'release_log_entry',
                                  case when tg_op = 'INSERT' then r.created_by_entry_id else r.retired_by_entry_id end);
  end case;
  return null;
end $$;

create trigger version_record after insert or update or delete on lims.release_log_entry
  for each row execute function lims.version_on_change();
create trigger version_record after insert or update or delete on lims.service_identity
  for each row execute function lims.version_on_change();

-- The Audit Trail capture now also holds a record to the data class of the deployment it was created under, and holds
-- a service identity to the scope its approved Release Log entry declares. The scope binds once a Release Log entry
-- declaring a service identity is approved, and always on the real data class. The seed approves its identities
-- entry, so a fresh database is held to it from the seed on. A database that held people before the Release Log keeps
-- its service identities unscoped, as before #102, until a Platform Operator approves the identities entry this
-- migration records for it, or any entry declaring a service identity; approving an entry that declares none leaves
-- sign-in working (deploy/README.md). The database
-- owner acting outside the LIMS is exempt, as from Identity Verification (0015): the owner's writes are captured all
-- the same.
create or replace function lims.capture() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  e audit_entry;
begin
  e.actor  := nullif(current_setting('lims.actor', true), '');
  e.role   := nullif(current_setting('lims.role', true), '');
  e.reason := nullif(current_setting('lims.reason', true), '');
  if e.actor is null or e.role is null or e.reason is null then
    raise exception 'an audited write needs an actor, a role and a reason' using errcode = 'LA001';
  end if;
  e.table_name := tg_table_name;
  e.op := tg_op;
  if tg_op <> 'INSERT' then e.old_row := to_jsonb(old) - 'password_hash'; end if;
  if tg_op <> 'DELETE' then e.new_row := to_jsonb(new) - 'password_hash'; end if;
  if tg_op = 'UPDATE' and tg_table_name <> 'deployment'
     and e.new_row ->> 'data_class' is distinct from e.old_row ->> 'data_class' then
    raise exception 'a record keeps the data class it was created under' using errcode = 'LA011';
  end if;
  if tg_op = 'INSERT' and tg_table_name <> 'deployment'
     and e.new_row ->> 'data_class' is distinct from current_data_class()::text then
    raise exception 'a record takes the data class of the deployment it is created under' using errcode = 'LA011';
  end if;
  if e.actor like 'svc:%'
     and not (select rolsuper from pg_roles where rolname = session_user)
     and (exists (select from service_identity d where release_log_entry_approved(d.created_by_entry_id))
          or current_data_class() = 'real')
     and not exists (select from service_identity s
                      where s.name = e.actor and (tg_table_name || ':' || tg_op) = any (s.scope)
                        and release_log_entry_approved(s.created_by_entry_id)
                        and (s.retired_by_entry_id is null or not release_log_entry_approved(s.retired_by_entry_id))) then
    raise exception 'the service identity % is not declared to % %, or its Release Log entry is not approved',
      e.actor, lower(tg_op), tg_table_name using errcode = 'LA011';
  end if;
  e.chain := coalesce(coalesce(e.new_row, e.old_row) ->> 'lab_id', 'company');

  -- A UUID no caller can choose, hashed from the cluster, the server's start and the transaction. A restore, logical or
  -- physical, starts a new server, so a transaction number replayed after it never yields an ID seen before.
  e.transaction_id := md5((select system_identifier from pg_control_system())::text || ':'
                          || extract(epoch from pg_postmaster_start_time())::text || ':' || pg_current_xact_id()::text)::uuid;

  perform lock_chain(e.chain);
  select seq + 1, head into e.seq, e.prev_hash from audit_chain where chain = e.chain for update;
  e.at := clock_timestamp();
  e.hash := sha256(e.prev_hash || audit_entry_bytes(e));
  insert into audit_entry values (e.*);
  update audit_chain set seq = e.seq, head = e.hash where chain = e.chain;
  return null;
end $$;

grant select on lims.release_log_entry, lims.service_identity, lims.deployment to lims_app;
grant insert (kind, title, summary, release, image_digests, ci_run, ci_result, zap_baseline_result, sets_data_class, file_vault_personal_key, records_exceptions,
              lapses_exceptions, statement_version, statement) on lims.release_log_entry to lims_app;
grant insert (name, scope, created_by_entry_id) on lims.service_identity to lims_app;
grant update (retired_by_entry_id) on lims.service_identity to lims_app;
grant execute on function lims.current_data_class(), lims.fictional_records(), lims.fictional_accounts(uuid),
  lims.admins_with_another_role(), lims.release_log_entry_approved(uuid),
  lims.open_demo_exceptions(), lims.declare_data_class_change(), lims.scope_pairs(text[]),
  lims.image_digest_refs(text[]) to lims_app;

-- The seed approves its first Release Log entries with no password typed, so its re-authentication records say Seed,
-- and every Signature on them copies it. Only the transaction that seeds an empty database, or the database owner,
-- writes Seed (0015's exemption), and only on the fictional data class.
alter table lims.reauthentication drop constraint reauthentication_authenticator_check,
  add constraint reauthentication_authenticator_check check (authenticator in ('Password', 'Seed'));
create function lims.seed_authenticator_only_seeding() returns trigger language plpgsql as $$
begin
  if new.authenticator = 'Seed' and not (lims.seeding_or_owner() and lims.current_data_class() = 'fictional') then
    raise exception 'only the seed, on the fictional data class, records a re-authentication no one typed a password for'
      using errcode = 'LA010';
  end if;
  return new;
end $$;
create trigger seed_authenticator_only_seeding before insert on lims.reauthentication
  for each row execute function lims.seed_authenticator_only_seeding();

-- lims.sign, with a company record's Record Version (no Lab) signable from any Lab the signer acts in.
create or replace function lims.sign(p_reauthentication_id uuid, p_session_id uuid, p_record_table text, p_record_id uuid,
                          p_seen_version uuid, p_seen_hash bytea, p_statement_version integer, p_meaning lims.meaning,
                          p_app_release text)
returns uuid
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  actor        text := current_setting('lims.actor', true);
  acting_as    text := current_setting('lims.role', true);
  signer       person;
  proof        reauthentication;
  held         membership;
  seen         record_version;
  signed       record_version;
  shown        signature_statement;
  proof_xmin   xid;
  signature_id uuid := gen_random_uuid();
begin
  if num_nulls(p_reauthentication_id, p_session_id, p_record_table, p_record_id, p_seen_version, p_seen_hash,
               p_statement_version, p_meaning, p_app_release) > 0 then
    raise exception 'a signing names its re-authentication record, session, record, shown version and hash, statement version, meaning and release'
      using errcode = 'LA010';
  end if;
  if actor is null or actor not like 'person:%' then
    raise exception 'only a person signs; % is a service identity', coalesce(actor, 'no actor') using errcode = 'LA010';
  end if;
  select * into signer from person where username = substr(actor, 8);
  if signer.id is null then
    raise exception 'the signer % is not a known person', actor using errcode = 'LA010';
  end if;
  if signer.locked_at is not null then
    raise exception 'the signer''s account is locked' using errcode = 'LA010';
  end if;
  if signer.password_hash is null then
    raise exception 'the signer has no credential of their own to re-enter' using errcode = 'LA010';
  end if;

  select * into proof from reauthentication where id = p_reauthentication_id;
  select xmin into proof_xmin from reauthentication where id = p_reauthentication_id;
  if proof.id is null then
    raise exception 'no re-authentication record: the signer has not re-entered their credentials' using errcode = 'LA010';
  end if;
  if not written_here(proof_xmin) then
    raise exception 'the re-authentication record was written by an earlier transaction' using errcode = 'LA010';
  end if;
  if proof.person_id <> signer.id then
    raise exception 'the re-authentication record is another person''s' using errcode = 'LA010';
  end if;
  if proof.session_id <> p_session_id then
    raise exception 'the re-authentication record was given on another session' using errcode = 'LA010';
  end if;
  if proof.meaning <> p_meaning then
    raise exception 'the re-authentication record was given to sign %, not %', proof.meaning, p_meaning using errcode = 'LA010';
  end if;
  if exists (select from signature where reauthentication_id = proof.id) then
    raise exception 'the re-authentication record is already used by a Signature' using errcode = 'LA010';
  end if;
  if not exists (select from session where lab_id = proof.lab_id and id = proof.session_id and ended_at is null) then
    raise exception 'the re-authentication record''s session has ended' using errcode = 'LA010';
  end if;
  select * into held from membership
    where lab_id = proof.lab_id and person_id = signer.id and role::text = acting_as;
  if held.role is null then
    raise exception 'the signer does not hold the role % in this Lab', coalesce(acting_as, 'none') using errcode = 'LA010';
  end if;
  if not exists (select from signing_role where role = held.role and meaning = p_meaning) then
    raise exception 'the role % does not give the Signature Meaning %', held.role, p_meaning using errcode = 'LA010';
  end if;

  select * into seen from record_version where id = p_seen_version and (lab_id = proof.lab_id or lab_id is null);
  if seen.id is null then
    raise exception 'the Record Version shown is not one of this Lab''s' using errcode = 'LA010';
  end if;
  if seen.content_hash <> p_seen_hash then
    raise exception 'the hash shown is not the hash of Record Version %', seen.version using errcode = 'LA010';
  end if;
  if exists (select from record_version v
              where v.lab_id is not distinct from seen.lab_id and v.record_table = seen.record_table and v.record_id = seen.record_id
                and v.version > seen.version and not written_here(v.xmin)) then
    raise exception 'the record changed after the signer saw it; it must be read again before signing' using errcode = 'LA010';
  end if;
  select * into signed from record_version
    where lab_id is not distinct from (case when p_record_table = 'release_log_entry' then null else proof.lab_id end)
      and record_table = p_record_table and record_id = p_record_id
    order by version desc limit 1;
  if signed.id is null then
    raise exception 'there is no Record Version of % % to sign', p_record_table, p_record_id using errcode = 'LA010';
  end if;
  if (signed.record_table, signed.record_id) <> (seen.record_table, seen.record_id) then
    if exists (select from record_version v
                where v.lab_id is not distinct from signed.lab_id and v.record_table = signed.record_table and v.record_id = signed.record_id
                  and not written_here(v.xmin)) then
      raise exception 'the % signed is not the record shown, nor one this signing created', p_record_table using errcode = 'LA010';
    end if;
    if not exists (select from test_report r
                    where r.lab_id = signed.lab_id and r.id = signed.record_id and signed.record_table = 'test_report'
                      and seen.record_table = 'test' and r.test_id = seen.record_id) then
      raise exception 'the % signed is not built on the Test shown',
        case p_record_table when 'test_report' then 'Test Report' else p_record_table end using errcode = 'LA010';
    end if;
  end if;

  select * into shown from signature_statement order by version desc limit 1;
  if shown.version <> p_statement_version then
    raise exception 'the signature statement changed to version % after the signer saw version %; it must be read again before signing',
      shown.version, p_statement_version using errcode = 'LA010';
  end if;

  perform set_this_transaction('lims.signing', proof.id::text);
  insert into signature (lab_id, id, person_id, printed_name, username, role, meaning, record_version_id, content_hash,
                         canonical_form, statement_version, statement_hash, authenticator, session_id, app_release,
                         reauthentication_id)
  values (proof.lab_id, signature_id, signer.id, signer.display_name, signer.username, held.role, p_meaning, signed.id,
          signed.content_hash, signed.canonical_form, shown.version, shown.statement_hash, proof.authenticator,
          proof.session_id, p_app_release, proof.id);
  perform set_this_transaction('lims.signing', '');
  return signature_id;
end $$;

-- A database that held people before the Release Log (the hosted demo) gets the entry declaring the service identities
-- the seed declares, unapproved, for the Platform Operator to approve (deploy/README.md).
do $$
declare
  entry_id uuid;
begin
  if not exists (select from lims.person) then return; end if;
  perform set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
          set_config('lims.reason', 'Declare the service identities the LIMS already acts as', true);
  insert into lims.release_log_entry (kind, title, summary)
  values ('ConfigurationChange', 'Service identities of the API and the seed',
          'Declares svc:seed, svc:sign-in, svc:session-sweep, svc:incident and the writes each may make.')
  returning id into entry_id;
  insert into lims.service_identity (name, scope, created_by_entry_id) values
    ('svc:seed', '{customer:INSERT,method:INSERT,lab:INSERT,room:INSERT,person:INSERT,membership:INSERT,training_record:INSERT,release_log_entry:INSERT,service_identity:INSERT}', entry_id),
    ('svc:sign-in', '{access_event:INSERT,person:UPDATE,credential_link:UPDATE}', entry_id),
    ('svc:session-sweep', '{access_event:INSERT}', entry_id),
    ('svc:incident', '{system_incident:INSERT}', entry_id);
end $$;

set local role lims_owner;

-- One saved state of a signable record, written by the database whenever the record's canonical content changes.
-- Earlier versions are kept, so a Signature binds to the version it was given on and shows as unsigned once the
-- record has a later one. The content is bytes and the hash is generated from them, so neither can be re-derived
-- differently later. canonical_form 0 is the thin slice's rendering (moved here below); 1 is the rendering of the
-- functions in this migration.
create table lims.record_version (
  lab_id         uuid        not null references lims.lab,
  id             uuid        not null default gen_random_uuid(),
  record_table   text        not null check (record_table in ('test', 'test_report')),
  record_id      uuid        not null,
  version        integer     not null check (version >= 1),
  canonical_form integer     not null check (canonical_form in (0, 1)),
  content        bytea       not null,
  content_hash   bytea       not null generated always as (sha256(content)) stored,
  saved_at       timestamptz not null default clock_timestamp(),
  primary key (lab_id, id),
  unique (lab_id, record_table, record_id, version)
);

-- Canonical form 1 of a Test: the fields its Signatures cover, rendered by jsonb (its own key order, one space after
-- each colon and comma), in UTF-8. Times and dates are rendered explicitly so the bytes never depend on the session's
-- TimeZone or DateStyle. A change to this rendering is a new canonical form, never an edit of this one.
create function lims.test_content(p_lab_id uuid, p_test_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id,
    'customer', c.name,
    'sample', s.number,
    'description', s.description,
    'receivedAt', to_char(s.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'method', m.code,
    'methodVersion', m.version,
    'methodTitle', m.title,
    'gxpClass', t.gxp_class,
    'analyte', r.analyte,
    'value', r.value,
    'unit', r.unit,
    'injectionSequenceRef', r.injection_sequence_ref,
    'notebookRef', r.notebook_ref,
    'performedOn', to_char(r.performed_on, 'YYYY-MM-DD'))
  from lims.test t
  join lims.sample s on s.lab_id = t.lab_id and s.id = t.sample_id
  join lims.submission sub on sub.id = s.submission_id
  join lims.customer c on c.id = sub.customer_id
  join lims.method m on m.id = t.method_id
  left join lims.result r on r.lab_id = t.lab_id and r.test_id = t.id
  where t.lab_id = p_lab_id and t.id = p_test_id
$$;

-- Canonical form 1 of a Test Report: its number and the Test it is built on, so a change to the Test changes it.
create function lims.test_report_content(p_lab_id uuid, p_report_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', tr.id, 'number', tr.number, 'test', lims.test_content(tr.lab_id, tr.test_id))
  from lims.test_report tr
  where tr.lab_id = p_lab_id and tr.id = p_report_id
$$;

-- Writes the next Record Version of one record when its canonical content differs from the latest version's. It takes
-- no lock of its own: capture() fires before it on the changed row (triggers fire in name order) and holds the Lab
-- chain's row lock to commit, so one transaction at a time versions a Lab's records.
create function lims.save_record_version(p_lab_id uuid, p_table text, p_record_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  bytes bytea;
  latest record_version;
begin
  bytes := convert_to((case p_table
    when 'test' then test_content(p_lab_id, p_record_id)
    when 'test_report' then test_report_content(p_lab_id, p_record_id)
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id = p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

-- A Test and the Test Report built on it are versioned together: what changes the Test changes the report.
create function lims.version_test(p_lab_id uuid, p_test_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform save_record_version(p_lab_id, 'test', p_test_id);
  perform save_record_version(lab_id, 'test_report', id) from test_report
    where lab_id = p_lab_id and test_id = p_test_id;
end $$;

-- A change to a record, to a child, or to a company record a Test names re-versions every Test that holds it.
create function lims.version_on_change() returns trigger
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
  end case;
  return null;
end $$;

revoke execute on function lims.test_content(uuid, uuid), lims.test_report_content(uuid, uuid),
  lims.save_record_version(uuid, text, uuid), lims.version_test(uuid, uuid) from public;

do $$
declare
  t text;
begin
  execute 'create trigger capture after insert or update or delete on lims.record_version
           for each row execute function lims.capture()';
  execute 'create trigger refuse_change before update or delete on lims.record_version
           for each row execute function lims.refuse_change()';
  execute 'create trigger refuse_truncate before truncate on lims.record_version
           for each statement execute function lims.refuse_change()';
  foreach t in array array['test', 'result', 'test_report', 'sample', 'submission', 'method', 'customer'] loop
    execute format('create trigger version_record after insert or update or delete on lims.%I
                    for each row execute function lims.version_on_change()', t);
  end loop;
end $$;

-- A Signature binds to one Record Version, which names the record and holds the content, so the Signature
-- carries neither of its own any more.
alter table lims.signature add column record_version_id uuid;

-- The thin slice's Signatures hold the content they signed, rendered by the API (canonical form 0). Each distinct
-- signed content becomes a Record Version in form 0, numbered in signing order; then every Test and Test Report gets
-- its form-1 version of what it holds now. A Signature whose signed content still says what the record says (the same
-- fields; the received time to the millisecond, which is all form 0 kept) binds to that form-1 version and stays
-- signed. One that differs binds to its form-0 version, and shows as unsigned because a later version exists. This is
-- the one time Signature rows are updated; the Audit Trail records it under svc:migrate.
select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Move the thin slice''s signed content onto Record Versions', true);
insert into lims.record_version (lab_id, record_table, record_id, version, canonical_form, content)
select lab_id, record_table, record_id,
       dense_rank() over (partition by lab_id, record_table, record_id order by min(signed_at)), 0, content
  from lims.signature
 group by lab_id, record_table, record_id, content;
do $$ begin perform lims.version_test(lab_id, id) from lims.test; end $$;
create function pg_temp.signed_content_holds(signed bytea, current jsonb, record_table text) returns boolean
language sql immutable as $$
  with f0 as (select convert_from(signed, 'UTF8')::jsonb as j),
       f1 as (select case record_table when 'test' then current else current -> 'test' end as j)
  select (f0.j - 'report' - 'receivedAt') = (f1.j - 'receivedAt')
     and left(f0.j ->> 'receivedAt', 23) is not distinct from left(f1.j ->> 'receivedAt', 23)
     and (record_table = 'test' or f0.j ->> 'report' = current ->> 'number')
  from f0, f1
$$;
alter table lims.signature disable trigger refuse_change;
update lims.signature s
   set record_version_id = coalesce(
     (select v.id from lims.record_version v
       where v.lab_id = s.lab_id and v.record_table = s.record_table and v.record_id = s.record_id
         and v.canonical_form = 1
         and pg_temp.signed_content_holds(s.content, convert_from(v.content, 'UTF8')::jsonb, s.record_table)),
     (select v.id from lims.record_version v
       where v.lab_id = s.lab_id and v.record_table = s.record_table and v.record_id = s.record_id
         and v.content = s.content));
alter table lims.signature enable trigger refuse_change;
drop function pg_temp.signed_content_holds(bytea, jsonb, text);

alter table lims.signature
  alter column record_version_id set not null,
  add foreign key (lab_id, record_version_id) references lims.record_version,
  drop column content_hash,
  drop column content,
  drop column record_table,
  drop column record_id;

grant select on lims.record_version to lims_app;
grant insert (record_version_id) on lims.signature to lims_app;

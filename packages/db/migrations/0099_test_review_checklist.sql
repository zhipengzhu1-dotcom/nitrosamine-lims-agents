set local role lims_owner;

-- Review Checklists (#110). A checklist version is a company record of numbered items: a ticked item the reviewer
-- ticks, or an evidence item whose value the server shows and the reviewer never ticks. A version acts only once QA
-- signs it Approved, and every version, draft or approved, is insert-only, so a correction is a new version.
create table lims.evidence_source (
  source text not null primary key check (source ~ '^[a-z][A-Za-z]*$'),
  kind   text not null check (kind in ('Run', 'Test', 'Released')),
  unique (source, kind)
);

create table lims.review_checklist_version (
  id       uuid        not null primary key default gen_random_uuid(),
  kind     text        not null check (kind in ('Run', 'Test', 'Released')),
  version  integer     not null check (version > 0),
  saved_at timestamptz not null default now(),
  saved_by text        not null,
  unique (kind, version),
  unique (id, kind)
);

create table lims.review_checklist_item (
  version_id    uuid    not null,
  kind          text    not null,
  position      integer not null check (position > 0),
  key           text    not null check (key ~ '^[a-z][A-Za-z]*$'),
  text          text    not null check (btrim(text) <> ''),
  ticked        boolean not null,
  needs_comment boolean not null default false,
  evidence      text,
  primary key (version_id, key),
  unique (version_id, position),
  foreign key (version_id, kind) references lims.review_checklist_version (id, kind),
  foreign key (evidence, kind) references lims.evidence_source (source, kind),
  constraint review_checklist_item_ticked_or_evidence check (ticked = (evidence is null)),
  constraint review_checklist_item_comment_on_ticked check (not (evidence is not null and needs_comment))
);

-- A Test Review is what a Reviewer ticked on the Test checklist in force, with a comment where one is written. The
-- Reviewed Signature binds it, not the Test: its content names the Test's Record Version, so a change to the Test
-- re-versions the review and leaves the Reviewed Signature unsigned.
create table lims.test_review (
  lab_id               uuid        not null,
  id                   uuid        not null default gen_random_uuid(),
  test_id              uuid        not null,
  checklist_version_id uuid        not null,
  checklist_kind       text        not null default 'Test' check (checklist_kind = 'Test'),
  ticks                jsonb       not null check (jsonb_typeof(ticks) = 'object'),
  saved_at             timestamptz not null default now(),
  saved_by             text        not null,
  primary key (lab_id, id),
  foreign key (lab_id, test_id) references lims.test (lab_id, id),
  foreign key (checklist_version_id, checklist_kind) references lims.review_checklist_version (id, kind)
);

-- Who saved a version or a review is the session's actor, never a value the client sends.
create function lims.stamp_saver() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  new.saved_by := current_setting('lims.actor', true);
  if new.saved_by is null or new.saved_by = '' then
    raise exception 'a % is saved only by a named actor', tg_table_name using errcode = 'LA001';
  end if;
  return new;
end $$;

create function lims.check_test_review_ticks() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if jsonb_typeof(new.ticks) is distinct from 'object' then
    return new; -- test_review_ticks_check or the not null refuses it
  end if;
  if exists (select from jsonb_each(new.ticks) t
              where not exists (select from review_checklist_item i
                                 where i.version_id = new.checklist_version_id and i.key = t.key and i.ticked)) then
    raise exception 'a Test Review ticks only the ticked items of its checklist version' using errcode = '23514';
  end if;
  if exists (select from jsonb_each(new.ticks) t
              where case when jsonb_typeof(t.value) <> 'object' then true
                         else coalesce((select array_agg(k) from jsonb_object_keys(t.value) k), '{}') <> array['comment']
                           or jsonb_typeof(t.value -> 'comment') not in ('string', 'null') end) then
    raise exception 'each tick of a Test Review holds only its comment, a string or null' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger stamp_saver before insert on lims.review_checklist_version
  for each row execute function lims.stamp_saver();
create trigger stamp_saver before insert on lims.test_review
  for each row execute function lims.stamp_saver();
create trigger test_review_ticks before insert on lims.test_review
  for each row execute function lims.check_test_review_ticks();

do $$
declare
  t text;
begin
  foreach t in array array['evidence_source', 'review_checklist_version', 'review_checklist_item', 'test_review'] loop
    execute format('create trigger capture after insert or update or delete on lims.%I
                    for each row execute function lims.capture()', t);
    execute format('create trigger refuse_change before update or delete on lims.%I
                    for each row execute function lims.refuse_change()', t);
    execute format('create trigger refuse_truncate before truncate on lims.%I
                    for each statement execute function lims.refuse_change()', t);
  end loop;
end $$;

-- The canonical content of a checklist version, which its Record Version holds and the Approved signer is shown.
create function lims.review_checklist_content(p_version_id uuid) returns jsonb
language sql stable set search_path = lims, pg_temp as $$
  select jsonb_build_object('kind', v.kind, 'version', v.version, 'items',
           coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'key', i.key, 'text', i.text,
                                        'ticked', i.ticked, 'needsComment', i.needs_comment, 'evidence', i.evidence)
                                      order by i.position)
                       from review_checklist_item i where i.version_id = v.id), '[]'::jsonb))
    from review_checklist_version v where v.id = p_version_id
$$;

create function lims.review_checklist_content_hash(p_version_id uuid) returns bytea
language sql stable set search_path = lims, pg_temp as $$
  select sha256(convert_to(review_checklist_content(p_version_id)::text, 'UTF8'))
$$;

-- The version of a kind in force: the highest one QA has signed Approved.
create function lims.review_checklist_in_force(p_kind text) returns uuid
language sql stable security definer set search_path = lims, pg_temp as $$
  select v.id from review_checklist_version v
   where v.kind = p_kind
     and exists (select from signature s
                   join record_version rv on rv.lab_id = s.lab_id and rv.id = s.record_version_id
                  where rv.record_table = 'review_checklist_version' and rv.record_id = v.id and s.meaning = 'Approved')
   order by v.version desc limit 1
$$;

-- The value of an evidence item as the server computes it, as label and value pairs. Only the Test's Performed
-- Signature is wired; the Run sources arrive with the Run (#147), and no Test checklist can name one.
create function lims.review_evidence(p_lab_id uuid, p_test_id uuid, p_source text) returns jsonb
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  found jsonb;
begin
  if p_source <> 'performedSignature' then
    raise exception 'the evidence source % is not wired yet', p_source using errcode = 'LA014';
  end if;
  select jsonb_build_object('Signed by', s.printed_name, 'Role', s.role::text,
           'Signed at (UTC)', to_char(s.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'On the current version', case when rv.version = latest.version then 'Yes' else 'No' end)
    into found
    from signature s
    join record_version rv on rv.lab_id = s.lab_id and rv.id = s.record_version_id
    cross join lateral (select max(version) as version from record_version
                         where lab_id = p_lab_id and record_table = 'test' and record_id = p_test_id) latest
   where rv.lab_id = p_lab_id and rv.record_table = 'test' and rv.record_id = p_test_id and s.meaning = 'Performed'
   order by s.signed_at desc limit 1;
  return coalesce(found, jsonb_build_object('Performed Signature', 'None'));
end $$;

-- The canonical content of a Test Review: the Test's Record Version it was ticked against, the checklist version,
-- each tick with its comment, and the evidence values the server showed. One hash covers them all.
create function lims.test_review_content(p_lab_id uuid, p_review_id uuid) returns jsonb
language sql stable security definer set search_path = lims, pg_temp as $$
  select jsonb_build_object(
    'test', (select jsonb_build_object('id', rv.record_id, 'version', rv.version, 'contentHash', encode(rv.content_hash, 'hex'))
               from record_version rv
              where rv.lab_id = r.lab_id and rv.record_table = 'test' and rv.record_id = r.test_id
              order by rv.version desc limit 1),
    'checklist', jsonb_build_object('kind', v.kind, 'version', v.version,
                                    'contentHash', encode(review_checklist_content_hash(v.id), 'hex')),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('key', i.key, 'text', i.text,
                                                           'comment', r.ticks -> i.key -> 'comment') order by i.position)
                         from review_checklist_item i
                        where i.version_id = v.id and i.ticked and r.ticks ? i.key), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('key', i.key, 'text', i.text,
                                                              'value', review_evidence(r.lab_id, r.test_id, i.evidence))
                                           order by i.position)
                            from review_checklist_item i
                           where i.version_id = v.id and not i.ticked), '[]'::jsonb))
    from test_review r join review_checklist_version v on v.id = r.checklist_version_id
   where r.lab_id = p_lab_id and r.id = p_review_id
$$;

alter table lims.record_version
  drop constraint record_version_record_table_check,
  add constraint record_version_record_table_check
    check (record_table in ('test', 'test_report', 'system_incident', 'equipment', 'equipment_event', 'test_review',
                            'review_checklist_version'));

create or replace function lims.save_record_version(p_lab_id uuid, p_table text, p_record_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  bytes bytea;
  latest record_version;
begin
  bytes := convert_to((case p_table
    when 'test' then test_content(p_lab_id, p_record_id)
    when 'test_report' then test_report_content(p_lab_id, p_record_id)
    when 'system_incident' then incident_content(p_record_id)
    when 'equipment' then (select equipment_content(e) from equipment e where e.lab_id = p_lab_id and e.id = p_record_id)
    when 'equipment_event' then
      (select equipment_event_content(v) from equipment_event v where v.lab_id = p_lab_id and v.id = p_record_id)
    when 'test_review' then test_review_content(p_lab_id, p_record_id)
    when 'review_checklist_version' then review_checklist_content(p_record_id)
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id = p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

-- A Test, the Test Report built on it and every Test Review of it are versioned together.
create or replace function lims.version_test(p_lab_id uuid, p_test_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform save_record_version(p_lab_id, 'test', p_test_id);
  perform save_record_version(lab_id, 'test_report', id) from test_report
    where lab_id = p_lab_id and test_id = p_test_id;
  perform save_record_version(lab_id, 'test_review', id) from test_review
    where lab_id = p_lab_id and test_id = p_test_id;
end $$;

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
    when 'test_review' then perform save_record_version(r.lab_id, 'test_review', r.id);
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

create trigger version_record after insert on lims.test_review
  for each row execute function lims.version_on_change();

-- A checklist version is a company record; its Record Version is written in the Lab of the session that signs it
-- Approved, as for a System Incident, and only for the Approved signing re-authenticated in this transaction.
create function lims.version_review_checklist(p_reauthentication_id uuid, p_version_id uuid) returns uuid
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  proof      reauthentication;
  proof_xmin xid;
  latest     uuid;
begin
  select * into proof from reauthentication where id = p_reauthentication_id;
  select xmin into proof_xmin from reauthentication where id = p_reauthentication_id;
  if proof.id is null or not written_here(proof_xmin) or proof.meaning <> 'Approved' then
    raise exception 'a Review Checklist version is versioned only for the Approved signing re-authenticated in this transaction'
      using errcode = 'LA010';
  end if;
  perform save_record_version(proof.lab_id, 'review_checklist_version', p_version_id);
  select id into latest from record_version
    where lab_id = proof.lab_id and record_table = 'review_checklist_version' and record_id = p_version_id
    order by version desc limit 1;
  if latest is null then
    raise exception 'there is no Review Checklist version % to version', p_version_id using errcode = 'LA014';
  end if;
  return latest;
end $$;

-- Reviewed binds a Test Review complete on the Test checklist in force and saved by the signer; Approved binds a
-- checklist version once, and only one newer than the version in force.
create function lims.check_review_signing() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  signed  record_version;
  review  test_review;
  chosen  review_checklist_version;
  current review_checklist_version;
  missing text;
begin
  select * into signed from record_version where lab_id = new.lab_id and id = new.record_version_id;
  if signed.id is null then
    return new; -- signature_record_version_fkey refuses it
  end if;
  if (new.meaning = 'Reviewed') <> (signed.record_table = 'test_review') then
    raise exception 'Reviewed is the Signature Meaning of a Test Review, and a Test Review is signed only Reviewed'
      using errcode = 'LA010';
  end if;
  if signed.record_table = 'review_checklist_version' and new.meaning <> 'Approved' then
    raise exception 'a Review Checklist version is signed only Approved' using errcode = 'LA010';
  end if;
  if signed.record_table = 'test_review' then
    select * into review from test_review where lab_id = signed.lab_id and id = signed.record_id;
    if review.checklist_version_id is distinct from review_checklist_in_force('Test') then
      raise exception 'the Test Review was ticked on a Test Review Checklist version no longer in force' using errcode = 'LA010';
    end if;
    select i.text into missing from review_checklist_item i
     where i.version_id = review.checklist_version_id and i.ticked
       and (not review.ticks ? i.key or (i.needs_comment and coalesce(btrim(review.ticks -> i.key ->> 'comment'), '') = ''))
     order by i.position limit 1;
    if missing is not null then
      raise exception 'the Test Review is not complete: %', missing using errcode = 'LA010';
    end if;
    if review.saved_by <> (select 'person:' || p.username from person p where p.id = new.person_id) then
      raise exception 'a Reviewed Signature binds a Test Review the signer saved' using errcode = 'LA010';
    end if;
  elsif signed.record_table = 'review_checklist_version' then
    select * into chosen from review_checklist_version where id = signed.record_id;
    if exists (select from signature s join record_version rv on rv.lab_id = s.lab_id and rv.id = s.record_version_id
                where rv.record_table = 'review_checklist_version' and rv.record_id = chosen.id and s.meaning = 'Approved') then
      raise exception 'a Review Checklist version is signed Approved once' using errcode = 'LA010';
    end if;
    select * into current from review_checklist_version where id = review_checklist_in_force(chosen.kind);
    if current.version >= chosen.version then
      raise exception 'version % of the % Review Checklist is in force, so version % cannot be approved',
        current.version, chosen.kind, chosen.version using errcode = 'LA010';
    end if;
  end if;
  return new;
end $$;

create trigger review_signing before insert on lims.signature
  for each row execute function lims.check_review_signing();

revoke execute on function lims.stamp_saver(), lims.check_test_review_ticks(), lims.review_checklist_content(uuid),
  lims.review_checklist_content_hash(uuid), lims.review_checklist_in_force(text), lims.review_evidence(uuid, uuid, text),
  lims.test_review_content(uuid, uuid), lims.version_review_checklist(uuid, uuid), lims.check_review_signing() from public;
grant execute on function lims.review_checklist_content(uuid), lims.review_checklist_content_hash(uuid),
  lims.review_checklist_in_force(text), lims.review_evidence(uuid, uuid, text), lims.test_review_content(uuid, uuid),
  lims.version_review_checklist(uuid, uuid) to lims_app;
grant select on lims.evidence_source to lims_app;
grant select, insert on lims.review_checklist_version, lims.review_checklist_item, lims.test_review to lims_app;

-- Version 1 of each checklist, from the spec gaps decision (#45). None is in force until QA signs it Approved.
select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Seed version 1 of the Run, Test and Released Review Checklists (#45)', true);
do $$ begin
  perform lims.lock_chains('company');
end $$;

insert into lims.evidence_source (source, kind) values
  ('runChecks', 'Run'), ('runAdjustments', 'Run'), ('msTune', 'Run'), ('instrumentFitness', 'Run'),
  ('standardLots', 'Run'), ('performedSignature', 'Test');

with v as (
  insert into lims.review_checklist_version (kind, version, saved_by)
  values ('Run', 1, ''), ('Test', 1, ''), ('Released', 1, '') returning id, kind
)
insert into lims.review_checklist_item (version_id, kind, position, key, text, ticked, needs_comment, evidence)
select v.id, v.kind, i.position, i.key, i.text, i.evidence is null, i.needs_comment, i.evidence
  from v join (values
    ('Run', 1, 'runChecks', 'Each Run Check with its criterion, source and value (system suitability, S/N at the LOQ standard, CCV bracketing, ion ratio, blanks, check standard)', false, 'runChecks'),
    ('Run', 2, 'runAdjustments', 'Each Run Adjustment against its allowance', false, 'runAdjustments'),
    ('Run', 3, 'msTune', 'The MS tune and mass-calibration check', false, 'msTune'),
    ('Run', 4, 'instrumentFitness', 'Instrument Fitness Status', false, 'instrumentFitness'),
    ('Run', 5, 'standardLots', 'Reference-standard lots and their status', false, 'standardLots'),
    ('Run', 6, 'auditTrailReviewed', 'Audit trail reviewed', false, null),
    ('Run', 7, 'processingHistoryChecked', 'MassLynx processing history checked against the Integration Declaration', false, null),
    ('Run', 8, 'chromatogramsInspected', 'Chromatograms inspected, including the system suitability Injections', false, null),
    ('Run', 9, 'excludedInjectionsJustified', 'Excluded Injections justified', false, null),
    ('Run', 10, 'flagsAcknowledged', 'Outlier, OOT, trend and Conditional Pass flags acknowledged with a comment', true, null),
    ('Run', 11, 'notebookEntriesRead', 'Linked Notebook Entries read', false, null),
    ('Test', 1, 'auditTrailReviewed', 'Audit trail reviewed', false, null),
    ('Test', 2, 'calculationsChecked', 'Calculations checked', false, null),
    ('Test', 3, 'variabilityReviewed', 'Variability and mixed-pair outcomes reviewed', false, null),
    ('Test', 4, 'excludedValuesReasoned', 'Every excluded value carries its reason', false, null),
    ('Test', 5, 'basisCorrectionTraced', 'The basis correction traced to its water or LOD result', false, null),
    ('Test', 6, 'versionsAccepted', 'Method, Specification and Decision Rule versions are the ones accepted', false, null),
    ('Test', 7, 'methodDepartureRecorded', 'Any Method departure is recorded for the report', false, null),
    ('Test', 8, 'flagsAcknowledged', 'Flags acknowledged with a comment', true, null),
    ('Test', 9, 'notebookEntriesRead', 'Linked Notebook Entries read', false, null),
    ('Released', 1, 'auditTrailReviewed', 'Audit trail reviewed', false, null),
    ('Released', 2, 'verdictsConfirmed', 'Each verdict confirmed or disagreed', false, null),
    ('Released', 3, 'noOpenHold', 'No open Hold', false, null),
    ('Released', 4, 'signaturesValid', 'Signatures valid on current versions', false, null),
    ('Released', 5, 'reportChecked', 'The rendered report checked against the records (Customer, Sample IDs, condition at receipt, Method, units, disclaimers, accreditation marking against the frozen scope)', false, null)
  ) as i (kind, position, key, text, needs_comment, evidence) on i.kind = v.kind;

-- 0037 (#129) already gives QA Approved for Equipment, so the row is kept once.
insert into lims.signing_role (role, meaning) values ('QA', 'Approved') on conflict do nothing;

-- Critical Data Changes on saved values (#105; ADR 0001; #45). A saved Result value changes only through an approved
-- Critical Data Change: a proposal, then one decision (Approved, Rejected or Withdrawn). Every step off the normal path
-- takes its reason from the picklist store. A step refused by who takes it or what it carries raises LA017; one that
-- meets a change already pending raises LA018, one that meets the record changed since it was read LA019, and one on a
-- Test in the wrong state LA020, so the API answers each as the step registry would.

set local role lims_owner;

select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Build Critical Data Changes and the picklist reasons', true);

-- The shared picklist store (#45 gap 6): each step off the normal path offers its own reasons, ending with "Other",
-- which takes free text. A company record: an entry changes only through a migration, and capture() audits it.
create table lims.picklist_reason (
  id        uuid    not null default gen_random_uuid() primary key,
  step      text    not null check (step ~ '^[a-z][A-Za-z]+$'),
  position  integer not null check (position > 0),
  label     text    not null check (label ~ '\S'),
  needs_text boolean not null generated always as (label = 'Other') stored,
  unique (step, position),
  unique (step, label)
);

-- An Approved decision is a Reviewer's Signature with the meaning Approved (#45: a Reviewer approves result corrections
-- after Performed).
insert into lims.signing_role (role, meaning) values ('Reviewer', 'Approved');

-- A proposal to change one saved value. It is never edited: what happens to it is its one decision row.
create table lims.critical_data_change (
  lab_id              uuid        not null references lims.lab,
  id                  uuid        not null default gen_random_uuid(),
  test_id             uuid        not null,
  result_id           uuid        not null,
  field               text        not null check (field = 'value'),
  old_value           text        not null check (old_value ~ '^-?[0-9]+(\.[0-9]+)?$'),
  new_value           text        not null check (new_value ~ '^-?[0-9]+(\.[0-9]+)?$'),
  reason_id           uuid        not null references lims.picklist_reason,
  reason_text         text        check (reason_text ~ '\S'),
  proposed_by         uuid        not null references lims.person,
  proposed_at         timestamptz not null default clock_timestamp(),
  proposed_on_version uuid        not null,
  primary key (lab_id, id),
  unique (lab_id, id, test_id),
  constraint critical_data_change_values_differ_check check (new_value <> old_value),
  foreign key (lab_id, test_id) references lims.test,
  foreign key (lab_id, result_id) references lims.result,
  foreign key (lab_id, proposed_on_version) references lims.record_version
);

create type lims.change_outcome as enum ('Approved', 'Rejected', 'Withdrawn');

-- What became of a proposal: one row, so a decided proposal can never be decided again.
create table lims.critical_data_change_decision (
  lab_id       uuid                not null references lims.lab,
  id           uuid                not null default gen_random_uuid(),
  change_id    uuid                not null,
  test_id      uuid                not null,
  outcome      lims.change_outcome not null,
  decided_by   uuid                not null references lims.person,
  decided_at   timestamptz         not null default clock_timestamp(),
  reason_id    uuid                references lims.picklist_reason,
  reason_text  text                check (reason_text ~ '\S'),
  signature_id uuid,
  primary key (lab_id, id),
  unique (lab_id, change_id),
  constraint decision_signed_only_if_approved_check check ((outcome = 'Approved') = (signature_id is not null)),
  constraint decision_reason_unless_approved_check check ((outcome = 'Approved') = (reason_id is null)),
  constraint decision_text_unless_approved_check check (outcome <> 'Approved' or reason_text is null),
  foreign key (lab_id, change_id, test_id) references lims.critical_data_change (lab_id, id, test_id),
  foreign key (lab_id, signature_id) references lims.signature
);

-- The person the transaction acts as, for the columns the database stamps.
create function lims.acting_person() returns uuid
language sql stable set search_path = lims, pg_temp as $$
  select id from person where 'person:' || username = current_setting('lims.actor', true)
$$;

alter table lims.critical_data_change
  alter column proposed_by set default lims.acting_person();
alter table lims.critical_data_change_decision
  alter column decided_by set default lims.acting_person();

-- A reason is one of the step's own picklist entries, and "Other" carries the free text.
create function lims.check_picklist_reason(p_step text, p_reason uuid, p_text text) returns void
language plpgsql stable set search_path = lims, pg_temp as $$
declare
  chosen picklist_reason;
begin
  select * into chosen from picklist_reason where id = p_reason;
  if chosen.step is distinct from p_step then
    raise exception 'the reason is not one the % step offers', p_step using errcode = 'LA017';
  end if;
  if chosen.needs_text and p_text is null then
    raise exception 'the reason Other needs its text' using errcode = 'LA017';
  end if;
  if not chosen.needs_text and p_text is not null then
    raise exception 'only the reason Other takes text' using errcode = 'LA017';
  end if;
end $$;

-- A proposal is made by the person acting, against the Result's value as it stands, while no other proposal on that
-- Result is pending; it records the Test's Record Version it was made on.
create function lims.propose_critical_data_change() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  current_value text;
  proposed_on   test;
begin
  -- Holds the Lab's chain before the pending check, so of two proposals at once the second sees the first.
  perform lock_chains(new.lab_id::text);
  if new.proposed_by is distinct from acting_person() then
    raise exception 'a Critical Data Change is proposed by the person acting' using errcode = 'LA017';
  end if;
  select * into proposed_on from test where lab_id = new.lab_id and id = new.test_id;
  if proposed_on.assignee_id is distinct from new.proposed_by or not exists (
    select from membership m
     where m.lab_id = new.lab_id and m.person_id = new.proposed_by and m.role = 'Analyst'
       and current_setting('lims.role', true) = 'Analyst') then
    raise exception 'a Critical Data Change is proposed by the assigned Analyst, acting as Analyst' using errcode = 'LA017';
  end if;
  if proposed_on.state not in ('SubmittedForReview', 'Reviewed') then
    raise exception 'a Critical Data Change is proposed on a Test in SubmittedForReview or Reviewed state, not %',
      proposed_on.state using errcode = 'LA020';
  end if;
  select value into current_value from result where lab_id = new.lab_id and id = new.result_id and test_id = new.test_id;
  if current_value is distinct from new.old_value then
    raise exception 'the old value is not the Result''s current value' using errcode = 'LA019';
  end if;
  if exists (select from critical_data_change c
              where c.lab_id = new.lab_id and c.result_id = new.result_id
                and not exists (select from critical_data_change_decision d
                                 where d.lab_id = c.lab_id and d.change_id = c.id)) then
    raise exception 'a Critical Data Change on this Result is already pending' using errcode = 'LA018';
  end if;
  perform check_picklist_reason('proposeChange', new.reason_id, new.reason_text);
  new.proposed_at := clock_timestamp();
  select id into new.proposed_on_version from record_version
    where lab_id = new.lab_id and record_table = 'test' and record_id = new.test_id
    order by version desc limit 1;
  return new;
end $$;

create trigger propose before insert on lims.critical_data_change
  for each row execute function lims.propose_critical_data_change();

-- Withdrawn only by the proposer; Approved or Rejected only by someone else. An Approved decision names the Approved
-- Signature this transaction gave on the proposal's latest Record Version, by the person deciding, and holds only while
-- the Test still reads as it did when the change was proposed.
create function lims.decide_critical_data_change() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  change  critical_data_change;
  signed  record;
begin
  -- Holds the Lab's chain before the decision row exists, as a proposal does, so of two decisions at once the second
  -- waits here for the first to commit instead of deadlocking on the one decision a change takes.
  perform lock_chains(new.lab_id::text);
  select * into change from critical_data_change where lab_id = new.lab_id and id = new.change_id;
  if new.decided_by is distinct from acting_person() then
    raise exception 'a Critical Data Change is decided by the person acting' using errcode = 'LA017';
  end if;
  if new.outcome = 'Withdrawn' and new.decided_by <> change.proposed_by then
    raise exception 'only the proposer withdraws a Critical Data Change' using errcode = 'LA017';
  end if;
  if new.outcome = 'Withdrawn' and current_setting('lims.role', true) is distinct from 'Analyst' then
    raise exception 'a Critical Data Change is withdrawn by its proposer, acting as Analyst' using errcode = 'LA017';
  end if;
  if new.outcome <> 'Withdrawn' and new.decided_by = change.proposed_by then
    raise exception 'the proposer cannot % their own Critical Data Change',
      case new.outcome when 'Approved' then 'approve' else 'reject' end using errcode = 'LA017';
  end if;
  if new.outcome <> 'Withdrawn' and exists (
    select from signature s join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
     where s.lab_id = change.lab_id and v.record_table = 'test' and v.record_id = change.test_id
       and s.meaning = 'Performed' and s.person_id = new.decided_by) then
    raise exception 'the Analyst who signed Performed cannot % a correction to the Result',
      case new.outcome when 'Approved' then 'approve' else 'reject' end using errcode = 'LA017';
  end if;
  if new.outcome = 'Rejected' and not exists (
    select from membership m
     where m.lab_id = new.lab_id and m.person_id = new.decided_by and m.role = 'Reviewer'
       and current_setting('lims.role', true) = 'Reviewer') then
    raise exception 'a Critical Data Change is rejected by a Reviewer, who could approve it' using errcode = 'LA017';
  end if;
  if new.outcome = 'Approved' then
    if not exists (
      select from membership m
       where m.lab_id = new.lab_id and m.person_id = new.decided_by and m.role = 'Reviewer'
         and current_setting('lims.role', true) = 'Reviewer') then
      raise exception 'a Critical Data Change is approved by a Reviewer, acting as Reviewer' using errcode = 'LA017';
    end if;
    select s.person_id, s.meaning, s.xmin as signed_xmin, v.record_table, v.record_id, v.version into signed
      from signature s join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
      where s.lab_id = new.lab_id and s.id = new.signature_id;
    if signed.person_id is distinct from new.decided_by or signed.meaning <> 'Approved'
       or signed.record_table <> 'critical_data_change' or signed.record_id <> new.change_id
       or not written_here(signed.signed_xmin) then
      raise exception 'an approval names the Approved Signature its approver gave on the proposal in this transaction'
        using errcode = 'LA017';
    end if;
    if exists (select from record_version v
                where v.lab_id = change.lab_id and v.record_table = 'test' and v.record_id = change.test_id
                  and v.version > (select version from record_version
                                    where lab_id = change.lab_id and id = change.proposed_on_version)) then
      raise exception 'the Test changed after the Critical Data Change was proposed, so the proposer withdraws it and proposes it again'
        using errcode = 'LA019';
    end if;
  else
    perform check_picklist_reason(case new.outcome when 'Rejected' then 'rejectChange' else 'withdrawChange' end,
                                  new.reason_id, new.reason_text);
  end if;
  new.decided_at := clock_timestamp();
  return new;
end $$;

create trigger decide before insert on lims.critical_data_change_decision
  for each row execute function lims.decide_critical_data_change();

-- An approval makes the new value current in its own transaction: the Result changes under this stamp and no other. A
-- Reviewed Test goes back to SubmittedForReview, because its Reviewed Signature no longer covers the value.
create function lims.apply_critical_data_change() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  change critical_data_change;
begin
  select * into change from critical_data_change where lab_id = new.lab_id and id = new.change_id;
  perform set_this_transaction('lims.critical_data_change', change.id::text);
  update result set value = change.new_value where lab_id = change.lab_id and id = change.result_id;
  perform set_this_transaction('lims.critical_data_change', '');
  update test set state = 'SubmittedForReview'
   where lab_id = change.lab_id and id = change.test_id and state = 'Reviewed';
  return null;
end $$;

create trigger apply after insert on lims.critical_data_change_decision
  for each row when (new.outcome = 'Approved') execute function lims.apply_critical_data_change();

-- A Result's value is Critical Data (ADR 0001): it changes in place only as an approved Critical Data Change applies,
-- in the transaction that approved it, and the Result is never removed or moved to another Test.
create function lims.refuse_unapproved_value_change() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if (new.lab_id, new.test_id) is distinct from (old.lab_id, old.test_id) then
    raise exception 'a Result stays on the Test it was entered on' using errcode = 'LA017';
  end if;
  if new.value is distinct from old.value and not exists (
    select from critical_data_change c
      join critical_data_change_decision d on d.lab_id = c.lab_id and d.change_id = c.id and d.outcome = 'Approved'
     where c.lab_id = old.lab_id and c.result_id = old.id
       and c.id::text = this_transaction('lims.critical_data_change') and written_here(d.xmin)
       and c.old_value = old.value and c.new_value = new.value) then
    raise exception 'a Result''s value changes only through an approved Critical Data Change' using errcode = 'LA017';
  end if;
  return new;
end $$;

create trigger value_through_change before update on lims.result
  for each row execute function lims.refuse_unapproved_value_change();

create function lims.refuse_removal() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are never removed', tg_table_name using errcode = 'LA002';
end $$;

create trigger refuse_removal before delete on lims.result
  for each row execute function lims.refuse_removal();
create trigger refuse_truncate before truncate on lims.result
  for each statement execute function lims.refuse_removal();

-- Canonical form 1 of a Critical Data Change: what an approver signs. It names the Test and the Record Version and
-- hash it was proposed on, so the approval binds the record as it read.
create function lims.critical_data_change_content(p_lab_id uuid, p_change_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', c.id,
    'test', c.test_id,
    'testVersion', v.version,
    'testHash', encode(v.content_hash, 'hex'),
    'field', c.field,
    'analyte', r.analyte,
    'unit', r.unit,
    'oldValue', c.old_value,
    'newValue', c.new_value,
    'reason', pr.label,
    'reasonText', c.reason_text,
    'proposedBy', p.username,
    'proposedAt', to_char(c.proposed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  from lims.critical_data_change c
  join lims.record_version v on v.lab_id = c.lab_id and v.id = c.proposed_on_version
  join lims.result r on r.lab_id = c.lab_id and r.id = c.result_id
  join lims.picklist_reason pr on pr.id = c.reason_id
  join lims.person p on p.id = c.proposed_by
  where c.lab_id = p_lab_id and c.id = p_change_id
$$;

alter table lims.record_version
  drop constraint record_version_record_table_check,
  add constraint record_version_record_table_check
    check (record_table in ('test', 'test_report', 'system_incident', 'critical_data_change'));

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
    when 'critical_data_change' then critical_data_change_content(p_lab_id, p_record_id)
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id = p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

create function lims.version_critical_data_change() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform save_record_version(new.lab_id, 'critical_data_change', new.id);
  return null;
end $$;

revoke execute on function lims.critical_data_change_content(uuid, uuid) from public;

do $$
declare
  t text;
begin
  foreach t in array array['picklist_reason', 'critical_data_change', 'critical_data_change_decision'] loop
    execute format('create trigger capture after insert or update or delete on lims.%I
                    for each row execute function lims.capture()', t);
  end loop;
  foreach t in array array['critical_data_change', 'critical_data_change_decision'] loop
    execute format('create trigger refuse_change before update or delete on lims.%I
                    for each row execute function lims.refuse_change()', t);
    execute format('create trigger refuse_truncate before truncate on lims.%I
                    for each statement execute function lims.refuse_change()', t);
  end loop;
end $$;

create trigger version_record after insert on lims.critical_data_change
  for each row execute function lims.version_critical_data_change();

-- A Critical Data Change is signed only Approved, and a Test or the Test Report built on it is never signed Approved.
-- Other records may take Approved in later tickets. lims.sign checks the signer, the proof and the version shown; this
-- checks which meaning a change, a Test and a Test Report may bind.
create function lims.check_change_signing() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  signed record_version;
begin
  select * into signed from record_version where lab_id = new.lab_id and id = new.record_version_id;
  if signed.id is null then
    return new; -- signature_record_version_fkey refuses it
  end if;
  if signed.record_table = 'critical_data_change' and new.meaning <> 'Approved' then
    raise exception 'a Critical Data Change is signed only Approved' using errcode = 'LA010';
  end if;
  if signed.record_table in ('test', 'test_report') and new.meaning = 'Approved' then
    raise exception 'a Test and the Test Report built on it are never signed Approved' using errcode = 'LA010';
  end if;
  return new;
end $$;

create trigger change_signing before insert on lims.signature
  for each row execute function lims.check_change_signing();

-- No Test step signs while a Critical Data Change on one of the Test's Results is pending: neither the Test nor the
-- Test Report built on it. Holds the Lab's chain before the check, as a proposal does, so of a proposal and a signing at
-- once the second sees the first.
create function lims.refuse_signing_while_change_pending() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  signed_test uuid;
begin
  select coalesce(r.test_id, v.record_id) into signed_test
    from record_version v
    left join test_report r on v.record_table = 'test_report' and r.lab_id = v.lab_id and r.id = v.record_id
   where v.lab_id = new.lab_id and v.id = new.record_version_id and v.record_table in ('test', 'test_report');
  if signed_test is null then
    return new;
  end if;
  perform lock_chains(new.lab_id::text);
  if exists (select from critical_data_change c
              where c.lab_id = new.lab_id and c.test_id = signed_test
                and not exists (select from critical_data_change_decision d
                                 where d.lab_id = c.lab_id and d.change_id = c.id)) then
    raise exception 'a Test is not signed while a Critical Data Change on one of its Results is pending'
      using errcode = 'LA010';
  end if;
  return new;
end $$;

create trigger test_signing_waits_for_change before insert on lims.signature
  for each row execute function lims.refuse_signing_while_change_pending();

grant execute on function lims.acting_person() to lims_app;
grant select on lims.picklist_reason to lims_app;
grant select on lims.critical_data_change, lims.critical_data_change_decision to lims_app;
grant insert (lab_id, test_id, result_id, field, old_value, new_value, reason_id, reason_text)
  on lims.critical_data_change to lims_app;
grant insert (lab_id, change_id, test_id, outcome, reason_id, reason_text, signature_id)
  on lims.critical_data_change_decision to lims_app;

-- The minimal set this ticket's steps need (#45 lists no entries); #106 and #107 add their own.
insert into lims.picklist_reason (step, position, label) values
  ('proposeChange', 1, 'Transcription error'),
  ('proposeChange', 2, 'Calculation error'),
  ('proposeChange', 3, 'Other'),
  ('rejectChange', 1, 'Not supported by the raw data'),
  ('rejectChange', 2, 'The proposed value is wrong'),
  ('rejectChange', 3, 'Other'),
  ('withdrawChange', 1, 'Proposed in error'),
  ('withdrawChange', 2, 'Proposed on the wrong Result'),
  ('withdrawChange', 3, 'Other');

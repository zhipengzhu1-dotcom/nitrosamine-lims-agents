set local role lims_owner;

-- Equipment is a Lab record: registered Quarantined, released to In use by QA's Approved signing, Suspended when it
-- is marked suspect, repaired, maintained, changed in software or firmware, or moved, and Retired by the Lab Manager
-- (spec #85, #129). Expired is a Fitness Status the fitness check derives from a Calibration's due date (#130); it is
-- never stored, so a write can never claim it.
create type lims.fitness_status as enum ('Quarantined', 'InUse', 'Suspended', 'Expired', 'Retired');
create type lims.equipment_event_kind as enum
  ('Cleaning', 'Maintenance', 'Repair', 'SoftwareChange', 'FirmwareChange', 'Note', 'Suspect');

create table lims.equipment (
  lab_id                uuid                not null references lims.lab,
  id                    uuid                not null default gen_random_uuid(),
  kind                  text                not null,
  name                  text                not null,
  manufacturer          text                not null,
  model                 text                not null,
  serial                text                not null,
  asset_number          text,
  software_version      text,
  firmware_version      text,
  room_id               uuid                not null,
  responsible_person_id uuid                not null references lims.person,
  fitness_status        lims.fitness_status not null default 'Quarantined',
  registered_at         timestamptz         not null default clock_timestamp(),
  primary key (lab_id, id),
  unique (lab_id, name),
  foreign key (lab_id, room_id) references lims.room,
  constraint equipment_identity_check check (
    kind ~ '\S' and name ~ '\S' and manufacturer ~ '\S' and model ~ '\S' and serial ~ '\S'
  ),
  constraint equipment_fitness_status_check check (fitness_status <> 'Expired')
);

-- A Logbook entry a person writes on one piece of Equipment. Every kind but Suspect is signed Performed in the
-- transaction that records it; Suspect is the alarm anyone in the Lab raises, so it carries only who and why.
create table lims.equipment_event (
  lab_id       uuid                      not null,
  id           uuid                      not null default gen_random_uuid(),
  equipment_id uuid                      not null,
  kind         lims.equipment_event_kind not null,
  note         text                      not null check (note ~ '\S' and char_length(note) <= 2000),
  recorded_by  uuid                      not null references lims.person,
  recorded_at  timestamptz               not null default clock_timestamp(),
  primary key (lab_id, id),
  foreign key (lab_id, equipment_id) references lims.equipment
);

-- The kinds after which Equipment must be checked again before use (ISO/IEC 17025 6.4.4, 6.4.9): it is Suspended.
create function lims.event_suspends(p_kind lims.equipment_event_kind) returns boolean
language sql immutable as $$
  select p_kind in ('Maintenance', 'Repair', 'SoftwareChange', 'FirmwareChange', 'Suspect')
$$;

-- Canonical form 1 of Equipment: its identity, where it is, who answers for it, its Fitness Status and its Logbook,
-- so the Approved Signature binds the Equipment as QA released it, after the Events QA saw and no other. Events are
-- never changed or deleted, so their count changes with every Event recorded, whatever its time; the latest one's id
-- names the last Event the signer saw.
create function lims.equipment_content(e lims.equipment) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'eventCount', (select count(*) from lims.equipment_event v where v.lab_id = e.lab_id and v.equipment_id = e.id),
    'lastEventId', (select v.id from lims.equipment_event v where v.lab_id = e.lab_id and v.equipment_id = e.id
                     order by v.recorded_at desc, v.id desc limit 1),
    'id', e.id,
    'kind', e.kind,
    'name', e.name,
    'manufacturer', e.manufacturer,
    'model', e.model,
    'serial', e.serial,
    'assetNumber', e.asset_number,
    'softwareVersion', e.software_version,
    'firmwareVersion', e.firmware_version,
    'roomId', e.room_id,
    'responsiblePersonId', e.responsible_person_id,
    'fitnessStatus', e.fitness_status,
    'registeredAt', to_char(e.registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

create function lims.equipment_content_hash(e lims.equipment) returns bytea
language sql stable as $$
  select sha256(convert_to(lims.equipment_content(e)::text, 'UTF8'))
$$;

create function lims.equipment_event_content(v lims.equipment_event) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', v.id,
    'equipmentId', v.equipment_id,
    'kind', v.kind,
    'note', v.note,
    'recordedBy', v.recorded_by,
    'recordedAt', to_char(v.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

-- Whether a person does the Lab's work: holds one of its staff roles, as `labStaff` in @lims/domain lists them.
create function lims.staff_of(p_lab_id uuid, p_person_id uuid) returns boolean
language sql stable as $$
  select exists (select from lims.membership m where m.lab_id = p_lab_id and m.person_id = p_person_id
                    and m.role in ('SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager'))
$$;

-- The Lab Manager of the Equipment's Lab is acting: the transaction acts in the LabManager role, as the step registry
-- gives the step, and its actor is a person who holds LabManager in that Lab, so no one registers, moves or retires
-- Equipment in a Lab they do not manage, whatever role the write claims. `p_what` names the write for the refusal.
create function lims.acting_lab_manager(p_lab_id uuid, p_what text) returns void
language plpgsql stable set search_path = lims, pg_temp as $$
declare
  actor     text := current_setting('lims.actor', true);
  acting_as text := current_setting('lims.role', true);
begin
  if acting_as is distinct from 'LabManager' then
    raise exception 'Equipment is % only by the Lab Manager', p_what using errcode = 'LA014';
  end if;
  if not exists (select from person p join membership m on m.person_id = p.id
                  where 'person:' || p.username = actor and m.lab_id = p_lab_id and m.role = 'LabManager') then
    raise exception 'Equipment is % only by the Lab Manager of its Lab, not %', p_what,
      case when actor like 'person:%' then substr(actor, 8) else coalesce(nullif(actor, ''), 'no actor') end
      using errcode = 'LA014';
  end if;
end $$;

-- Equipment is registered Quarantined by its Lab's Lab Manager with a Responsible Person on its Lab's staff, and its
-- identity never changes. Its Fitness Status moves to In use only from Quarantined or Suspended, in the transaction of
-- QA's Approved Signature over it as it was, and that write changes nothing else; to Suspended only from In use; to
-- Retired only by its Lab's Lab Manager; and Retired Equipment never changes. Only its Lab's Lab Manager moves
-- Equipment to another Room, and a Room move or a software or firmware version change suspends In use Equipment.
create function lims.keep_equipment() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if (tg_op = 'INSERT' or new.responsible_person_id <> old.responsible_person_id)
     and not staff_of(new.lab_id, new.responsible_person_id) then
    raise exception 'the Responsible Person of Equipment is a member of its Lab''s staff' using errcode = 'LA014';
  end if;
  if tg_op = 'INSERT' then
    perform acting_lab_manager(new.lab_id, 'registered');
    if new.fitness_status <> 'Quarantined' then
      raise exception 'Equipment is registered Quarantined, not %', new.fitness_status using errcode = 'LA014';
    end if;
    new.registered_at := clock_timestamp();
    return new;
  end if;
  if old.fitness_status = 'Retired' then
    raise exception 'Retired Equipment never changes' using errcode = 'LA014';
  end if;
  if (new.lab_id, new.id, new.kind, new.manufacturer, new.model, new.serial, new.registered_at)
     is distinct from (old.lab_id, old.id, old.kind, old.manufacturer, old.model, old.serial, old.registered_at) then
    raise exception 'the identity of Equipment never changes' using errcode = 'LA002';
  end if;
  if new.room_id <> old.room_id then
    perform acting_lab_manager(new.lab_id, 'moved');
  end if;
  if (new.room_id, new.software_version, new.firmware_version)
     is distinct from (old.room_id, old.software_version, old.firmware_version)
     and old.fitness_status = 'InUse' and new.fitness_status = 'InUse' then
    new.fitness_status := 'Suspended';
  end if;
  if new.fitness_status <> old.fitness_status then
    if new.fitness_status = 'InUse' then
      if old.fitness_status not in ('Quarantined', 'Suspended') then
        raise exception 'Equipment moves to In use only from Quarantined or Suspended, not %', old.fitness_status
          using errcode = 'LA014';
      end if;
      if (new.name, new.asset_number, new.software_version, new.firmware_version, new.room_id, new.responsible_person_id)
         is distinct from
         (old.name, old.asset_number, old.software_version, old.firmware_version, old.room_id, old.responsible_person_id) then
        raise exception 'Equipment moves to In use as QA saw it; nothing else changes in that write' using errcode = 'LA014';
      end if;
      if not exists (select from signature s
                      join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
                      where v.lab_id = old.lab_id and v.record_table = 'equipment' and v.record_id = old.id
                        and s.meaning = 'Approved' and written_here(s.xmin)
                        and v.content_hash = equipment_content_hash(old)) then
        raise exception 'Equipment moves to In use only with an Approved Signature over it, given in the same transaction'
          using errcode = 'LA014';
      end if;
    elsif new.fitness_status = 'Suspended' and old.fitness_status <> 'InUse' then
      raise exception 'Equipment is Suspended only from In use, not %', old.fitness_status using errcode = 'LA014';
    elsif new.fitness_status = 'Retired' then
      perform acting_lab_manager(new.lab_id, 'Retired');
    elsif new.fitness_status = 'Quarantined' then
      raise exception 'Equipment never returns to Quarantined; it is Suspended' using errcode = 'LA014';
    end if;
  end if;
  return new;
end $$;

create trigger keep_equipment before insert or update on lims.equipment
  for each row execute function lims.keep_equipment();

-- An Equipment Event is recorded by the person acting, a member of the Lab's staff, at the database's instant, never
-- on Retired Equipment, and an Event after which the Equipment must be checked again suspends In use Equipment. The
-- Lab's Audit Trail chain is taken first, before the Fitness Status is read, so an Event never reads a status that
-- another transaction is changing, and a Suspect raised while QA approves the Equipment lands after the approval and
-- suspends it. Every API step on Equipment takes that chain before the row (a signed step at its re-authentication
-- record, an unsigned step by lock_chains before its update). A BEFORE trigger cannot take it ahead of the row an
-- UPDATE locks, so a writer that updates Equipment without taking the chain first can deadlock against a Suspect;
-- Postgres then aborts one of the two and no record lands wrong. The status read relies on READ COMMITTED.
create function lims.record_equipment_event() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  actor  text := current_setting('lims.actor', true);
  status fitness_status;
begin
  perform lock_chains(new.lab_id::text);
  select id into new.recorded_by from person where 'person:' || username = actor;
  if new.recorded_by is null then
    raise exception 'an Equipment Event is recorded by a person, not %', coalesce(nullif(actor, ''), 'no actor')
      using errcode = 'LA015';
  end if;
  if not staff_of(new.lab_id, new.recorded_by) then
    raise exception 'an Equipment Event is recorded by a member of its Lab''s staff, not %', substr(actor, 8)
      using errcode = 'LA015';
  end if;
  new.recorded_at := clock_timestamp();
  select fitness_status into status from equipment where lab_id = new.lab_id and id = new.equipment_id;
  if status = 'Retired' then
    raise exception 'an Equipment Event is never recorded on Retired Equipment' using errcode = 'LA014';
  end if;
  if status = 'InUse' and event_suspends(new.kind) then
    update equipment set fitness_status = 'Suspended' where lab_id = new.lab_id and id = new.equipment_id;
  end if;
  return new;
end $$;

create trigger record_equipment_event before insert on lims.equipment_event
  for each row execute function lims.record_equipment_event();

-- The content hash and the Logbook read one piece of Equipment's Events, latest first.
create index equipment_event_logbook_idx on lims.equipment_event (lab_id, equipment_id, recorded_at desc, id desc);

-- Every Equipment Event but Suspect carries the Performed Signature of the person who recorded it by the time its
-- transaction commits.
create function lims.require_event_signing() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if new.kind <> 'Suspect' and not exists (
       select from signature s join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
        where v.lab_id = new.lab_id and v.record_table = 'equipment_event' and v.record_id = new.id
          and s.meaning = 'Performed' and s.person_id = new.recorded_by) then
    raise exception 'an Equipment Event is signed Performed by the person who records it' using errcode = 'LA010';
  end if;
  return null;
end $$;

create constraint trigger require_event_signing after insert on lims.equipment_event
  deferrable initially deferred for each row execute function lims.require_event_signing();

-- What an Approved or a Performed signing may bind on Equipment: Approved on Equipment that is Quarantined or
-- Suspended, over it as it is now; Performed once on an Equipment Event other than Suspect. It binds one direction
-- only, so Approved and Performed stay free for the other records that use them; and the Lab Manager, whom
-- lims.signing_role gives Performed for the Logbook alone, signs Performed nothing but an Equipment Event.
create function lims.check_equipment_signing() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  signed record_version;
  e      equipment;
begin
  select * into signed from record_version where lab_id = new.lab_id and id = new.record_version_id;
  if new.role = 'LabManager' and new.meaning = 'Performed' and signed.record_table <> 'equipment_event' then
    raise exception 'the Lab Manager signs Performed only an Equipment Event' using errcode = 'LA010';
  end if;
  if signed.record_table = 'equipment' then
    if new.meaning <> 'Approved' then
      raise exception 'Equipment is signed only Approved' using errcode = 'LA010';
    end if;
    select * into e from equipment where lab_id = signed.lab_id and id = signed.record_id;
    if e.fitness_status not in ('Quarantined', 'Suspended') then
      raise exception 'Equipment is signed Approved while Quarantined or Suspended, not %', e.fitness_status
        using errcode = 'LA010';
    end if;
    if signed.content_hash <> equipment_content_hash(e) then
      raise exception 'the Approved Signature binds the Equipment as it is now; it must be read again before signing'
        using errcode = 'LA010';
    end if;
  elsif signed.record_table = 'equipment_event' then
    if new.meaning <> 'Performed' then
      raise exception 'an Equipment Event is signed only Performed' using errcode = 'LA010';
    end if;
    if exists (select from equipment_event v where v.lab_id = signed.lab_id and v.id = signed.record_id
                                               and v.kind = 'Suspect') then
      raise exception 'a Suspect Equipment Event is not signed' using errcode = 'LA010';
    end if;
    if exists (select from signature s join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
                where v.lab_id = signed.lab_id and v.record_table = 'equipment_event' and v.record_id = signed.record_id) then
      raise exception 'an Equipment Event is signed Performed once' using errcode = 'LA010';
    end if;
  end if;
  return new;
end $$;

create trigger equipment_signing before insert on lims.signature
  for each row execute function lims.check_equipment_signing();

-- QA releases Equipment Approved, and the Lab Manager signs an Equipment Event Performed as the Analyst does (#129,
-- agent default). #102 also gives QA Approved, so whichever merges second keeps the one row.
select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'QA signs Equipment Approved; the Lab Manager signs an Equipment Event Performed', true);
insert into lims.signing_role (role, meaning) values ('QA', 'Approved'), ('LabManager', 'Performed')
  on conflict do nothing;

alter table lims.record_version
  drop constraint record_version_record_table_check,
  add constraint record_version_record_table_check check (
    record_table in ('test', 'test_report', 'system_incident', 'equipment', 'equipment_event')
  );

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
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id = p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

-- Writes the current content of Equipment or of an Equipment Event as a Record Version in the signing's Lab, when it
-- differs from the latest one, and returns the latest version's id: what the Approved or Performed signing binds, or
-- the Equipment the Performed signer was shown while the Event was recorded on it. The re-authentication record this
-- transaction wrote names the Lab and the meaning, so a version is never written for a signing that is not under way.
create function lims.version_equipment_record(p_reauthentication_id uuid, p_table text, p_record_id uuid) returns uuid
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  proof      reauthentication;
  proof_xmin xid;
  latest     uuid;
begin
  select * into proof from reauthentication where id = p_reauthentication_id;
  select xmin into proof_xmin from reauthentication where id = p_reauthentication_id;
  if proof.id is null or not written_here(proof_xmin)
     or (p_table, proof.meaning::text) not in (('equipment', 'Approved'), ('equipment', 'Performed'),
                                               ('equipment_event', 'Performed')) then
    raise exception 'Equipment is versioned only for its Approved signing or for the Performed signing of an Event on it, and an Equipment Event only for its Performed signing, re-authenticated in this transaction'
      using errcode = 'LA010';
  end if;
  perform save_record_version(proof.lab_id, p_table, p_record_id);
  select id into latest from record_version
    where lab_id = proof.lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest is null then
    raise exception 'there is no % % to version', p_table, p_record_id using errcode = 'LA014';
  end if;
  return latest;
end $$;

create trigger capture after insert or update or delete on lims.equipment
  for each row execute function lims.capture();
create trigger refuse_change before delete on lims.equipment
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.equipment
  for each statement execute function lims.refuse_change();
create trigger capture after insert or update or delete on lims.equipment_event
  for each row execute function lims.capture();
create trigger refuse_change before update or delete on lims.equipment_event
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.equipment_event
  for each statement execute function lims.refuse_change();

-- lims.sign as 0017 defines it, with one clause added to the records a signing may create on sight of another: an
-- Equipment Event this transaction recorded, signed Performed on sight of its Equipment, as a Test Report is signed on
-- sight of its Test. The Performed signer is shown the Equipment, so the "shown record" check binds what they saw.
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

  select * into seen from record_version where lab_id = proof.lab_id and id = p_seen_version;
  if seen.id is null then
    raise exception 'the Record Version shown is not one of this Lab''s' using errcode = 'LA010';
  end if;
  if seen.content_hash <> p_seen_hash then
    raise exception 'the hash shown is not the hash of Record Version %', seen.version using errcode = 'LA010';
  end if;
  if exists (select from record_version v
              where v.lab_id = seen.lab_id and v.record_table = seen.record_table and v.record_id = seen.record_id
                and v.version > seen.version and not written_here(v.xmin)) then
    raise exception 'the record changed after the signer saw it; it must be read again before signing' using errcode = 'LA010';
  end if;
  select * into signed from record_version
    where lab_id = proof.lab_id and record_table = p_record_table and record_id = p_record_id
    order by version desc limit 1;
  if signed.id is null then
    raise exception 'there is no Record Version of % % to sign', p_record_table, p_record_id using errcode = 'LA010';
  end if;
  if (signed.record_table, signed.record_id) <> (seen.record_table, seen.record_id) then
    if exists (select from record_version v
                where v.lab_id = signed.lab_id and v.record_table = signed.record_table and v.record_id = signed.record_id
                  and not written_here(v.xmin)) then
      raise exception 'the % signed is not the record shown, nor one this signing created', p_record_table using errcode = 'LA010';
    end if;
    if signed.record_table = 'equipment_event' then
      if not exists (select from equipment_event v
                      where v.lab_id = signed.lab_id and v.id = signed.record_id
                        and seen.record_table = 'equipment' and v.equipment_id = seen.record_id) then
        raise exception 'the Equipment Event signed is not recorded on the Equipment shown' using errcode = 'LA010';
      end if;
    elsif not exists (select from test_report r
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

-- The Logbook reads the Audit Trail entries of one piece of Equipment in order (apps/api/src/equipment.ts, logbookOf).
create index audit_entry_equipment_logbook_idx on lims.audit_entry ((new_row ->> 'id'), seq)
  where table_name = 'equipment';

revoke execute on function lims.staff_of(uuid, uuid), lims.acting_lab_manager(uuid, text),
  lims.event_suspends(lims.equipment_event_kind),
  lims.equipment_content(lims.equipment), lims.equipment_content_hash(lims.equipment),
  lims.equipment_event_content(lims.equipment_event), lims.version_equipment_record(uuid, text, uuid) from public;
grant execute on function lims.staff_of(uuid, uuid), lims.acting_lab_manager(uuid, text),
  lims.event_suspends(lims.equipment_event_kind),
  lims.equipment_content(lims.equipment), lims.equipment_content_hash(lims.equipment),
  lims.equipment_event_content(lims.equipment_event), lims.version_equipment_record(uuid, text, uuid) to lims_app;
-- keep_equipment runs as the writer and asks whether the Approved Signature was written in this transaction.
grant execute on function lims.written_here(xid) to lims_app;
grant select, insert on lims.equipment, lims.equipment_event to lims_app;
-- The steps write the versions, the Room and the Fitness Status; the name, asset number and Responsible Person have
-- no step yet, so the app role cannot change them.
grant update (software_version, firmware_version, room_id, fitness_status) on lims.equipment to lims_app;

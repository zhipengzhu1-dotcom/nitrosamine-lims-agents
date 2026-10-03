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

-- Canonical form 1 of Equipment: its identity, where it is, who answers for it and its Fitness Status, so the
-- Approved Signature binds the Equipment as QA released it.
create function lims.equipment_content(e lims.equipment) returns jsonb
language sql stable as $$
  select jsonb_build_object(
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

-- Equipment is registered Quarantined by a Responsible Person of its Lab, and its identity never changes. Its Fitness
-- Status moves to In use only from Quarantined or Suspended, in the transaction of QA's Approved Signature over it as
-- it was; to Suspended only from In use; to Retired only by the Lab Manager; and Retired Equipment never changes.
-- Moving In use Equipment to another Room suspends it.
create function lims.keep_equipment() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if (tg_op = 'INSERT' or new.responsible_person_id <> old.responsible_person_id) and not exists (select from membership m where m.lab_id = new.lab_id and m.person_id = new.responsible_person_id
                                             and m.role <> 'Customer') then
    raise exception 'the Responsible Person of Equipment is a member of its Lab''s staff' using errcode = 'LA014';
  end if;
  if tg_op = 'INSERT' then
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
  if new.room_id <> old.room_id and old.fitness_status = 'InUse' and new.fitness_status = 'InUse' then
    new.fitness_status := 'Suspended';
  end if;
  if new.fitness_status <> old.fitness_status then
    if new.fitness_status = 'InUse' then
      if old.fitness_status not in ('Quarantined', 'Suspended') then
        raise exception 'Equipment moves to In use only from Quarantined or Suspended, not %', old.fitness_status
          using errcode = 'LA014';
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
    elsif new.fitness_status = 'Retired' and current_setting('lims.role', true) is distinct from 'LabManager' then
      raise exception 'Equipment is Retired only by the Lab Manager' using errcode = 'LA014';
    elsif new.fitness_status = 'Quarantined' then
      raise exception 'Equipment never returns to Quarantined; it is Suspended' using errcode = 'LA014';
    end if;
  end if;
  return new;
end $$;

create trigger keep_equipment before insert or update on lims.equipment
  for each row execute function lims.keep_equipment();

-- An Equipment Event is recorded by the person acting, at the database's instant, never on Retired Equipment, and
-- an Event after which the Equipment must be checked again suspends In use Equipment.
create function lims.record_equipment_event() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  actor  text := current_setting('lims.actor', true);
  status fitness_status;
begin
  select id into new.recorded_by from person where 'person:' || username = actor;
  if new.recorded_by is null then
    raise exception 'an Equipment Event is recorded by a person, not %', coalesce(nullif(actor, ''), 'no actor')
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
-- only, so Approved and Performed stay free for the other records that use them.
create function lims.check_equipment_signing() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  signed record_version;
  e      equipment;
begin
  select * into signed from record_version where lab_id = new.lab_id and id = new.record_version_id;
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
-- differs from the latest one, and returns the latest version's id: what the Approved or Performed signing binds. The
-- re-authentication record this transaction wrote names the Lab and the meaning, so a version is never written for a
-- signing that is not under way.
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
     or (p_table, proof.meaning::text) not in (('equipment', 'Approved'), ('equipment_event', 'Performed')) then
    raise exception 'Equipment is versioned only for its Approved signing, and an Equipment Event only for its Performed signing, re-authenticated in this transaction'
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

revoke execute on function lims.event_suspends(lims.equipment_event_kind), lims.equipment_content(lims.equipment),
  lims.equipment_content_hash(lims.equipment), lims.equipment_event_content(lims.equipment_event),
  lims.version_equipment_record(uuid, text, uuid) from public;
grant execute on function lims.event_suspends(lims.equipment_event_kind), lims.equipment_content(lims.equipment),
  lims.equipment_content_hash(lims.equipment), lims.equipment_event_content(lims.equipment_event),
  lims.version_equipment_record(uuid, text, uuid) to lims_app;
-- keep_equipment runs as the writer and asks whether the Approved Signature was written in this transaction.
grant execute on function lims.written_here(xid) to lims_app;
grant select, insert on lims.equipment, lims.equipment_event to lims_app;
grant update (name, asset_number, software_version, firmware_version, room_id, responsible_person_id, fitness_status)
  on lims.equipment to lims_app;

set local role lims_owner;

-- A System Incident closes once QA has answered whether it could have affected results or records, the owner has
-- recorded its immediate and corrective actions (ISO/IEC 17025 7.11.3 e) and signed Acknowledged, and it then moves
-- Open -> Acknowledged -> Closed (spec #85, stories 192 and 193). Each answer and action is recorded once, with who
-- recorded it and the database's time.
create type lims.impact_answer as enum ('Yes', 'No');

-- The kinds whose answer is always Yes: a broken or unanchored audit chain, or a clock step during audited writes
-- (CONTEXT.md, System Incident). The kinds the LIMS does not open yet are named so that they force Yes once it does.
create function lims.incident_forces_yes(p_kind text) returns boolean
language sql immutable as $$ select p_kind in ('ChainVerifyFailure', 'FailedAnchor', 'ClockStep') $$;

alter table lims.system_incident
  add column impact_answer        lims.impact_answer,
  add column impact_answered_by   uuid references lims.person,
  add column impact_answered_at   timestamptz,
  add column immediate_action     text,
  add column immediate_action_by  uuid references lims.person,
  add column immediate_action_at  timestamptz,
  add column corrective_action    text,
  add column corrective_action_by uuid references lims.person,
  add column corrective_action_at timestamptz,
  add constraint system_incident_impact_answer_check check (
    (impact_answer is null) = (impact_answered_by is null)
    and (impact_answer is null) = (impact_answered_at is null)
    and (impact_answer is null or impact_answer = 'Yes' or not lims.incident_forces_yes(kind::text))
  ),
  add constraint system_incident_immediate_action_check check (
    (immediate_action is null) = (immediate_action_by is null)
    and (immediate_action is null) = (immediate_action_at is null)
    and (immediate_action is null or (immediate_action ~ '\S' and char_length(immediate_action) <= 2000))
  ),
  add constraint system_incident_corrective_action_check check (
    (corrective_action is null) = (corrective_action_by is null)
    and (corrective_action is null) = (corrective_action_at is null)
    and (corrective_action is null or (corrective_action ~ '\S' and char_length(corrective_action) <= 2000))
  );

-- Canonical form 1 of a System Incident: the facts it opened with and what QA and the owner recorded on it, rendered
-- as the Test's content is. Its state is not content, so a close does not unsign the Acknowledged Signature. The row
-- form hashes a row before it is stored, which is how the trigger below checks a Signature against the move it guards.
create function lims.incident_content(i lims.system_incident) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', i.id,
    'reference', i.reference,
    'kind', i.kind,
    'openedAt', to_char(i.opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'requestedBy', i.requested_by,
    'sessionLabId', i.session_lab_id,
    'step', i.step,
    'recordId', i.record_id,
    'errorClass', i.error_class,
    'sqlstate', i.sqlstate,
    'constraintName', i.constraint_name,
    'subjectId', i.subject_id,
    'sourceAddress', host(i.source_address),
    'typedUserIdHmac', encode(i.typed_user_id_hmac, 'hex'),
    'chain', i.chain,
    'firstFailure', i.first_failure,
    'lastFailure', i.last_failure,
    'breakCount', i.break_count,
    'fingerprint', encode(i.fingerprint, 'hex'),
    'loggedAt', to_char(i.logged_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'impactAnswer', i.impact_answer,
    'impactAnsweredBy', i.impact_answered_by,
    'impactAnsweredAt', to_char(i.impact_answered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'immediateAction', i.immediate_action,
    'immediateActionBy', i.immediate_action_by,
    'immediateActionAt', to_char(i.immediate_action_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'correctiveAction', i.corrective_action,
    'correctiveActionBy', i.corrective_action_by,
    'correctiveActionAt', to_char(i.corrective_action_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

-- The hash the signer is shown before credentials, computed as save_record_version hashes the bytes it writes.
create function lims.incident_content_hash(i lims.system_incident) returns bytea
language sql stable as $$
  select sha256(convert_to(lims.incident_content(i)::text, 'UTF8'))
$$;

-- The person recording one of the three on a System Incident: the transaction's actor, acting in the role the step
-- registry gives the step and holding that role in a Lab, so no one records an answer or an action in another's name
-- or in a role they do not hold. A System Incident is a company record, so a membership in any Lab qualifies.
create function lims.incident_recorder(p_role text, p_what text) returns uuid
language plpgsql stable set search_path = lims, pg_temp as $$
declare
  actor     text := current_setting('lims.actor', true);
  acting_as text := current_setting('lims.role', true);
  recorder  uuid;
begin
  if acting_as is distinct from p_role then
    raise exception '% on a System Incident is recorded by %, not %', p_what, p_role, coalesce(nullif(acting_as, ''), 'no role')
      using errcode = 'LA015';
  end if;
  select id into recorder from person where 'person:' || username = actor;
  if recorder is null then
    raise exception '% on a System Incident is recorded by a person, not %', p_what, coalesce(nullif(actor, ''), 'no actor')
      using errcode = 'LA015';
  end if;
  if not exists (select from membership m where m.person_id = recorder and m.role::text = p_role) then
    raise exception '% on a System Incident is recorded by a person who holds %, not %', p_what, p_role, actor
      using errcode = 'LA015';
  end if;
  return recorder;
end $$;

-- The facts an incident opened with never change. What QA and the owner record on it is written once each, from
-- null, stamped here with the acting person and the database's instant whatever the write says, and the state moves
-- only Open -> Acknowledged -> Closed: Acknowledged once the answer and both actions are recorded and an Acknowledged
-- Signature binds the incident's current content, Closed from Acknowledged, and a Closed incident never changes again.
create or replace function lims.keep_incident_facts() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  recorded text[] := array['state', 'impact_answer', 'impact_answered_by', 'impact_answered_at',
                           'immediate_action', 'immediate_action_by', 'immediate_action_at',
                           'corrective_action', 'corrective_action_by', 'corrective_action_at'];
begin
  if to_jsonb(new) - recorded is distinct from to_jsonb(old) - recorded then
    raise exception 'a System Incident''s recorded facts are never changed' using errcode = 'LA002';
  end if;
  if old.state = 'Closed' then
    raise exception 'a Closed System Incident never changes' using errcode = 'LA014';
  end if;
  if old.impact_answer is null and new.impact_answer is not null then
    new.impact_answered_by := incident_recorder('QA', 'QA''s answer');
    new.impact_answered_at := clock_timestamp();
  elsif old.impact_answer is not null
     and (new.impact_answer, new.impact_answered_by, new.impact_answered_at)
         is distinct from (old.impact_answer, old.impact_answered_by, old.impact_answered_at) then
    raise exception 'QA''s answer on a System Incident is recorded once' using errcode = 'LA014';
  end if;
  if old.immediate_action is null and new.immediate_action is not null then
    new.immediate_action_by := incident_recorder('Admin', 'an immediate action');
    new.immediate_action_at := clock_timestamp();
  elsif old.immediate_action is not null
     and (new.immediate_action, new.immediate_action_by, new.immediate_action_at)
         is distinct from (old.immediate_action, old.immediate_action_by, old.immediate_action_at) then
    raise exception 'a System Incident''s immediate action is recorded once' using errcode = 'LA014';
  end if;
  if old.corrective_action is null and new.corrective_action is not null then
    new.corrective_action_by := incident_recorder('Admin', 'a corrective action');
    new.corrective_action_at := clock_timestamp();
  elsif old.corrective_action is not null
     and (new.corrective_action, new.corrective_action_by, new.corrective_action_at)
         is distinct from (old.corrective_action, old.corrective_action_by, old.corrective_action_at) then
    raise exception 'a System Incident''s corrective action is recorded once' using errcode = 'LA014';
  end if;
  if new.state <> old.state then
    if not ((old.state = 'Open' and new.state = 'Acknowledged')
            or (old.state = 'Acknowledged' and new.state = 'Closed')) then
      raise exception 'a System Incident moves only from Open to Acknowledged to Closed' using errcode = 'LA014';
    end if;
    if new.state = 'Acknowledged' then
      if new.impact_answer is null or new.immediate_action is null or new.corrective_action is null then
        raise exception 'a System Incident is Acknowledged only once QA''s answer, its immediate action and its corrective action are recorded'
          using errcode = 'LA014';
      end if;
      if not exists (select from signature s
                      join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
                      where v.record_table = 'system_incident' and v.record_id = new.id
                        and s.meaning = 'Acknowledged') then
        raise exception 'a System Incident is Acknowledged only by an Acknowledged Signature on it' using errcode = 'LA014';
      end if;
      if not exists (select from signature s
                      join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
                      where v.record_table = 'system_incident' and v.record_id = new.id
                        and s.meaning = 'Acknowledged' and v.content_hash = incident_content_hash(new)) then
        raise exception 'a System Incident is Acknowledged only by an Acknowledged Signature over its current content'
          using errcode = 'LA014';
      end if;
    end if;
  end if;
  return new;
end $$;

-- The owner signs Acknowledged as Admin: the only role the owner holds that reaches records (#104, open question).
select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Admin signs Acknowledged on a System Incident', true);
insert into lims.signing_role (role, meaning) values ('Admin', 'Acknowledged');

-- Acknowledged is the Signature Meaning of a System Incident and of nothing else, and a System Incident is signed once,
-- while Open, once QA's answer and both actions are recorded, over its content as it is at the signing. lims.sign
-- checks the signer, the proof and the version shown; this checks what an Acknowledged signing may bind.
create function lims.check_incident_signing() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
declare
  signed   record_version;
  incident system_incident;
begin
  select * into signed from record_version where lab_id = new.lab_id and id = new.record_version_id;
  if signed.id is null then
    return new; -- signature_record_version_fkey refuses it
  end if;
  if (new.meaning = 'Acknowledged') <> (signed.record_table = 'system_incident') then
    raise exception 'Acknowledged is the Signature Meaning of a System Incident, and a System Incident is signed only Acknowledged'
      using errcode = 'LA010';
  end if;
  if signed.record_table <> 'system_incident' then
    return new;
  end if;
  select * into incident from system_incident where id = signed.record_id;
  if incident.state <> 'Open' then
    raise exception 'a System Incident is signed Acknowledged while Open, not %', incident.state using errcode = 'LA010';
  end if;
  if incident.impact_answer is null or incident.immediate_action is null or incident.corrective_action is null then
    raise exception 'a System Incident is signed Acknowledged only once QA''s answer, its immediate action and its corrective action are recorded'
      using errcode = 'LA010';
  end if;
  if exists (select from signature s
              join record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
              where v.record_table = 'system_incident' and v.record_id = incident.id and s.meaning = 'Acknowledged') then
    raise exception 'a System Incident is signed Acknowledged once' using errcode = 'LA010';
  end if;
  if signed.content_hash <> incident_content_hash(incident) then
    raise exception 'the Acknowledged Signature binds the System Incident as it is now; it must be read again before signing'
      using errcode = 'LA010';
  end if;
  return new;
end $$;

create trigger incident_signing before insert on lims.signature
  for each row execute function lims.check_incident_signing();

-- The stored row's content, for the version written at a signing and the hash the signer is shown.
create function lims.incident_content(p_incident_id uuid) returns jsonb
language sql stable as $$
  select lims.incident_content(i) from lims.system_incident i where i.id = p_incident_id
$$;

create function lims.incident_content_hash(p_incident_id uuid) returns bytea
language sql stable as $$
  select lims.incident_content_hash(i) from lims.system_incident i where i.id = p_incident_id
$$;

-- A System Incident is a company record; its Record Version is written in the Lab of the session that signs it, so
-- that the Signature, a Lab record, binds a version of its own Lab, as lims.sign requires. No trigger versions it on
-- change: its Audit Trail holds each change, and the version a Signature binds is written as it is signed.
alter table lims.record_version
  drop constraint record_version_record_table_check,
  add constraint record_version_record_table_check check (record_table in ('test', 'test_report', 'system_incident'));

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
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id = p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

-- Writes the System Incident's current content as a Record Version in the signing session's Lab, when it differs
-- from the latest one there, and returns the latest version's id: what the Acknowledged signing binds. The Lab is
-- the one of the re-authentication record this transaction wrote for the signing, as lims.sign takes it, so the
-- caller names no Lab and a version is never written in a Lab the signer is not in.
create function lims.version_system_incident(p_reauthentication_id uuid, p_incident_id uuid) returns uuid
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  proof      reauthentication;
  proof_xmin xid;
  latest     uuid;
begin
  select * into proof from reauthentication where id = p_reauthentication_id;
  select xmin into proof_xmin from reauthentication where id = p_reauthentication_id;
  if proof.id is null or not written_here(proof_xmin) or proof.meaning <> 'Acknowledged' then
    raise exception 'a System Incident is versioned only for the Acknowledged signing re-authenticated in this transaction'
      using errcode = 'LA010';
  end if;
  perform save_record_version(proof.lab_id, 'system_incident', p_incident_id);
  select id into latest from record_version
    where lab_id = proof.lab_id and record_table = 'system_incident' and record_id = p_incident_id
    order by version desc limit 1;
  if latest is null then
    raise exception 'there is no System Incident % to version', p_incident_id using errcode = 'LA014';
  end if;
  return latest;
end $$;

-- The check constraint and the content hash run as whoever writes or reads, so the app role executes them. The app
-- writes the answer and the actions, and the state; who recorded each and when, the trigger stamps.
revoke execute on function lims.incident_forces_yes(text), lims.incident_content(lims.system_incident),
  lims.incident_content(uuid), lims.incident_content_hash(lims.system_incident), lims.incident_content_hash(uuid),
  lims.incident_recorder(text, text), lims.version_system_incident(uuid, uuid) from public;
grant execute on function lims.incident_forces_yes(text), lims.incident_content(lims.system_incident),
  lims.incident_content(uuid), lims.incident_content_hash(lims.system_incident), lims.incident_content_hash(uuid),
  lims.incident_recorder(text, text), lims.version_system_incident(uuid, uuid) to lims_app;
grant update (state, impact_answer, immediate_action, corrective_action) on lims.system_incident to lims_app;

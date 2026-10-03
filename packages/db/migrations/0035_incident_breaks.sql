set local role lims_owner;

-- A chain verification System Incident keeps every break it records, as the verification read them: entry, kind,
-- last entry and fingerprint, in entry order (#250). A More incident's fingerprint is only a digest of its breaks, so
-- without them a later change inside its range, a further tamper or an entry put back, would leave the incident
-- unable to say which entries were broken when it opened. The breaks are its own rows, not a column of the audited
-- incident: lims.capture copies the whole row into every Audit Trail entry on it, and a chain with thousands of breaks
-- would then be copied into each of the incident's entries, inside the time the verification has to write them. The
-- rows are written once, in one statement of the transaction that opens the incident, and never change; the
-- incident's fingerprint and its content hash (below) bind them, which is why the Audit Trail does not capture them.
-- An incident opened before this migration has none. One entry can hold two breaks of different kinds: when the entry
-- a Chain Verification names is changed, the entry is Changed and the Chain Verification is Contradicted at it. So
-- kind is part of the key, and every digest and list of the breaks orders them by entry, then kind.
create table lims.incident_break (
  incident_id uuid   not null references lims.system_incident,
  seq         bigint not null,
  kind        text   not null check (kind in ('Changed', 'Missing', 'HeadMoved', 'Contradicted')),
  through     bigint not null constraint incident_break_through_check check (through >= seq),
  fingerprint bytea  not null,
  primary key (incident_id, seq, kind)
);

create trigger refuse_change before update or delete on lims.incident_break
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.incident_break
  for each statement execute function lims.refuse_change();

-- A break belongs to a chain-verify System Incident opened in this transaction, and the statement that writes an
-- incident's breaks leaves it with exactly its break count, so that no break is added to an incident after it
-- opened, not even to one opened before this migration: opened_at is stamped by the database, the app role cannot
-- write it, and it is before now(), the transaction's start, for every incident an earlier transaction opened; the
-- count is a fact that keep_incident_facts freezes, and a break is never removed. Once per statement, after the
-- rows' own checks and their foreign key, so that those refuse first and a chain with thousands of breaks is
-- counted once.
create function lims.breaks_written_once() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if exists (select from (select distinct incident_id from added) a
             join system_incident i on i.id = a.incident_id
             where i.chain is null) then
    raise exception 'a break is recorded only on a chain-verify System Incident' using errcode = '23514';
  end if;
  if exists (select from (select distinct incident_id from added) a
             join system_incident i on i.id = a.incident_id
             where i.opened_at < now()) then
    raise exception 'a break is recorded in the transaction that opens its System Incident' using errcode = '23514';
  end if;
  if exists (select from (select distinct incident_id from added) a
             join system_incident i on i.id = a.incident_id
             where (select count(*) from incident_break b where b.incident_id = i.id) is distinct from i.break_count) then
    raise exception 'a chain-verify System Incident''s breaks are written once, in one statement, and give its count'
      using errcode = '23514';
  end if;
  return null;
end $$;

create trigger breaks_written_once after insert on lims.incident_break
  referencing new table as added for each statement execute function lims.breaks_written_once();

-- Checked when the opening transaction commits, because the foreign key makes the incident come before its breaks: a
-- chain-verify System Incident's breaks give its count, its first and last entry, and its fingerprint (the digest
-- Verify chain records for a More incident: sha256 over each break's entry and the sha256 of its fingerprint, in
-- entry order, then kind, or the one break's own).
create function lims.check_incident_breaks() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if new.chain is null or new.fingerprint is null then
    return null;
  end if;
  if not exists (
       select
       from incident_break b
       where b.incident_id = new.id
       having count(*) = new.break_count and min(b.seq) = new.first_failure and max(b.through) = new.last_failure
         and (sha256(string_agg(int8send(b.seq) || sha256(b.fingerprint), ''::bytea order by b.seq, b.kind)) = new.fingerprint
           or (count(*) = 1 and bool_and(b.fingerprint = new.fingerprint)))
     ) then
    raise exception 'a chain-verify System Incident records every break it covers, which give its count, range and fingerprint'
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger check_incident_breaks after insert on lims.system_incident
  deferrable initially deferred for each row execute function lims.check_incident_breaks();

-- Canonical form 1 of a System Incident now binds its breaks: a digest over each break's entry, last entry, kind and
-- fingerprint, in entry order, then kind, so that a bypassed change to a break unsigns the Acknowledged Signature. An
-- incident with no break rows renders as before, so the content signed before this migration keeps its hash.
create or replace function lims.incident_content(i lims.system_incident) returns jsonb
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
  || jsonb_strip_nulls(jsonb_build_object('breaksDigest', (
       select encode(sha256(string_agg(
                sha256(int8send(b.seq) || int8send(b.through) || sha256(convert_to(b.kind, 'UTF8')) || sha256(b.fingerprint)),
                ''::bytea order by b.seq, b.kind)), 'hex')
       from lims.incident_break b where b.incident_id = i.id)))
$$;

grant select, insert on lims.incident_break to lims_app;

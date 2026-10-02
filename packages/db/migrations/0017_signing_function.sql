set local role lims_owner;

-- The signature statement is QA-approved configuration (#45, small rule 6). The unique key lets a Signature reference
-- the hash it copies, so the copy cannot differ.
create table lims.signature_statement (
  version        integer     primary key check (version >= 1),
  statement      bytea       not null,
  statement_hash bytea       not null generated always as (sha256(statement)) stored,
  approved_at    timestamptz not null default clock_timestamp(),
  unique (version, statement_hash)
);

-- The single-use re-authentication record is a Lab row, so it sits on the same chain as the Signature it enables and
-- the step's transaction keeps the company-before-Lab lock order.
create table lims.reauthentication (
  lab_id        uuid         not null references lims.lab,
  id            uuid         not null default gen_random_uuid(),
  session_id    uuid         not null,
  person_id     uuid         not null references lims.person,
  meaning       lims.meaning not null,
  authenticator text         not null check (authenticator in ('Password')),
  at            timestamptz  not null default clock_timestamp(),
  primary key (lab_id, id),
  foreign key (lab_id, session_id, person_id) references lims.session (lab_id, id, person_id),
  constraint reauthentication_facts_key unique (lab_id, id, session_id, person_id, meaning, authenticator)
);

do $$
declare
  t text;
begin
  foreach t in array array['signature_statement', 'reauthentication'] loop
    execute format('create trigger capture after insert or update or delete on lims.%I
                    for each row execute function lims.capture()', t);
    execute format('create trigger refuse_change before update or delete on lims.%I
                    for each row execute function lims.refuse_change()', t);
    execute format('create trigger refuse_truncate before truncate on lims.%I
                    for each statement execute function lims.refuse_change()', t);
  end loop;
end $$;

-- The hash and form a Signature holds are copied from its Record Version, the statement hash from the statement, and
-- the session, meaning and authenticator from its re-authentication record; each copy is a foreign key to the row it
-- copies, so none can differ.
alter table lims.record_version add unique (lab_id, id, content_hash, canonical_form);
alter table lims.signature
  add column role                lims.role,
  add column content_hash        bytea,
  add column canonical_form      integer,
  add column statement_version   integer,
  add column statement_hash      bytea,
  add column authenticator       text,
  add column session_id          uuid,
  add column app_release         text check (app_release <> ''),
  add column reauthentication_id uuid unique,
  drop constraint signature_lab_id_record_version_id_fkey,
  add constraint signature_record_version_fkey foreign key (lab_id, record_version_id, content_hash, canonical_form)
    references lims.record_version (lab_id, id, content_hash, canonical_form),
  add foreign key (statement_version, statement_hash) references lims.signature_statement (version, statement_hash),
  add foreign key (lab_id, session_id, person_id) references lims.session (lab_id, id, person_id),
  add constraint signature_reauthentication_fkey
    foreign key (lab_id, reauthentication_id, session_id, person_id, meaning, authenticator)
    references lims.reauthentication (lab_id, id, session_id, person_id, meaning, authenticator);

select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Seed signature statement 1 and record what each thin-slice Signature already held', true);
do $$ begin
  perform lims.lock_chains(variadic array['company'] || coalesce((select array_agg(lab_id::text) from lims.lab), '{}'));
end $$;

insert into lims.signature_statement (version, statement) values (1, convert_to(
  'I sign this record with the Signature Meaning shown, as the person named here. This Electronic Signature is the '
  'legally binding equivalent of my handwritten signature, and I cannot withdraw it.', 'UTF8'));

-- The thin slice's Signatures take the role on the Audit Trail entry that wrote each, or the step registry's role for
-- the meaning where a service wrote it. The statement, the authenticator, the session, the release and the
-- re-authentication record did not exist then and stay null on those rows; the not-valid check requires them on every
-- Signature written from now on.
alter table lims.signature disable trigger refuse_change;
update lims.signature s
   set role = coalesce(
         (select e.role::lims.role from lims.audit_entry e
           where e.chain = s.lab_id::text and e.table_name = 'signature' and e.op = 'INSERT'
             and e.new_row ->> 'id' = s.id::text and e.role = any(enum_range(null::lims.role)::text[])),
         (case s.meaning when 'Performed' then 'Analyst' when 'Reviewed' then 'Reviewer' when 'Released' then 'QA' end)::lims.role),
       content_hash = v.content_hash,
       canonical_form = v.canonical_form
  from lims.record_version v
 where v.lab_id = s.lab_id and v.id = s.record_version_id;
alter table lims.signature enable trigger refuse_change;

alter table lims.signature
  alter column role set not null,
  alter column content_hash set not null,
  alter column canonical_form set not null,
  add constraint signature_given_through_function_check check (
    statement_version is not null and statement_hash is not null and authenticator is not null
    and session_id is not null and app_release is not null and reauthentication_id is not null
  ) not valid;

-- Only lims.sign writes a Signature: it stamps the transaction with the re-authentication record it signs against.
create function lims.refuse_unsigned_insert() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if new.reauthentication_id is null or this_transaction('lims.signing') is distinct from new.reauthentication_id::text then
    raise exception 'a Signature is written only by lims.sign' using errcode = 'LA009';
  end if;
  return new;
end $$;

create trigger sign_only before insert on lims.signature
  for each row execute function lims.refuse_unsigned_insert();

-- True for a row this transaction wrote at its top level: a row written inside a plpgsql exception block carries a
-- subtransaction id and reads as another transaction's.
create function lims.written_here(x xid) returns boolean
language sql volatile as $$ select x = pg_current_xact_id()::xid $$;

-- The one way a Signature is written (#45 gaps 3 and 9; #85 Signing): the signer is the transaction's actor, and the
-- record signed is the latest Record Version of (p_record_table, p_record_id), which is the one the signer saw or the
-- Test Report this transaction created on the Test shown.
create function lims.sign(p_reauthentication_id uuid, p_session_id uuid, p_record_table text, p_record_id uuid,
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
  if proof.id is null then
    raise exception 'no re-authentication record: the signer has not re-entered their credentials' using errcode = 'LA010';
  end if;
  if not written_here(proof.xmin) then
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
    if not exists (select from test_report r
                    where r.lab_id = signed.lab_id and r.id = signed.record_id and signed.record_table = 'test_report'
                      and seen.record_table = 'test' and r.test_id = seen.record_id) then
      raise exception 'the % signed is not built on the Test shown', p_record_table using errcode = 'LA010';
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

revoke execute on function lims.sign(uuid, uuid, text, uuid, uuid, bytea, integer, lims.meaning, text) from public;
grant execute on function lims.sign(uuid, uuid, text, uuid, uuid, bytea, integer, lims.meaning, text) to lims_app;

-- A failed re-authentication at signing is an Access Event of its own kind, counted toward the lockout and the bursts
-- like a failed sign-in.
alter type lims.access_event_kind add value 'ReauthenticationFailed';
alter type lims.sign_in_failure add value 'WrongUserId';

alter table lims.access_event
  drop constraint access_event_session_kind_check,
  drop constraint access_event_failure_check,
  drop constraint access_event_failure_kind_check,
  add constraint access_event_session_kind_check check (
    (session_id is not null
     or kind::text not in ('SignInSucceeded', 'SignOut', 'IdleExpiry', 'AbsoluteExpiry', 'LabSwitch', 'LabSwitchFailed',
                           'Lock', 'Unlock', 'UnlockFailed', 'Takeover', 'ReauthenticationFailed'))
    and (session_id is null or kind <> 'SignInFailed')
  ),
  add constraint access_event_failure_check check (
    (kind::text in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed')) = (failure_reason is not null)
  ),
  add constraint access_event_failure_kind_check check (
    (failure_reason::text not in ('UnknownUserId', 'NoLabChosen') or kind = 'SignInFailed')
    and (failure_reason::text not in ('OtherUserId', 'SessionEnded') or kind::text = 'LabSwitchFailed')
    and (failure_reason::text <> 'WrongUserId' or kind::text = 'ReauthenticationFailed')
  );

-- The kinds are compared as text because a new enum value cannot be used in the transaction that adds it, and an
-- index predicate cannot hold that cast, so the two failure indexes lose their predicate.
drop index lims.access_event_failure_by_address;
drop index lims.access_event_failure_by_subject;
create index access_event_failure_by_address on lims.access_event (source_address, at);
create index access_event_failure_by_subject on lims.access_event (subject_id, at);

create or replace function lims.open_sign_in_incident() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  failures       text[] := '{SignInFailed,ReauthenticationFailed}';
  locked_reasons sign_in_failure[] := '{WrongPasswordOnLockedAccount,AccountLocked}';
  rule           record;
  key_address    inet;
  key_hash       bytea;
  key_subject    uuid;
  seen           int;
begin
  if new.kind = 'Lockout' then
    perform write_sign_in_incident('Lockout', null, null, new.subject_id);
    return null;
  end if;

  for rule in select * from sign_in_burst_rule() loop
    key_address := case when rule.kind = 'SignInBurstFromAddress' then new.source_address end;
    key_hash := case when rule.kind = 'SignInBurstOnUnknownUserId' then new.typed_user_id_hmac end;
    key_subject := case when rule.kind = 'RepeatedSignInOnLockedAccount' and new.failure_reason = any(locked_reasons)
                        then new.subject_id end;
    continue when key_address is null and key_hash is null and key_subject is null;
    continue when exists (select from system_incident i
                           where i.kind::text = rule.kind and i.opened_at > new.at - rule.within
                             and i.source_address is not distinct from key_address
                             and i.typed_user_id_hmac is not distinct from key_hash
                             and i.subject_id is not distinct from key_subject);
    if key_address is not null then
      select count(*) into seen from (select from access_event e where e.kind::text = any(failures)
        and e.source_address = key_address and e.at > new.at - rule.within limit rule.attempts) s;
    elsif key_hash is not null then
      select count(*) into seen from (select from access_event e where e.kind = 'SignInFailed'
        and e.typed_user_id_hmac = key_hash and e.at > new.at - rule.within limit rule.attempts) s;
    else
      select count(*) into seen from (select from access_event e where e.kind::text = any(failures)
        and e.subject_id = key_subject and e.failure_reason = any(locked_reasons)
        and e.at > new.at - rule.within limit rule.attempts) s;
    end if;
    if seen >= rule.attempts then
      perform write_sign_in_incident(rule.kind, key_address, key_hash, key_subject);
    end if;
  end loop;
  return null;
end $$;

drop trigger open_incident on lims.access_event;
create trigger open_incident after insert on lims.access_event
  for each row when (new.kind::text in ('SignInFailed', 'Lockout', 'ReauthenticationFailed'))
  execute function lims.open_sign_in_incident();

revoke insert (lab_id, id, person_id, meaning, record_version_id) on lims.signature from lims_app;
grant select on lims.signature_statement, lims.reauthentication to lims_app;
grant insert (lab_id, session_id, person_id, meaning, authenticator) on lims.reauthentication to lims_app;

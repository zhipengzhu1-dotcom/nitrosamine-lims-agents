set local role lims_owner;

alter type lims.incident_kind add value 'Lockout';
alter type lims.incident_kind add value 'SignInBurstFromAddress';
alter type lims.incident_kind add value 'SignInBurstOnUnknownUserId';
alter type lims.incident_kind add value 'RepeatedSignInOnLockedAccount';

-- An incident raised from Access Events names the account, the address or the unknown-ID hash, and has no failing step.
alter table lims.system_incident
  alter column step drop not null,
  alter column error_class drop not null,
  add column subject_id         uuid  references lims.person,
  add column source_address     inet,
  add column typed_user_id_hmac bytea check (octet_length(typed_user_id_hmac) = 32),
  -- The kinds are compared as text: a new enum value cannot be used in the transaction that adds it.
  add constraint system_incident_facts_check check (
    (kind::text = 'UnexpectedFailure') = (step is not null)
    and (step is null) = (error_class is null)
    and (kind::text in ('Lockout', 'RepeatedSignInOnLockedAccount')) = (subject_id is not null)
    and (kind::text = 'SignInBurstFromAddress') = (source_address is not null)
    and (kind::text = 'SignInBurstOnUnknownUserId') = (typed_user_id_hmac is not null)
  );

-- The burst rules: `attempts` failed sign-ins of the kind's key within `within` open the incident, and while one is
-- younger than `within` the same key opens no other, so a continuing burst raises one incident per window.
create function lims.sign_in_burst_rule() returns table (kind text, attempts int, within interval)
language sql immutable as $$
  values ('SignInBurstFromAddress', 10, interval '15 minutes'),
         ('SignInBurstOnUnknownUserId', 5, interval '15 minutes'),
         ('RepeatedSignInOnLockedAccount', 3, interval '15 minutes')
$$;

create index access_event_failure_by_address on lims.access_event (source_address, at) where kind = 'SignInFailed';
create index access_event_failure_by_hash on lims.access_event (typed_user_id_hmac, at) where kind = 'SignInFailed';
create index access_event_failure_by_subject on lims.access_event (subject_id, at) where kind = 'SignInFailed';

-- Reads bytes of the uuid that hold no fixed version (byte 6) or variant (byte 8) bits.
create function lims.read_aloud_reference() returns text
language sql volatile as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', get_byte(b, i) % 32 + 1, 1), '' order by i)
    from (select uuid_send(gen_random_uuid()) as b) r, unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) i
$$;

-- Writes the incident under the incident service, then puts the transaction's own actor back.
create function lims.write_sign_in_incident(p_kind text, p_address inet, p_hash bytea, p_subject uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  was_actor  text := current_setting('lims.actor', true);
  was_role   text := current_setting('lims.role', true);
  was_reason text := current_setting('lims.reason', true);
begin
  perform set_config('lims.actor', 'svc:incident', true), set_config('lims.role', 'system', true),
          set_config('lims.reason', 'Open a System Incident', true);
  insert into system_incident (kind, reference, source_address, typed_user_id_hmac, subject_id)
  values (p_kind::incident_kind, read_aloud_reference(), p_address, p_hash, p_subject);
  perform set_config('lims.actor', coalesce(was_actor, ''), true), set_config('lims.role', coalesce(was_role, ''), true),
          set_config('lims.reason', coalesce(was_reason, ''), true);
end $$;

-- Runs after capture, so this transaction already holds the company chain and concurrent failures meet in order.
-- Each rule keys on one fact of the attempt; the facts check leaves the other two null on that rule's incidents.
create function lims.open_sign_in_incident() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
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
      select count(*) into seen from (select from access_event e where e.kind = 'SignInFailed'
        and e.source_address = key_address and e.at > new.at - rule.within limit rule.attempts) s;
    elsif key_hash is not null then
      select count(*) into seen from (select from access_event e where e.kind = 'SignInFailed'
        and e.typed_user_id_hmac = key_hash and e.at > new.at - rule.within limit rule.attempts) s;
    else
      select count(*) into seen from (select from access_event e where e.kind = 'SignInFailed'
        and e.subject_id = key_subject and e.failure_reason = any(locked_reasons)
        and e.at > new.at - rule.within limit rule.attempts) s;
    end if;
    if seen >= rule.attempts then
      perform write_sign_in_incident(rule.kind, key_address, key_hash, key_subject);
    end if;
  end loop;
  return null;
end $$;

create trigger open_incident after insert on lims.access_event
  for each row when (new.kind in ('SignInFailed', 'Lockout')) execute function lims.open_sign_in_incident();

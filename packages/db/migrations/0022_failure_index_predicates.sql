set local role lims_owner;

-- 0017 committed the failure kinds, so the two failure indexes hold only failures again.
drop index lims.access_event_failure_by_address;
drop index lims.access_event_failure_by_subject;
create index access_event_failure_by_address on lims.access_event (source_address, at)
  where kind in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed');
create index access_event_failure_by_subject on lims.access_event (subject_id, at)
  where kind in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed');

-- The counts name the kinds as enum values, not text, because the planner reads a partial index only for a condition
-- that implies its predicate.
create or replace function lims.open_sign_in_incident() returns trigger
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
      select count(*) into seen from (select from access_event e where e.kind in ('SignInFailed', 'ReauthenticationFailed')
        and e.source_address = key_address and e.at > new.at - rule.within limit rule.attempts) s;
    elsif key_hash is not null then
      select count(*) into seen from (select from access_event e where e.kind = 'SignInFailed'
        and e.typed_user_id_hmac = key_hash and e.at > new.at - rule.within limit rule.attempts) s;
    else
      select count(*) into seen from (select from access_event e where e.kind in ('SignInFailed', 'ReauthenticationFailed')
        and e.subject_id = key_subject and e.failure_reason = any(locked_reasons)
        and e.at > new.at - rule.within limit rule.attempts) s;
    end if;
    if seen >= rule.attempts then
      perform write_sign_in_incident(rule.kind, key_address, key_hash, key_subject);
    end if;
  end loop;
  return null;
end $$;

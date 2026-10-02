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

-- Skips bytes 6 and 8 of the uuid, whose version and variant bits are fixed.
create function lims.read_aloud_reference() returns text
language sql volatile as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', get_byte(b, i) % 32 + 1, 1), '' order by i)
    from (select uuid_send(gen_random_uuid()) as b) r, unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) i
$$;

-- Runs after capture, so this transaction already holds the company chain and concurrent failures meet in order.
-- The incident is written under the incident service, then the transaction's own actor is put back.
create function lims.open_sign_in_incident() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  was_actor  text := current_setting('lims.actor', true);
  was_role   text := current_setting('lims.role', true);
  was_reason text := current_setting('lims.reason', true);
  rule       record;
  burst      boolean;
begin
  perform set_config('lims.actor', 'svc:incident', true), set_config('lims.role', 'system', true),
          set_config('lims.reason', 'Open a System Incident', true);

  if new.kind = 'Lockout' then
    insert into system_incident (kind, reference, subject_id)
    values ('Lockout', read_aloud_reference(), new.subject_id);
  else
    for rule in select * from sign_in_burst_rule() loop
      burst := case rule.kind
        when 'SignInBurstFromAddress' then
          (select count(*) from access_event e
            where e.kind = 'SignInFailed' and e.source_address = new.source_address and e.at > new.at - rule.within)
            >= rule.attempts
          and not exists (select from system_incident i where i.kind::text = rule.kind
            and i.source_address = new.source_address and i.opened_at > new.at - rule.within)
        when 'SignInBurstOnUnknownUserId' then
          new.typed_user_id_hmac is not null
          and (select count(*) from access_event e
            where e.kind = 'SignInFailed' and e.typed_user_id_hmac = new.typed_user_id_hmac
              and e.at > new.at - rule.within) >= rule.attempts
          and not exists (select from system_incident i where i.kind::text = rule.kind
            and i.typed_user_id_hmac = new.typed_user_id_hmac and i.opened_at > new.at - rule.within)
        when 'RepeatedSignInOnLockedAccount' then
          new.failure_reason in ('WrongPasswordOnLockedAccount', 'AccountLocked')
          and (select count(*) from access_event e
            where e.kind = 'SignInFailed' and e.subject_id = new.subject_id
              and e.failure_reason in ('WrongPasswordOnLockedAccount', 'AccountLocked')
              and e.at > new.at - rule.within) >= rule.attempts
          and not exists (select from system_incident i where i.kind::text = rule.kind
            and i.subject_id = new.subject_id and i.opened_at > new.at - rule.within)
      end;
      if burst then
        insert into system_incident (kind, reference, source_address, typed_user_id_hmac, subject_id)
        values (rule.kind::incident_kind, read_aloud_reference(),
                case when rule.kind = 'SignInBurstFromAddress' then new.source_address end,
                case when rule.kind = 'SignInBurstOnUnknownUserId' then new.typed_user_id_hmac end,
                case when rule.kind = 'RepeatedSignInOnLockedAccount' then new.subject_id end);
      end if;
    end loop;
  end if;

  perform set_config('lims.actor', coalesce(was_actor, ''), true), set_config('lims.role', coalesce(was_role, ''), true),
          set_config('lims.reason', coalesce(was_reason, ''), true);
  return null;
end $$;

create trigger open_incident after insert on lims.access_event
  for each row when (new.kind in ('SignInFailed', 'Lockout')) execute function lims.open_sign_in_incident();

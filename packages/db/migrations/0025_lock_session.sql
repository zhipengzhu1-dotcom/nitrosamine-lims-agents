set local role lims_owner;

-- A session is locked and unlocked only by the two functions below, which stamp the transaction with the session they
-- change, as lims.sign stamps the Signature it writes. So neither lims_app nor the superuser can open a session already
-- locked, backdate a lock, lock an ended session or clear a lock by a statement. Like every trigger, it holds until a
-- superuser disables triggers.
create function lims.refuse_lock_by_statement() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if this_transaction('lims.locking') is distinct from new.id::text then
    raise exception 'a session is locked and unlocked only by lims.lock_session and lims.unlock_session'
      using errcode = 'LA011';
  end if;
  return new;
end $$;

create trigger lock_through_function before update of locked_at on lims.session
  for each row when (new.locked_at is distinct from old.locked_at) execute function lims.refuse_lock_by_statement();
create trigger open_unlocked before insert on lims.session
  for each row when (new.locked_at is not null) execute function lims.refuse_lock_by_statement();

-- The one body behind lock_session and unlock_session. The company chain comes first, the order of end_session, so a
-- lock that meets a Lockout not yet committed waits for it, then finds the session ended at the Lockout's instant and
-- answers null: no Lock lands after a Lockout. A lapsed session is ended at its lapse, with its expiry Access Event,
-- never locked. Only the session's own person, the transaction's actor, may change it. The lock is stamped once the
-- chain is held, at the database clock's instant, and the Lock or Unlock Access Event is written here at that same
-- instant, in the same transaction, when and only when this call changed the lock: true then, false when the session
-- was already so (a repeated press records no second event), null when the session is not live at that instant. Not
-- granted to lims_app: it is reached through the two entry points below.
create function lims.set_session_lock(p_lab_id uuid, p_id uuid, p_locked boolean, idle interval, absolute interval,
                                      p_source_address inet)
returns boolean
language plpgsql set search_path = lims, pg_temp as $$
declare
  actor   text := current_setting('lims.actor', true);
  changed boolean;
  s       record;
  stamped timestamptz;
begin
  perform lock_chain('company');
  perform end_lapsed_sessions(idle, absolute, p_lab_id, p_id);
  select s2.person_id, s2.workstation_id, p.username into s
    from session s2 join person p on p.id = s2.person_id
   where s2.lab_id = p_lab_id and s2.id = p_id;
  if found and actor is distinct from 'person:' || s.username then
    raise exception 'a session is locked and unlocked only by its own person, not %', coalesce(actor, 'no actor')
      using errcode = 'LA012';
  end if;
  perform set_this_transaction('lims.locking', p_id::text);
  stamped := clock_timestamp();
  update session s3
     set locked_at = case when p_locked then coalesce(s3.locked_at, stamped) end
   where s3.lab_id = p_lab_id and s3.id = p_id and s3.ended_at is null
     and session_end(s3.last_seen_at, s3.created_at, idle, absolute) > stamped
  returning (old.locked_at is null) = p_locked into changed;
  perform set_this_transaction('lims.locking', '');
  if changed then
    insert into access_event (kind, subject_id, session_lab_id, session_id, workstation_id, roles, source_address, at)
    values (case when p_locked then 'Lock' else 'Unlock' end::access_event_kind, s.person_id, p_lab_id, p_id,
            s.workstation_id,
            array(select m.role from membership m where m.lab_id = p_lab_id and m.person_id = s.person_id order by m.role),
            p_source_address, stamped);
  end if;
  return changed;
end $$;

-- Locks a session and writes its Lock Access Event; see set_session_lock for the answer. Security definer because
-- lims_app holds no update on locked_at.
create function lims.lock_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval, p_source_address inet)
returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  return set_session_lock(p_lab_id, p_id, true, idle, absolute, p_source_address);
end $$;

-- Unlocks a session and writes its Unlock Access Event, only in a transaction stamped with the session's person
-- re-authenticated, which auditedAfterReauthentication in the API sets once the password was proved and the person's
-- row is held, so a Lockout lands wholly before the unlock, which the API then refuses as accountLocked, or wholly
-- after it. A code path that never proved the credential is refused by the database. Like LA012's actor, the stamp is
-- a setting the API writes: both guard against an API bug, not against a caller that holds lims_app's password.
create function lims.unlock_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval, p_source_address inet)
returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  if this_transaction('lims.reauthenticated') is distinct from
     (select s.person_id::text from session s where s.lab_id = p_lab_id and s.id = p_id) then
    raise exception 'an unlock needs the session''s person re-authenticated in this transaction' using errcode = 'LA013';
  end if;
  return set_session_lock(p_lab_id, p_id, false, idle, absolute, p_source_address);
end $$;

revoke update (locked_at) on lims.session from lims_app;
-- The API stamps its re-authenticated transactions; the stamp is a setting lims_app could set by hand, as it could the
-- re-authentication row a Signature needs, so it proves the API's call order, not the password, which the API checks.
grant execute on function lims.set_this_transaction(text, text) to lims_app;
grant execute on function lims.lock_session(uuid, uuid, interval, interval, inet) to lims_app;
grant execute on function lims.unlock_session(uuid, uuid, interval, interval, inet) to lims_app;

set local role lims_owner;

-- A session is locked and unlocked only by the two functions below, which stamp the transaction with the session they
-- lock, as lims.sign stamps the Signature it writes. So neither lims_app nor the superuser can backdate a lock, lock an
-- ended session or clear a lock by a statement.
create function lims.refuse_unlocked_change() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if this_transaction('lims.locking') is distinct from new.id::text then
    raise exception 'a session is locked and unlocked only by lims.lock_session and lims.unlock_session'
      using errcode = 'LA011';
  end if;
  return new;
end $$;

create trigger lock_through_function before update of locked_at on lims.session
  for each row when (new.locked_at is distinct from old.locked_at) execute function lims.refuse_unlocked_change();

-- Locks a session at now(), the database clock, and says whether this call did: true when it locked the session,
-- false when the session was already locked, so a repeated press writes no second Lock Access Event, and null when
-- the session is not live. The company chain comes first, the order of end_session, so a lock that meets a Lockout
-- not yet committed waits for it, then finds the session ended at the Lockout's instant and answers null: no Lock
-- lands after a Lockout. A lapsed session is ended at its lapse, with its expiry Access Event, never locked.
-- Security definer because lims_app holds no update on locked_at; the caller writes the Lock Access Event in the
-- same transaction, under its audit context.
create function lims.lock_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval) returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  was_unlocked boolean;
begin
  perform lock_chain('company');
  perform end_lapsed_sessions(idle, absolute, p_lab_id, p_id);
  perform set_this_transaction('lims.locking', p_id::text);
  update session s
     set locked_at = coalesce(s.locked_at, now())
   where s.lab_id = p_lab_id and s.id = p_id and s.ended_at is null
     and session_end(s.last_seen_at, s.created_at, idle, absolute) > now()
  returning old.locked_at is null into was_unlocked;
  perform set_this_transaction('lims.locking', '');
  return was_unlocked;
end $$;

-- Unlocks a session and says whether this call did, as lock_session does: true, false when it was not locked, null
-- when it is not live. The caller proves the person's credential first and holds their row, so a Lockout lands wholly
-- before this, which then finds the session ended at it, or wholly after.
create function lims.unlock_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval) returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  was_locked boolean;
begin
  perform lock_chain('company');
  perform end_lapsed_sessions(idle, absolute, p_lab_id, p_id);
  perform set_this_transaction('lims.locking', p_id::text);
  update session s
     set locked_at = null
   where s.lab_id = p_lab_id and s.id = p_id and s.ended_at is null
     and session_end(s.last_seen_at, s.created_at, idle, absolute) > now()
  returning old.locked_at is not null into was_locked;
  perform set_this_transaction('lims.locking', '');
  return was_locked;
end $$;

revoke update (locked_at) on lims.session from lims_app;
grant execute on function lims.lock_session(uuid, uuid, interval, interval) to lims_app;
grant execute on function lims.unlock_session(uuid, uuid, interval, interval) to lims_app;

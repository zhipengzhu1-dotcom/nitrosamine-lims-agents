set local role lims_owner;

-- One Lockout Access Event per lock. stamp_lockout stamps a Lockout at its person's lock instant, which lock_once lets
-- land only once, so a second Lockout for the same lock names the same person and instant, and is refused here.
create unique index access_event_one_lockout_per_lock on lims.access_event (subject_id, at) where kind = 'Lockout';

-- Ends a session as 0019's did, but first takes the company chain, which a Lockout holds from its person update until
-- it commits. So a sign-out, takeover or Lab switch that meets a Lockout not yet committed waits for it, then sees the
-- lock and ends the session at the Lockout's instant, never at a later now() that would outlive it. The chain comes
-- before any session row, the order of 0005 and 0019; a share lock on the person row instead could deadlock with a
-- takeover, which holds the signer's row before it ends the earlier session.
create or replace function lims.end_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval) returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform lock_chain('company');
  perform end_lapsed_sessions(idle, absolute, p_lab_id, p_id);
  update session s
     set ended_at = now()
   where s.lab_id = p_lab_id and s.id = p_id and s.ended_at is null
     and session_end(s.last_seen_at, s.created_at, idle, absolute) > now();
  return found;
end $$;

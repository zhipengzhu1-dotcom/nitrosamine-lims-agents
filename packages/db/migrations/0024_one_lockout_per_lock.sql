set local role lims_owner;

-- One Lockout Access Event per lock. stamp_lockout stamps a Lockout at its person's lock instant, which lock_once lets
-- land only once, so a second Lockout for the same lock names the same person and instant, and is refused here.
create unique index access_event_one_lockout_per_lock on lims.access_event (subject_id, at) where kind = 'Lockout';

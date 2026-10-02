set local role lims_owner;

-- A person inserted with locked_at set was locked without lock_once: no stamp at the database clock, no company chain
-- taken, and no Lockout Access Event, which the API writes only after the lock it applies by update.
create function lims.refuse_locked_insert() returns trigger
language plpgsql as $$
begin
  raise exception 'a person is recorded unlocked; a lock lands only on a recorded person, with its Lockout Access Event'
    using errcode = '23514';
end $$;

create trigger insert_unlocked before insert on lims.person
  for each row when (new.locked_at is not null) execute function lims.refuse_locked_insert();

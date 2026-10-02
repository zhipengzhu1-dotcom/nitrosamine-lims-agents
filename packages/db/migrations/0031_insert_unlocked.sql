set local role lims_owner;

-- A person is inserted unlocked, so every lock lands through lock_once. A person inserted with locked_at set was
-- locked without it: no stamp at the database clock, no company chain taken, and no Lockout Access Event, which the
-- API writes only after the lock it applies by update.
create function lims.refuse_locked_insert() returns trigger
language plpgsql as $$
begin
  raise exception 'a person is inserted unlocked; a lock lands only through lock_once' using errcode = '23514';
end $$;

create trigger insert_unlocked before insert on lims.person
  for each row when (new.locked_at is not null) execute function lims.refuse_locked_insert();

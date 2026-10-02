set local role lims_owner;

-- A person is inserted without a lockout, so every lockout lands by update through lock_once. A person inserted with
-- locked_at set was locked out without it: no stamp at the database clock, no company chain taken, and no Lockout
-- Access Event, which the API writes only after the lockout it applies by update.
create function lims.refuse_locked_insert() returns trigger
language plpgsql as $$
begin
  raise exception 'a person is inserted without a lockout; a lockout lands only on a person already recorded'
    using errcode = '23514';
end $$;

create trigger insert_unlocked before insert on lims.person
  for each row when (new.locked_at is not null) execute function lims.refuse_locked_insert();

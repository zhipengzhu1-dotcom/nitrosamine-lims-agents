set local role lims_owner;

-- A person's lock takes the company chain before it is stamped, the order of end_session and set_session_lock, so a
-- Lockout that meets a Lock not yet committed waits for it and lands after it: its instant, which stamps the Lockout
-- Access Event and ends the person's sessions, can never fall before a Lock Access Event already recorded. 0019
-- stamped first and took the chain only in the Audit Trail capture that followed, which left the order to the API.
-- Security definer because lims_app may set locked_at but holds no execute on lock_chain.
create or replace function lims.lock_once() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  if old.locked_at is not null then
    raise exception 'a lockout stands; it cannot be moved or cleared' using errcode = '23514';
  end if;
  perform lock_chain('company');
  new.locked_at := clock_timestamp();
  return new;
end $$;

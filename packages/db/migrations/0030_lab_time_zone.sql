set local role lims_owner;

-- A Lab's time zone is configuration that every Lab-clock time is read with, so the app cannot change it; a migration
-- does, under its own reason on the Lab's chain (#243).
revoke update on lims.lab from lims_app;
grant update (code, name) on lims.lab to lims_app;

-- The zone a Lab's chain records in force at an instant: the last zone written at or before it, else the zone the
-- first later change replaced, else the zone the Lab holds now.
create function lims.lab_time_zone_at(p_lab_id uuid, p_at timestamptz) returns text
language sql stable set search_path = lims, pg_temp as $$
  select coalesce(
    (select e.new_row ->> 'time_zone' from audit_entry e
      where e.chain = p_lab_id::text and e.table_name = 'lab' and e.at <= p_at and e.new_row ? 'time_zone'
      order by e.seq desc limit 1),
    (select e.old_row ->> 'time_zone' from audit_entry e
      where e.chain = p_lab_id::text and e.table_name = 'lab' and e.at > p_at and e.old_row ? 'time_zone'
      order by e.seq limit 1),
    (select time_zone from lab where lab_id = p_lab_id))
$$;

-- A Signature and a Received keep the Lab's zone in force when they were written (Annex 11 draft §13.4), so their
-- Lab-clock half reads the same after the Lab's zone changes.
alter table lims.signature add column signed_time_zone text;
alter table lims.sample add column received_time_zone text;

select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Keep each Signature and Received with the Lab time zone in force when it was written', true);
do $$ begin
  if exists (select from lims.lab) then
    perform lims.lock_chains(variadic (select array_agg(lab_id::text) from lims.lab));
  end if;
end $$;
-- A thin-slice Signature holds none of what the signing function records, and a not-valid check still refuses an
-- update of such a row, so the check stands aside while the zone is written and returns unchanged.
alter table lims.signature disable trigger refuse_change, drop constraint signature_given_through_function_check;
update lims.signature set signed_time_zone = lims.lab_time_zone_at(lab_id, signed_at);
alter table lims.signature enable trigger refuse_change,
  add constraint signature_given_through_function_check check (
    statement_version is not null and statement_hash is not null and authenticator is not null
    and session_id is not null and app_release is not null and reauthentication_id is not null
  ) not valid;
alter table lims.signature alter column signed_time_zone set not null;
update lims.sample set received_time_zone = lims.lab_time_zone_at(lab_id, received_at) where received_at is not null;

create function lims.sign_in_lab_time_zone() returns trigger language plpgsql as $$
begin
  -- for a Lab that does not exist it stays null, and not null refuses the row
  select time_zone into new.signed_time_zone from lims.lab where lab_id = new.lab_id;
  return new;
end $$;
create trigger sign_in_lab_time_zone before insert on lims.signature
  for each row execute function lims.sign_in_lab_time_zone();

create function lims.receive_in_lab_time_zone() returns trigger language plpgsql as $$
begin
  if new.received_at is null then
    new.received_time_zone := null;
  elsif tg_op = 'UPDATE' and new.received_at is not distinct from old.received_at then
    new.received_time_zone := old.received_time_zone;
  else
    select time_zone into new.received_time_zone from lims.lab where lab_id = new.lab_id;
  end if;
  return new;
end $$;
create trigger receive_in_lab_time_zone before insert or update on lims.sample
  for each row execute function lims.receive_in_lab_time_zone();

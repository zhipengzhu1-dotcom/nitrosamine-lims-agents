set local role lims_owner;

-- The Audit Trail panel shows each Lab-chain entry's time in the owning Lab's zone beside UTC (map #1, Time and clocks).
-- Only a name the database lists counts: `at time zone` would also take a POSIX rule string such as 'EST5EDT'.
create function lims.is_time_zone(p_zone text) returns boolean
language sql stable as $$
  select exists (select from pg_timezone_names where name = p_zone)
$$;

alter table lims.lab add column time_zone text not null default 'UTC' constraint lab_time_zone_check check (lims.is_time_zone(time_zone));

grant execute on function lims.is_time_zone(text) to lims_app;

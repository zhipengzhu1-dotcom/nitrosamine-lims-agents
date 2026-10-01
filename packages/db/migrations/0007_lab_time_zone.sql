set local role lims_owner;

-- A canonical name the database lists, so that a zone is never a POSIX rule string, an abbreviation, an alias or 'Factory'.
create function lims.is_time_zone(p_zone text) returns boolean
language sql stable as $$
  select exists (
    select from pg_timezone_names
     where name = p_zone and name !~ '^(posix|right)/' and name <> 'Factory'
  )
$$;

alter table lims.lab add column time_zone text not null default 'UTC' constraint lab_time_zone_check check (lims.is_time_zone(time_zone));

grant execute on function lims.is_time_zone(text) to lims_app;
grant select on lims.audit_chain to lims_app;

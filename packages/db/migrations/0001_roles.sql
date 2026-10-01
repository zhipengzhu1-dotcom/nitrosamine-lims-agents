-- Runs as the cluster superuser. Roles are cluster-wide, so this is safe to run once per database.
do $$
begin
  if not exists (select from pg_roles where rolname = 'lims_owner') then
    create role lims_owner nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'lims_app') then
    create role lims_app login;
  end if;
end $$;

alter role lims_app set search_path = lims;
alter default privileges for role lims_owner revoke execute on functions from public;

create schema lims authorization lims_owner;
grant usage on schema lims to lims_app;

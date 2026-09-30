-- Cluster roles. Run once per cluster by the Platform Operator (or the test harness) as a
-- superuser, before any database is migrated. Idempotent.
--
-- lims_owner     NOLOGIN. Owns every schema, table, trigger and SECURITY DEFINER function.
-- lims_migrator  LOGIN, member of lims_owner. Used only by the migration runner, which does
--                SET LOCAL ROLE lims_owner inside each migration transaction.
-- lims_app       LOGIN. What the API and the seed connect as. Owns nothing, cannot SET ROLE to
--                the owner, cannot create objects. Its DML rights come only from the grants that
--                lims.register_table issues.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lims_owner') then
    create role lims_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'lims_migrator') then
    create role lims_migrator login noinherit;
    grant lims_owner to lims_migrator;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'lims_app') then
    create role lims_app login noinherit nocreatedb nocreaterole;
  end if;
end $$;

alter role lims_app set search_path = lims;
alter role lims_migrator set search_path = lims;

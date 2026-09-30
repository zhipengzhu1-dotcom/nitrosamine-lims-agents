-- The schema, the migration ledger, and the privilege baseline every later migration inherits.

create schema lims authorization lims_owner;
revoke all on schema public from public;
grant usage on schema lims to lims_app;

-- A function is callable by the app only when a migration grants it by name. Postgres's default
-- gives PUBLIC execute on every new function; this default privilege turns that off for
-- everything lims_owner creates in lims from here on, so the SECURITY DEFINER helpers that write
-- the audit trail and the record versions cannot be called directly by lims_app.
alter default privileges for role lims_owner in schema lims revoke execute on functions from public;

create table lims.migration (
  name       text primary key,
  applied_at timestamptz not null default clock_timestamp()
);

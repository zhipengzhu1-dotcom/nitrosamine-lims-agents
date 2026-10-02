set local role lims_owner;

-- The one timestamp not from the database clock: the API host's instant on the log line of a System Incident the
-- database could not write when the failure happened. Null for every incident written at the time.
alter table lims.system_incident add column logged_at timestamptz;

grant insert (logged_at) on lims.system_incident to lims_app;

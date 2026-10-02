set local role lims_owner;

-- The API host's instant on the log line of a System Incident raised from the log; null for one written at the time.
alter table lims.system_incident add column logged_at timestamptz;

grant insert (logged_at) on lims.system_incident to lims_app;

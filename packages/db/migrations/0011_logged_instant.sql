set local role lims_owner;

-- The API host's instant on the log line of a System Incident raised from the log; null for one written at the time.
alter table lims.system_incident add column logged_at timestamptz;

-- A line the check could not raise as its own System Incident: unreadable, refused by the database, or naming a
-- reference that a different System Incident already holds.
alter type lims.incident_kind add value 'UnraisableLogLine';

grant insert (logged_at) on lims.system_incident to lims_app;

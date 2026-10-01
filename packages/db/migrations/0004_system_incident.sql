set local role lims_owner;

create type lims.incident_kind as enum ('UnexpectedFailure');
create type lims.incident_state as enum ('Open');

-- Company-owned. The Lab is in session_lab_id, not lab_id, so lims.capture() writes it to the company chain.
-- It holds no error message: the class, SQLSTATE and constraint name say what failed without quoting a record.
create table lims.system_incident (
  id              uuid                primary key default gen_random_uuid(),
  kind            lims.incident_kind  not null,
  reference       text                not null unique check (reference ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  opened_at       timestamptz         not null default clock_timestamp(),
  requested_by    uuid                references lims.person,
  session_lab_id  uuid                references lims.lab,
  step            text                not null,
  record_id       uuid,
  error_class     text                not null,
  sqlstate        text                check (sqlstate ~ '^[0-9A-Z]{5}$'),
  constraint_name text,
  state           lims.incident_state not null default 'Open'
);

create function lims.keep_incident_facts() returns trigger
language plpgsql as $$
begin
  if to_jsonb(new) - 'state' is distinct from to_jsonb(old) - 'state' then
    raise exception 'a System Incident''s recorded facts are never changed' using errcode = 'LA002';
  end if;
  return new;
end $$;

create trigger capture after insert or update or delete on lims.system_incident
  for each row execute function lims.capture();
create trigger keep_facts before update on lims.system_incident
  for each row execute function lims.keep_incident_facts();
create trigger refuse_change before delete on lims.system_incident
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.system_incident
  for each statement execute function lims.refuse_change();

grant select on lims.system_incident to lims_app;
grant insert (kind, reference, requested_by, session_lab_id, step, record_id, error_class, sqlstate, constraint_name)
  on lims.system_incident to lims_app;

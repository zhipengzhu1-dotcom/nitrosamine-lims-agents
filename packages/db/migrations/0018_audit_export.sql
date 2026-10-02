set local role lims_owner;

create type lims.audit_export_format as enum ('JSON', 'CSV');

-- One Audit Export QA generated for one Customer: who asked, in which format, how many entries it held, and the
-- SHA-256 of the data file and of the PDF handed out. The files are not kept; a copy the Customer holds is checked
-- against these hashes. requested_role names the QA Membership the request was made under, so the database refuses an
-- export by anyone who is not QA in the Lab.
create table lims.audit_export (
  lab_id         uuid                     not null references lims.lab,
  id             uuid                     not null default gen_random_uuid(),
  customer_id    uuid                     not null references lims.customer,
  requested_by   uuid                     not null,
  requested_role lims.role                not null default 'QA' check (requested_role = 'QA'),
  format         lims.audit_export_format not null,
  entry_count    integer                  not null check (entry_count >= 0),
  data_sha256    bytea                    not null check (octet_length(data_sha256) = 32),
  pdf_sha256     bytea                    not null check (octet_length(pdf_sha256) = 32),
  generated_at   timestamptz              not null default clock_timestamp(),
  primary key (lab_id, id),
  foreign key (lab_id, requested_by, requested_role) references lims.membership (lab_id, person_id, role)
);

create trigger capture after insert or update or delete on lims.audit_export
  for each row execute function lims.capture();
create trigger refuse_change before update or delete on lims.audit_export
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.audit_export
  for each statement execute function lims.refuse_change();

grant select on lims.audit_export to lims_app;
grant insert (lab_id, customer_id, requested_by, format, entry_count, data_sha256, pdf_sha256)
  on lims.audit_export to lims_app;

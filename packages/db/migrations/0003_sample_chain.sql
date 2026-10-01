set local role lims_owner;

create type lims.role as enum ('Customer', 'SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager', 'Admin');
create type lims.test_state as enum ('Requested', 'Ready', 'Assigned', 'SubmittedForReview', 'Reviewed', 'Reported');
create type lims.meaning as enum ('Performed', 'Verified', 'Reviewed', 'Approved', 'Released', 'Authored', 'Acknowledged');

-- Company-owned.

create table lims.customer (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table lims.person (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  display_name  text not null,
  customer_id   uuid references lims.customer,
  password_hash text not null,
  totp_secret   text not null,
  failed_logins int  not null default 0,
  locked_at     timestamptz
);

create table lims.method (
  id      uuid primary key default gen_random_uuid(),
  code    text not null,
  version text not null,
  title   text not null,
  unique (code, version)
);

create table lims.submission (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references lims.customer,
  submitted_by uuid not null references lims.person
);

-- Lab-owned. Children reference (lab_id, parent id), so no row can point into another Lab.

create table lims.lab (
  lab_id uuid primary key default gen_random_uuid(),
  code   text not null unique check (code ~ '^[A-Z]{2,4}$'),
  name   text not null
);

create table lims.membership (
  lab_id    uuid not null references lims.lab,
  person_id uuid not null references lims.person,
  role      lims.role not null,
  primary key (lab_id, person_id, role)
);

create table lims.training_record (
  lab_id    uuid not null references lims.lab,
  person_id uuid not null references lims.person,
  method_id uuid not null references lims.method,
  primary key (lab_id, person_id, method_id)
);

create table lims.sample (
  lab_id        uuid not null references lims.lab,
  id            uuid not null default gen_random_uuid(),
  submission_id uuid not null references lims.submission,
  number        text not null,
  description   text not null,
  received_at   timestamptz,
  primary key (lab_id, id),
  unique (lab_id, number)
);

create table lims.test (
  lab_id      uuid not null references lims.lab,
  id          uuid not null default gen_random_uuid(),
  sample_id   uuid not null,
  method_id   uuid not null references lims.method,
  state       lims.test_state not null default 'Requested',
  gxp_class   text not null default 'GMP' check (gxp_class in ('GMP', 'non-GMP')),
  assignee_id uuid references lims.person,
  primary key (lab_id, id),
  foreign key (lab_id, sample_id) references lims.sample
);

create table lims.result (
  lab_id                 uuid    not null references lims.lab,
  id                     uuid    not null default gen_random_uuid(),
  test_id                uuid    not null,
  analyte                text    not null,
  value                  numeric not null,
  unit                   text    not null,
  injection_sequence_ref text    not null,
  notebook_ref           text    not null,
  performed_on           date    not null,
  entered_by             uuid    not null references lims.person,
  primary key (lab_id, id),
  foreign key (lab_id, test_id) references lims.test
);

create table lims.test_report (
  lab_id  uuid not null references lims.lab,
  id      uuid not null default gen_random_uuid(),
  test_id uuid not null,
  number  text not null,
  primary key (lab_id, id),
  unique (lab_id, number),
  unique (lab_id, test_id),
  foreign key (lab_id, test_id) references lims.test
);

-- The signed Record Version is stored as bytes and hashed by the database, so a signature never
-- depends on re-serialising rows later.
create table lims.signature (
  lab_id       uuid        not null references lims.lab,
  id           uuid        not null default gen_random_uuid(),
  person_id    uuid        not null references lims.person,
  meaning      lims.meaning not null,
  record_table text        not null check (record_table in ('test', 'test_report')),
  record_id    uuid        not null,
  content      bytea       not null,
  content_hash bytea       not null generated always as (sha256(content)) stored,
  signed_at    timestamptz not null default clock_timestamp(),
  primary key (lab_id, id)
);

-- Not audited: sign-in state is not a record, and touching last_seen_at on every request would flood the trail.
create table lims.session (
  lab_id       uuid        not null references lims.lab,
  id           uuid        not null default gen_random_uuid(),
  person_id    uuid        not null references lims.person,
  token_hash   bytea       not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  primary key (lab_id, id)
);

do $$
declare
  t text;
begin
  foreach t in array array['customer', 'person', 'method', 'submission', 'lab', 'membership', 'training_record',
                           'sample', 'test', 'result', 'test_report', 'signature'] loop
    execute format('create trigger capture after insert or update or delete on lims.%I
                    for each row execute function lims.capture()', t);
  end loop;
  foreach t in array array['audit_entry', 'signature'] loop
    execute format('create trigger refuse_change before update or delete on lims.%I
                    for each row execute function lims.refuse_change()', t);
    execute format('create trigger refuse_truncate before truncate on lims.%I
                    for each statement execute function lims.refuse_change()', t);
  end loop;
end $$;

grant select, insert, update on lims.customer, lims.person, lims.method, lims.submission, lims.lab, lims.membership,
  lims.training_record, lims.sample, lims.test, lims.session to lims_app;
grant select, insert on lims.result, lims.test_report to lims_app;
grant select on lims.signature, lims.audit_entry to lims_app;
grant insert (lab_id, id, person_id, meaning, record_table, record_id, content) on lims.signature to lims_app;
grant execute on function lims.verify_chain(text) to lims_app;

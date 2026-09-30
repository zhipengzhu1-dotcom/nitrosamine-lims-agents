-- The sample chain: company reference data (Customer, Product, Substance, Method versions,
-- Specifications), Lab reference data (Method Adoption, Equipment), and Submission -> Sample ->
-- Test -> Preparation, Run, Review, Test Report, the issued PDF and the stored verdicts.
--
-- Signable heads hold identity and in-place lifecycle only. Every typed value (a Preparation's
-- weight, a Run Check value, a Reviewer's tick) is a Recorded Value under the head; every signed
-- state is a Record Version. A reference record's structured data (a Method version's Analytes and
-- Run Checks, a Specification's Sections and Lines) is an identity column of its head, written
-- once, and the sealed bytes carry the same data: both are immutable, so they cannot drift.

-- ---------------------------------------------------------------------------------------------
-- A Customer writes its own rows into the Lab that will test them (decision 12: Samples exist as
-- Expected from the moment the Submission is made). The Lab guard therefore admits an INSERT by a
-- Customer context of a row that names that Customer, plus the bare record row a signable head
-- requires. Everything else a Customer might write to a Lab ledger is still LA006.
-- ---------------------------------------------------------------------------------------------
create or replace function lims.capture() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx      jsonb := lims.require_context();
  newj     jsonb := to_jsonb(new);
  oldj     jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  redacted text[] := string_to_array(tg_argv[3], ',');
  diff     jsonb := '{}'::jsonb;
  ledger   uuid;
  k        text;
  customer_own boolean;
begin
  ledger := case tg_argv[0] when 'company' then lims.company_ledger() else (newj->>tg_argv[0])::uuid end;
  if ledger is null then
    raise exception 'row on % names no ledger', tg_table_name using errcode = 'LA006';
  end if;
  customer_own := tg_op = 'INSERT' and (ctx->>'customer_id') is not null
                  and (tg_table_name = 'record' or coalesce(newj->>'customer_id' = ctx->>'customer_id', false));
  if ctx->>'role' not like 'svc:%'
     and exists (select 1 from lims.lab where id = ledger)
     and ledger is distinct from (ctx->>'acting_lab_id')::uuid
     and not customer_own then
    raise exception 'row for Lab % written while acting in Lab %', ledger, ctx->>'acting_lab_id' using errcode = 'LA006';
  end if;
  if tg_op = 'UPDATE' and ctx->>'reason_code' = 'first_save' then
    raise exception 'a change after first save needs a Reason for Change' using errcode = 'LA007';
  end if;
  for k in select jsonb_object_keys(newj) loop
    if oldj is null or (oldj->k) is distinct from (newj->k) then
      if k = any (redacted) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(case when oldj is null then null else '[changed]' end, '[changed]'));
      else
        diff := diff || jsonb_build_object(k, jsonb_build_array(oldj->k, newj->k));
      end if;
    end if;
  end loop;
  if diff = '{}'::jsonb then
    return null;
  end if;
  perform lims.append_audit(
    ledger, tg_table_name,
    (select jsonb_agg(newj->c) from unnest(string_to_array(tg_argv[1], ',')) c)::text,
    case when tg_argv[2] <> '' then (newj->>tg_argv[2])::uuid end,
    lower(tg_op), diff);
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Numbering. Operational, exempt from capture like session_activity: the number lands on the
-- audited row it is assigned to.
-- ---------------------------------------------------------------------------------------------
create table lims.counter (
  scope text not null,   -- a Lab id, or 'company'
  kind  text not null,
  year  int  not null,
  next  int  not null,
  primary key (scope, kind, year)
);
grant select, insert, update on lims.counter to lims_app;

create function lims.next_number(p_scope text, p_kind text, p_year int) returns int
language sql volatile as $$
  insert into lims.counter (scope, kind, year, next) values (p_scope, p_kind, p_year, 1)
  on conflict (scope, kind, year) do update set next = lims.counter.next + 1
  returning next
$$;
grant execute on function lims.next_number(text, text, int) to lims_app;

-- ---------------------------------------------------------------------------------------------
-- Company reference data
-- ---------------------------------------------------------------------------------------------
create table lims.customer (
  id   uuid primary key,
  code text not null unique,
  name text not null
);
select lims.register_table('lims.customer', 'company', false);

create table lims.substance (
  id   uuid primary key,
  cas  text not null unique,
  name text not null,
  kind text not null check (kind in ('api', 'small-nitrosamine', 'ndsri', 'other-impurity', 'internal-standard'))
);
select lims.register_table('lims.substance', 'company', false);

create table lims.product (
  id               uuid primary key,
  customer_id      uuid not null references lims.customer (id),
  code             text not null,
  name             text not null,
  api_substance_id uuid not null references lims.substance (id),
  unique (customer_id, code)
);
select lims.register_table('lims.product', 'company', false);

create table lims.method (
  id     uuid primary key,
  number text not null unique,
  title  text not null
);
select lims.register_table('lims.method', 'company', false);

-- A Method version is a signable company record (kind method_version). `data` is its structured
-- content (decision 36): Analytes, calculation, replication, variability, Run Checks with written
-- limits and their source, prerequisite Documents. Numbers inside are decimal strings.
create table lims.method_version (
  id        uuid not null primary key,
  method_id uuid not null references lims.method (id),
  version   int  not null,
  data      jsonb not null,
  foreign key (id) references lims.record (id),
  unique (method_id, version)
);
select lims.register_signable_head('lims.method_version', array[]::text[], 'company');

-- A Specification is a signable company record (kind specification); its Record Versions are the
-- Specification versions a Test pins. `data` holds the Sections and Lines as written (decision 29).
create table lims.specification (
  id         uuid not null primary key,
  product_id uuid not null references lims.product (id),
  purpose    text not null,
  data       jsonb not null,
  foreign key (id) references lims.record (id)
);
select lims.register_signable_head('lims.specification', array[]::text[], 'company');

-- The Customer Approver's audited accept of one Specification version: never a signature.
create table lims.specification_acceptance (
  id                       uuid primary key,
  specification_version_id uuid  not null references lims.record_version (id),
  content_hash             bytea not null,
  customer_id              uuid  not null references lims.customer (id),
  accepted_by              uuid  not null references lims.person (id),
  at                       timestamptz not null default clock_timestamp(),
  unique (specification_version_id, customer_id)
);
select lims.register_table('lims.specification_acceptance', 'company', true);

-- ---------------------------------------------------------------------------------------------
-- Lab reference data
-- ---------------------------------------------------------------------------------------------
-- A Method Adoption (kind method_adoption): the Lab's status on one Method version for a scope of
-- Products. A new status is a new Adoption, so the head has no lifecycle column.
create table lims.method_adoption (
  lab_id            uuid not null references lims.lab (id),
  id                uuid not null,
  method_version_id uuid not null references lims.method_version (id),
  status            text not null check (status in ('in-development', 'validated-here', 'transferred-in', 'verified', 'verified-basic-compendial', 'retired')),
  primary key (lab_id, id),
  foreign key (lab_id, id) references lims.record (ledger_id, id)
);
select lims.register_signable_head('lims.method_adoption', array[]::text[]);

create table lims.method_adoption_scope (
  lab_id      uuid not null,
  adoption_id uuid not null,
  product_id  uuid not null references lims.product (id),
  primary key (lab_id, adoption_id, product_id),
  foreign key (lab_id, adoption_id) references lims.method_adoption (lab_id, id)
);
select lims.register_table('lims.method_adoption_scope', 'lab_id', true, 'adoption_id');

-- Fitness Status is a stub in the slice: seeded, changed by nothing. Checks are rough screens.
create table lims.equipment (
  lab_id         uuid not null references lims.lab (id),
  id             uuid not null,
  code           text not null,
  kind           text not null,
  fitness_status text not null check (fitness_status in ('Quarantined', 'In use', 'Suspended', 'Expired', 'Retired')),
  primary key (lab_id, id),
  unique (lab_id, code)
);
select lims.register_table('lims.equipment', 'lab_id', false);

-- ---------------------------------------------------------------------------------------------
-- The sample chain
-- ---------------------------------------------------------------------------------------------
-- A Submission is company-owned: one request to the company. Accepted, Rejected and progress are
-- derived from its Tests (decision 12); only what a person did is stored.
create table lims.submission (
  id            uuid primary key,
  customer_id   uuid not null references lims.customer (id),
  number        text not null unique,
  entered_by    uuid not null references lims.person (id),
  submitted_at  timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  unique (id, customer_id)
);
select lims.register_table('lims.submission', 'company', false);

-- A Sample is Lab-owned and carries its Customer, so Customer scoping is a column, never a join
-- a query could forget. Its Lab-coded number is assigned at receipt.
create table lims.sample (
  lab_id        uuid not null references lims.lab (id),
  id            uuid not null,
  customer_id   uuid not null,
  submission_id uuid not null,
  product_id    uuid not null references lims.product (id),
  lot_number    text not null,
  number        text,
  state         text not null check (state in ('Expected', 'Received', 'RejectedAtReceipt', 'Retained', 'ReturnedToCustomer', 'Disposed')),
  received_at   timestamptz,
  received_by   uuid references lims.person (id),
  primary key (lab_id, id),
  unique (lab_id, number),
  foreign key (submission_id, customer_id) references lims.submission (id, customer_id)
);
select lims.register_table('lims.sample', 'lab_id', false);

-- A Test (kind test). The Method version and the Specification version are pinned at Acceptance
-- and the number at receipt: identity set once from null (head_guard). State, the acceptance
-- reason and the assignee are its lifecycle.
create table lims.test (
  lab_id                   uuid not null references lims.lab (id),
  id                       uuid not null,
  customer_id              uuid not null,
  sample_id                uuid not null,
  seq                      int  not null,
  method_id                uuid not null references lims.method (id),
  method_version_id        uuid references lims.method_version (id),
  specification_version_id uuid references lims.record_version (id),
  number                   text,
  gxp_class                text not null default 'GMP' check (gxp_class in ('GMP', 'non-GMP')),
  state                    text not null check (state in ('Requested', 'Accepted', 'Rejected', 'Ready', 'Assigned', 'InProgress',
                                                          'SubmittedForReview', 'Reviewed', 'Reported', 'Cancelled', 'Invalidated')),
  acceptance_reason        text,
  assigned_analyst         uuid references lims.person (id),
  primary key (lab_id, id),
  unique (lab_id, number),
  unique (lab_id, sample_id, seq),
  foreign key (lab_id, id) references lims.record (ledger_id, id),
  foreign key (lab_id, sample_id) references lims.sample (lab_id, id)
);
select lims.register_signable_head('lims.test', array['state', 'acceptance_reason', 'assigned_analyst']);

-- A Preparation is identity only; its weight, dilution volume and results are Recorded Values on
-- the Test (fields prep.weight, prep.dilution, prep.result with subject P<n> or P<n>/<Analyte>).
create table lims.preparation (
  lab_id  uuid not null,
  id      uuid not null,
  test_id uuid not null,
  prep_no int  not null,
  primary key (lab_id, id),
  foreign key (lab_id, test_id) references lims.test (lab_id, id),
  unique (lab_id, test_id, prep_no)
);
select lims.register_table('lims.preparation', 'lab_id', true, 'test_id');

-- A Run (kind run). Its instrument, sequence ID, True Copy and Run Check values are Recorded
-- Values; its state is derived from the standing signatures on its effective version.
create table lims.run (
  lab_id            uuid not null references lims.lab (id),
  id                uuid not null,
  number            text not null,
  method_version_id uuid not null references lims.method_version (id),
  acquired_by       uuid not null references lims.person (id),
  entry_mode        text not null check (entry_mode in ('typed')),
  primary key (lab_id, id),
  unique (lab_id, number),
  foreign key (lab_id, id) references lims.record (ledger_id, id)
);
select lims.register_signable_head('lims.run', array[]::text[]);

create table lims.run_test (
  lab_id  uuid not null,
  run_id  uuid not null,
  test_id uuid not null,
  primary key (lab_id, run_id, test_id),
  foreign key (lab_id, run_id) references lims.run (lab_id, id),
  foreign key (lab_id, test_id) references lims.test (lab_id, id)
);
select lims.register_table('lims.run_test', 'lab_id', true, 'run_id');

-- A Review (kind review): the signer's attestation. Its Recorded Values are the checklist ticks
-- and, for a release, QA's per-verdict confirmations. Its version is cited by the Reviewed or
-- Released signature (signature.attestation_version_id).
create table lims.review (
  lab_id            uuid not null,
  id                uuid not null,
  reviews_record_id uuid not null,
  checklist_version text not null,
  reviewer_id       uuid not null references lims.person (id),
  primary key (lab_id, id),
  foreign key (lab_id, id) references lims.record (ledger_id, id),
  foreign key (lab_id, reviews_record_id) references lims.record (ledger_id, id)
);
select lims.register_signable_head('lims.review', array[]::text[]);

create table lims.test_report (
  lab_id        uuid not null references lims.lab (id),
  id            uuid not null,
  customer_id   uuid not null,
  submission_id uuid not null,
  number        text not null,
  state         text not null check (state in ('Draft', 'InQaReview', 'Released', 'Superseded')),
  primary key (lab_id, id),
  unique (lab_id, number),
  foreign key (lab_id, id) references lims.record (ledger_id, id),
  foreign key (submission_id, customer_id) references lims.submission (id, customer_id)
);
select lims.register_signable_head('lims.test_report', array['state']);

create table lims.test_report_test (
  lab_id    uuid not null,
  report_id uuid not null,
  test_id   uuid not null,
  primary key (lab_id, report_id, test_id),
  foreign key (lab_id, report_id) references lims.test_report (lab_id, id),
  foreign key (lab_id, test_id) references lims.test (lab_id, id)
);
select lims.register_table('lims.test_report_test', 'lab_id', true, 'report_id');

-- The issued PDF: rendered from the Released version's stored bytes inside the releasing
-- transaction and stored content-addressed. One per Released version.
create table lims.report_issue (
  lab_id             uuid  not null,
  report_version_id  uuid  not null primary key references lims.record_version (id),
  released_signature uuid  not null references lims.signature (id),
  pdf_sha256         bytea not null,
  renderer_release   text  not null references lims.release (id),
  foreign key (lab_id, pdf_sha256) references lims.blob (ledger_id, sha256)
);
select lims.register_table('lims.report_issue', 'lab_id', true, 'report_version_id');

-- Every Customer download is audited (decision 13 §2): this row is the event.
create table lims.report_download (
  lab_id            uuid not null,
  id                uuid not null primary key,
  customer_id       uuid not null,
  report_version_id uuid not null references lims.report_issue (report_version_id),
  person_id         uuid not null references lims.person (id),
  at                timestamptz not null default clock_timestamp()
);
select lims.register_table('lims.report_download', 'lab_id', true, 'report_version_id');

-- Verdicts as rows beside the Test version that carries them, with the Rule Set and Calculation
-- Version, so reports and queues never parse bytes. Written when the Test is signed Performed.
create table lims.section_verdict (
  lab_id                   uuid not null,
  id                       uuid not null primary key,
  test_version_id          uuid not null references lims.record_version (id),
  specification_version_id uuid not null references lims.record_version (id),
  jurisdiction             text not null check (jurisdiction in ('FDA', 'EMA', 'NMPA', 'MHLW')),
  rule_set_version         text not null,
  calculation_version      text not null,
  analyte                  text not null,
  limit_text               text not null,
  compared_text            text,
  share_percent            text,
  outcome                  text not null check (outcome in ('conforms', 'does-not-conform', 'not-judged')),
  preparations             jsonb not null,
  unique (test_version_id, jurisdiction, analyte)
);
select lims.register_table('lims.section_verdict', 'lab_id', true, 'test_version_id');

-- A Hold: a stub so gates can ask "any open Hold?" and later modules add rows.
create table lims.hold (
  lab_id      uuid not null,
  id          uuid not null,
  test_id     uuid not null,
  source      text not null,
  blocks_step text not null,
  opened_at   timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  primary key (lab_id, id),
  foreign key (lab_id, test_id) references lims.test (lab_id, id)
);
select lims.register_table('lims.hold', 'lab_id', false, 'test_id');

-- ---------------------------------------------------------------------------------------------
-- Portal views: the only relations a Customer scope may name, each with the customer_id the
-- seam filters on. Status is derived from the internal states (decision 22); Runs, the audit
-- trail, Analysts' names and other Customers' anything are absent.
-- ---------------------------------------------------------------------------------------------
create view lims.portal_test as
select t.id, t.customer_id, t.lab_id, s.submission_id, s.id as sample_id, m.id as method_id, m.number as method_number, m.title as method_title,
       t.state as internal_state,
       case
         when t.state = 'Requested' then 'Awaiting samples'
         when t.state in ('Rejected', 'Cancelled') then 'Rejected'
         when t.state = 'Reported' then 'Reported'
         else 'In testing'
       end as customer_status,
       case when t.state = 'Rejected' then t.acceptance_reason end as rejection_reason
  from lims.test t
  join lims.sample s on s.lab_id = t.lab_id and s.id = t.sample_id
  join lims.method m on m.id = t.method_id;
grant select on lims.portal_test to lims_app;

create view lims.portal_sample as
select s.id, s.customer_id, s.lab_id, s.submission_id, s.product_id, p.code as product_code, p.name as product_name, s.lot_number, s.number,
       case when s.state = 'Expected' then 'Expected' when s.state = 'RejectedAtReceipt' then 'Rejected at receipt' else 'Received' end as customer_status
  from lims.sample s
  join lims.product p on p.id = s.product_id;
grant select on lims.portal_sample to lims_app;

create view lims.portal_submission as
select sb.id, sb.customer_id, sb.number, sb.submitted_at, sb.cancelled_at,
       (select l.id from lims.sample s join lims.lab l on l.id = s.lab_id where s.submission_id = sb.id limit 1) as lab_id,
       (select l.code from lims.sample s join lims.lab l on l.id = s.lab_id where s.submission_id = sb.id limit 1) as lab_code
  from lims.submission sb;
grant select on lims.portal_submission to lims_app;

create view lims.portal_report as
select r.id, r.customer_id, r.lab_id, r.submission_id, r.number, i.report_version_id, encode(i.pdf_sha256, 'hex') as pdf_sha256,
       sg.signed_at as released_at
  from lims.test_report r
  join lims.record_version v on v.record_id = r.id
  join lims.report_issue i on i.report_version_id = v.id
  join lims.signature sg on sg.id = i.released_signature
 where r.state = 'Released';
grant select on lims.portal_report to lims_app;

-- What a Customer may order: every Method in every Lab, per Customer (the Price List's shape, without prices).
create view lims.portal_catalogue as
select c.id as customer_id, l.id as lab_id, l.code as lab_code, m.id as method_id, m.number as method_number, m.title as method_title
  from lims.customer c cross join lims.lab l cross join lims.method m;
grant select on lims.portal_catalogue to lims_app;

create view lims.portal_product as
select p.id, p.customer_id, p.code, p.name from lims.product p;
grant select on lims.portal_product to lims_app;

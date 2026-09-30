-- What the API core needs beyond 0030: commit outcomes keyed per attempt, enrolment, alerts, and
-- the two signable heads every signing gate reads (Authorisations and Training Records).

-- A commit key settles once per input. A refusal for one input does not consume the key for a
-- corrected attempt (a retyped password), but a receipt does: only one receipt per key exists,
-- and the pipeline refuses a different input against it. A session-less attempt (a login) has no
-- session to record.
alter table lims.commit_outcome drop constraint commit_outcome_pkey;
alter table lims.commit_outcome alter column session_id drop not null;
alter table lims.commit_outcome add primary key (commit_key, input_hash);
create unique index one_receipt_per_commit_key on lims.commit_outcome (commit_key) where outcome = 'receipt';

-- An account exists from the moment the Admin creates the person; it is enrolled when the person
-- has set a password and a TOTP secret through their one-time link, in one statement. Half-enrolled
-- is not a state.
alter table lims.account alter column password_hash drop not null;
alter table lims.account add constraint account_enrolled_whole check ((password_hash is null) = (totp_secret_enc is null));

alter table lims.totp_step_used drop constraint totp_step_used_purpose_check;
alter table lims.totp_step_used add constraint totp_step_used_purpose_check
  check (purpose in ('login', 'signing', 'unlock', 'takeover', 'enrol'));

-- A one-time enrolment link. The Admin creates it and never sees the password or the secret: the
-- pending secret is encrypted and redacted from the trail, and the link is spent by the person.
create table lims.enrolment_link (
  id              uuid primary key,
  person_id       uuid not null references lims.person (id),
  username        text not null,
  token_hash      bytea not null unique,
  created_by      uuid not null references lims.person (id),
  created_at      timestamptz not null default clock_timestamp(),
  expires_at      timestamptz not null,
  totp_secret_enc bytea,
  used_at         timestamptz
);
select lims.register_table('lims.enrolment_link', 'company', false, null, array['token_hash', 'totp_secret_enc']);

-- What QA and the Admin are told at once (decision 13 §3 and decision 23 rule 6).
create table lims.alert (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default clock_timestamp(),
  kind       text not null check (kind in ('lockout', 'wrong-user-at-signing')),
  person_id  uuid references lims.person (id),
  session_id uuid,
  detail     jsonb not null default '{}'::jsonb
);
select lims.register_table('lims.alert', 'company', true);

-- A signable head may live on the company ledger (Training Records belong to the person).
drop function lims.register_signable_head(regclass, text[]);
create function lims.register_signable_head(tbl regclass, mutable_columns text[], ledger_source text default 'lab_id')
returns void language plpgsql as $$
begin
  perform lims.register_table(tbl, ledger_source, false, 'id');
  execute format('create trigger head_guard before update on %s for each row execute function lims.head_guard(%s)',
                 tbl, coalesce((select string_agg(quote_literal(c), ',') from unnest(mutable_columns) c), ''));
end $$;

-- An Authorisation (decision 13 §1, decision 19): QA's grant of one meaning within a scope in one
-- Lab, effective when its version carries a standing Approved signature by someone other than the
-- grantee. Suspension is the one in-place change.
create table lims.authorisation (
  lab_id       uuid not null references lims.lab (id),
  id           uuid not null,
  person_id    uuid not null references lims.person (id),
  meaning      text not null check (meaning in ('Performed', 'Verified', 'Reviewed', 'Approved', 'Released', 'Authored', 'Acknowledged')),
  scope        text not null,
  valid_from   date not null,
  valid_until  date not null,
  suspended_at timestamptz,
  primary key (lab_id, id),
  foreign key (lab_id, id) references lims.record (ledger_id, id),
  check (valid_until > valid_from)
);
select lims.register_signable_head('lims.authorisation', array['suspended_at']);

-- A Training Record: the person's own Acknowledged signature on one Document version, at the
-- level their role needs. It never expires by time.
create table lims.training_record (
  id               uuid not null primary key,
  person_id        uuid not null references lims.person (id),
  document_version text not null,
  level            text not null check (level in ('read-and-understood', 'demonstrated')),
  foreign key (id) references lims.record (id),
  unique (person_id, document_version)
);
select lims.register_signable_head('lims.training_record', array[]::text[], 'company');

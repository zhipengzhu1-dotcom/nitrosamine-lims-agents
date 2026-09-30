-- People, accounts, roles, sessions, authentication events, TOTP single use, commit keys.
-- All company-owned: written on the company ledger.

create table lims.person (
  id           uuid primary key,
  printed_name text not null,
  native_name  text,
  created_at   timestamptz not null default clock_timestamp()
);
select lims.register_table('lims.person', 'company', false);

create table lims.account (
  person_id           uuid primary key references lims.person (id),
  username            text not null unique,
  password_hash       text not null,
  totp_secret_enc     bytea,
  disabled_at         timestamptz,
  identity_checked_by uuid references lims.person (id),
  identity_checked_at timestamptz,
  identity_check_method text
);
select lims.register_table('lims.account', 'company', false, null, array['password_hash', 'totp_secret_enc']);

-- Business roles are per Lab; customer roles are per Customer; Admin is company-wide; service
-- identities (svc:seed, svc:auth, svc:session-sweeper) are their own persons with one role.
create table lims.role_grant (
  id          uuid primary key,
  person_id   uuid not null references lims.person (id),
  role        text not null check (role in ('SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager',
                                            'Admin', 'CustomerUser', 'CustomerApprover')
                                   or role like 'svc:%'),
  lab_id      uuid references lims.lab (id),
  customer_id uuid,
  granted_at  timestamptz not null default clock_timestamp(),
  revoked_at  timestamptz,
  check ((role in ('SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager')) = (lab_id is not null)),
  check ((role in ('CustomerUser', 'CustomerApprover')) = (customer_id is not null))
);
select lims.register_table('lims.role_grant', 'company', false);

-- Admin never holds a business role, in either order of granting (decision 13).
create function lims.no_admin_with_business_role() returns trigger
language plpgsql as $$
declare
  business text[] := array['SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager', 'CustomerUser', 'CustomerApprover'];
begin
  if new.revoked_at is null and exists (
    select 1 from lims.role_grant g
     where g.person_id = new.person_id and g.revoked_at is null and g.id <> new.id
       and ((new.role = 'Admin' and g.role = any (business)) or (g.role = 'Admin' and new.role = any (business)))
  ) then
    raise exception 'Admin and a business role on one person' using errcode = 'LI001';
  end if;
  return new;
end $$;
create trigger no_admin_with_business_role before insert or update on lims.role_grant
  for each row execute function lims.no_admin_with_business_role();

-- Sessions are server state. Locked-ness is derived on every request by session_state, so
-- enforcement never waits for the sweeper, which only writes the idle-lock rows the access log
-- needs.
create table lims.session (
  id              uuid primary key,
  token_hash      bytea not null unique,
  person_id       uuid not null references lims.person (id),
  acting_lab_id   uuid references lims.lab (id),
  customer_id     uuid,
  workstation     text not null,
  started_at      timestamptz not null default clock_timestamp(),
  absolute_end_at timestamptz not null,
  locked_at       timestamptz,
  lock_reason     text check (lock_reason in ('manual', 'switch-user', 'idle')),
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('logout', 'takeover', 'absolute-timeout', 'admin')),
  check ((locked_at is null) = (lock_reason is null)),
  check ((ended_at is null) = (end_reason is null))
);
select lims.register_table('lims.session', 'company', false, null, array['token_hash']);

-- Last real input, posted by the client at most once a minute. Operational, not a regulated
-- record: exempt from capture, like commit_outcome.
create table lims.session_activity (
  session_id       uuid primary key references lims.session (id),
  last_activity_at timestamptz not null
);
grant select, insert, update on lims.session_activity to lims_app;

create function lims.session_state(s lims.session, last_activity timestamptz, at timestamptz) returns text
language sql immutable as $$
  select case
    when s.ended_at is not null or at >= s.absolute_end_at then 'ended'
    when s.locked_at is not null or at >= last_activity + interval '15 minutes' then 'locked'
    else 'active'
  end
$$;

-- The access log. Insert-only; lockout is derived from it.
create table lims.auth_event (
  id                    bigint generated always as identity primary key,
  at                    timestamptz not null default clock_timestamp(),
  person_id             uuid references lims.person (id),
  typed_user            text,
  session_id            uuid,
  kind                  text not null check (kind in (
                          'login_ok', 'login_fail', 'signing_ok', 'signing_fail', 'wrong_user_at_signing',
                          'lockout', 'unlock', 'lock', 'idle_lock', 'unlock_session', 'takeover', 'logout',
                          'totp_enrolled', 'totp_revoked', 'absolute_timeout')),
  counts_toward_lockout boolean not null,
  detail                jsonb not null default '{}'::jsonb
);
select lims.register_table('lims.auth_event', 'company', true);

-- Consecutive failures since the last success or unlock, login and signing together.
create view lims.lockout_state as
select p.id as person_id,
       count(e.*) filter (where e.counts_toward_lockout and e.kind in ('login_fail', 'signing_fail')) as consecutive_failures,
       bool_or(e.kind = 'lockout') as locked_out
  from lims.person p
  left join lims.auth_event e
    on e.person_id = p.id
   and e.id > coalesce((select max(x.id) from lims.auth_event x
                         where x.person_id = p.id and x.kind in ('login_ok', 'signing_ok', 'unlock')), 0)
 group by p.id;
grant select on lims.lockout_state to lims_app;

-- A TOTP time step is accepted once per person, ever. The primary key is the whole mechanism.
create table lims.totp_step_used (
  person_id uuid   not null references lims.person (id),
  step      bigint not null,
  used_at   timestamptz not null default clock_timestamp(),
  purpose   text not null check (purpose in ('login', 'signing', 'unlock', 'takeover')),
  primary key (person_id, step)
);
select lims.register_table('lims.totp_step_used', 'company', true);

-- One row per settled attempt. Written in the same transaction as the effect (receipt) or, for a
-- refusal, in a settle transaction after the rollback, so "effect happened" is "row says receipt".
-- Exempt from capture: the effect's own rows are audited.
create table lims.commit_outcome (
  commit_key uuid primary key,
  session_id uuid not null,
  command    text not null,
  input_hash bytea not null,
  outcome    text not null check (outcome in ('receipt', 'refusal')),
  body       jsonb not null,
  settled_at timestamptz not null default clock_timestamp()
);
grant select, insert on lims.commit_outcome to lims_app;

create table lims.spec_gap (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default clock_timestamp(),
  feature   text not null,
  command   text not null,
  record_id uuid,
  person_id uuid not null,
  detail    jsonb not null
);
select lims.register_table('lims.spec_gap', 'company', true);

grant execute on function lims.session_state(lims.session, timestamptz, timestamptz) to lims_app;

-- The service identities are the trust root: every later person and role grant is written under
-- one of them, so they cannot be written under an audit context themselves. This migration is
-- their record.
alter table lims.person disable trigger capture;
alter table lims.role_grant disable trigger capture;
insert into lims.person (id, printed_name) values
  ('00000000-0000-4000-8000-000000000002', 'Seed script'),
  ('00000000-0000-4000-8000-000000000003', 'Authentication service'),
  ('00000000-0000-4000-8000-000000000004', 'Session sweeper');
insert into lims.role_grant (id, person_id, role) values
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 'svc:seed'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000003', 'svc:auth'),
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000004', 'svc:session-sweeper');
alter table lims.person enable trigger capture;
alter table lims.role_grant enable trigger capture;

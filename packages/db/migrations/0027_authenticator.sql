set local role lims_owner;

alter type lims.access_event_kind add value 'AuthenticatorEnrolled';
alter type lims.access_event_kind add value 'PasswordChanged';
alter type lims.sign_in_failure add value 'WrongCode';
alter type lims.sign_in_failure add value 'NoAuthenticator';

-- A person's TOTP authenticator: its secret encrypted under the API's TOTP key, and the last time step a code was
-- accepted at. Working state like the session, so the Audit Trail never copies the secret; the AuthenticatorEnrolled
-- Access Event records the enrolment.
create table lims.authenticator (
  person_id         uuid        primary key references lims.person,
  secret_ciphertext bytea       not null,
  enrolled_at       timestamptz not null default clock_timestamp(),
  last_used_step    bigint
);

grant select, insert (person_id, secret_ciphertext), update (last_used_step) on lims.authenticator to lims_app;

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

-- A TOTP code is accepted once: the API accepts a code by moving last_used_step to the code's step, so a step at or
-- before the last accepted one is a code already used, or an older one, and the database refuses it.
create function lims.step_moves_forward() returns trigger
language plpgsql as $$
begin
  if new.last_used_step is null or new.last_used_step <= old.last_used_step then
    raise exception 'a TOTP code is accepted once; step % is not after step %', new.last_used_step, old.last_used_step
      using errcode = 'LA014';
  end if;
  return new;
end $$;

create trigger step_moves_forward before update of last_used_step on lims.authenticator
  for each row execute function lims.step_moves_forward();

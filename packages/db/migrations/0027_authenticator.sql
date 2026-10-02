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

-- Changes the password of a session's person and writes its PasswordChanged Access Event, only in a transaction
-- stamped with that person re-authenticated (see lims.unlock_session), so a code path that never proved the current
-- password and code cannot change it. Security definer because lims_app holds no update on password_hash.
create function lims.change_password(p_lab_id uuid, p_session_id uuid, new_password_hash text, p_source_address inet)
returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  s record;
begin
  select s2.person_id, s2.workstation_id into s from session s2 where s2.lab_id = p_lab_id and s2.id = p_session_id;
  if this_transaction('lims.reauthenticated') is distinct from s.person_id::text then
    raise exception 'a password change needs the session''s person re-authenticated in this transaction'
      using errcode = 'LA015';
  end if;
  update person set password_hash = new_password_hash where id = s.person_id;
  insert into access_event (kind, subject_id, session_lab_id, session_id, workstation_id, roles, source_address)
  values ('PasswordChanged', s.person_id, p_lab_id, p_session_id, s.workstation_id,
          array(select m.role from membership m where m.lab_id = p_lab_id and m.person_id = s.person_id order by m.role),
          p_source_address);
end $$;

grant execute on function lims.change_password(uuid, uuid, text, inet) to lims_app;

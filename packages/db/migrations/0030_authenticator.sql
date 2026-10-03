set local role lims_owner;

alter type lims.access_event_kind add value 'AuthenticatorEnrolled';
alter type lims.access_event_kind add value 'PasswordChanged';
alter type lims.sign_in_failure add value 'WrongCode';
alter type lims.sign_in_failure add value 'NoAuthenticator';
-- Enrolment refused with the uniform credential sentence: the account already holds an authenticator, or the browser
-- holds another person's live session. Neither counts toward the lockout.
alter type lims.sign_in_failure add value 'AlreadyEnrolled';
alter type lims.sign_in_failure add value 'OtherPersonSignedIn';
-- A code that another request spent first: the losing request rolls back with nothing written, then records this, which
-- counts toward no lockout, because the code was right.
alter type lims.sign_in_failure add value 'CodeAlreadyUsed';
-- An enrolment with no enrolment grant, or one that is unknown, spent, expired or superseded. Counts toward no lockout.
alter type lims.sign_in_failure add value 'NoEnrolmentGrant';
-- A second Admin issued an enrolment grant for the subject; the Audit Trail entry of the grant names the Admin.
alter type lims.access_event_kind add value 'EnrolmentGrantIssued';

-- The enrolment reasons, like the sign-in-only ones before them, belong to a failed sign-in and to no other kind.
alter table lims.access_event
  drop constraint access_event_failure_kind_check,
  add constraint access_event_failure_kind_check check (
    (failure_reason::text not in ('UnknownUserId', 'NoLabChosen', 'AlreadyEnrolled', 'OtherPersonSignedIn',
                                  'NoEnrolmentGrant')
     or kind = 'SignInFailed')
    and (failure_reason::text not in ('OtherUserId', 'SessionEnded') or kind::text = 'LabSwitchFailed')
    and (failure_reason::text <> 'WrongUserId' or kind::text = 'ReauthenticationFailed')
  );

-- A Re-authentication under the decided login proves the signer by password and code, and the Signature it enables
-- records so.
alter table lims.reauthentication
  drop constraint reauthentication_authenticator_check,
  add constraint reauthentication_authenticator_check check (authenticator in ('Password', 'PasswordAndCode'));

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

-- An enrolment grant: the second person at an enrolment. An Admin other than the one who created the account or
-- issued its one-time links issues it, so no one person holds both the password and the authenticator of another.
-- Like a one-time link, only the token's hash is kept, it works once, and it expires.
create table lims.enrolment_grant (
  id         uuid        primary key default gen_random_uuid(),
  person_id  uuid        not null references lims.person,
  issued_by  uuid        not null references lims.person,
  token_hash bytea       not null unique check (octet_length(token_hash) = 32),
  issued_at  timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '72 hours',
  used_at    timestamptz,
  constraint enrolment_grant_second_person_check check (issued_by <> person_id),
  constraint enrolment_grant_expiry_check check (expires_at > issued_at),
  constraint enrolment_grant_use_check check (used_at is null or used_at between issued_at and expires_at)
);

-- The issuer is the acting Admin, and never the Admin who created the account or issued one of its one-time links:
-- both are read from the Audit Trail, which the app role cannot rewrite. The database owner acting outside the LIMS
-- names the issuer, as 0015's seeding_or_owner allows elsewhere, and the second-Admin rule still holds for them.
create function lims.granted_by_a_second_admin() returns trigger
language plpgsql as $$
declare
  issuer text;
begin
  select 'person:' || p.username into issuer from lims.person p where p.id = new.issued_by;
  if issuer is null or new.issued_by = new.person_id then
    return new; -- the foreign key refuses an issuer who does not exist, and the second-person check a self-issue
  end if;
  if not lims.seeding_or_owner() and issuer is distinct from current_setting('lims.actor', true) then
    raise exception 'an enrolment grant is issued by the acting Admin' using errcode = 'LA016';
  end if;
  if not exists (select from lims.membership m where m.person_id = new.issued_by and m.role = 'Admin') then
    raise exception 'an enrolment grant is issued by an Admin' using errcode = 'LA016';
  end if;
  if exists (select from lims.audit_entry e
              where e.actor = issuer and e.op = 'INSERT'
                and ((e.table_name = 'person' and e.new_row ->> 'id' = new.person_id::text)
                  or (e.table_name = 'credential_link' and e.new_row ->> 'person_id' = new.person_id::text))) then
    raise exception 'an enrolment grant comes from a second Admin: not the one who created the account or issued its one-time link'
      using errcode = 'LA016';
  end if;
  return new;
end $$;
create trigger granted_by_a_second_admin before insert on lims.enrolment_grant
  for each row execute function lims.granted_by_a_second_admin();

-- The other order: the Admin who issued a person's enrolment grant never issues their one-time link afterwards, so no
-- Admin holds both the link that sets the password and the grant that enrols the authenticator. The issuer of a link
-- is the acting person the Audit Trail records.
create function lims.link_not_from_the_grant_issuer() returns trigger
language plpgsql as $$
begin
  if exists (select from lims.enrolment_grant g join lims.person p on p.id = g.issued_by
              where g.person_id = new.person_id
                and 'person:' || p.username = current_setting('lims.actor', true)) then
    raise exception 'a one-time link comes from an Admin who did not issue the person’s enrolment grant'
      using errcode = 'LA016';
  end if;
  return new;
end $$;
create trigger link_not_from_the_grant_issuer before insert on lims.credential_link
  for each row execute function lims.link_not_from_the_grant_issuer();

create function lims.use_grant_once() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.used_at is not null
     or (to_jsonb(new) - 'used_at') <> (to_jsonb(old) - 'used_at') then
    raise exception 'an enrolment grant is only ever marked used, once' using errcode = 'LA002';
  end if;
  return coalesce(new, old);
end $$;
create trigger use_grant_once before update or delete on lims.enrolment_grant
  for each row execute function lims.use_grant_once();
create trigger refuse_truncate before truncate on lims.enrolment_grant
  for each statement execute function lims.refuse_change();
create trigger capture after insert or update or delete on lims.enrolment_grant
  for each row execute function lims.capture();

-- The only way an enrolment grant is spent: it takes the token itself, so the hash that the table and the Audit Trail
-- hold redeems nothing, and only the person's latest grant counts. True when the grant was live for this person and is
-- now marked used; the caller writes the authenticator in the same transaction, so a rollback leaves it unspent.
create function lims.use_enrolment_grant(grant_token text, p_person_id uuid) returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  this_instant constant timestamptz := clock_timestamp();
  spent uuid;
begin
  update lims.enrolment_grant g set used_at = this_instant
   where g.token_hash = sha256(convert_to(grant_token, 'UTF8')) and g.person_id = p_person_id and g.used_at is null
     and this_instant < g.expires_at
     and not exists (select from lims.enrolment_grant newer
                      where newer.person_id = g.person_id and newer.issued_at > g.issued_at)
  returning g.id into spent;
  return spent is not null;
end $$;

grant select on lims.enrolment_grant to lims_app;
grant insert (person_id, issued_by, token_hash) on lims.enrolment_grant to lims_app;
grant execute on function lims.use_enrolment_grant(text, uuid) to lims_app;

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

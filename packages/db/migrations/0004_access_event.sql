set local role lims_owner;

create type lims.access_event_kind as enum ('SignInSucceeded', 'SignInFailed', 'SignOut', 'Lockout');
create type lims.sign_in_failure as enum ('UnknownUserId', 'WrongPassword', 'WrongPasswordOnLockedAccount',
                                          'AccountLocked', 'NoLab');

alter table lims.session add unique (lab_id, id, person_id);

-- The session's Lab is session_lab_id, not lab_id, because lims.capture() routes a row with lab_id to that Lab's chain.
create table lims.access_event (
  id                   uuid                   primary key default gen_random_uuid(),
  kind                 lims.access_event_kind not null,
  subject_id           uuid                   references lims.person,
  typed_user_id_hmac   bytea                  check (octet_length(typed_user_id_hmac) = 32),
  typed_user_id_length int                    check (typed_user_id_length >= 0),
  source_address       inet                   not null,
  workstation_id       uuid,
  session_lab_id       uuid,
  session_id           uuid,
  roles                lims.role[]            not null,
  failure_reason       lims.sign_in_failure,
  at                   timestamptz            not null default clock_timestamp(),
  foreign key (session_lab_id, session_id, subject_id) references lims.session (lab_id, id, person_id),
  constraint access_event_session_check check ((session_lab_id is null) = (session_id is null)),
  constraint access_event_session_kind_check check (
    (session_id is not null or kind not in ('SignInSucceeded', 'SignOut')) and (session_id is null or kind <> 'SignInFailed')
  ),
  constraint access_event_failure_check check ((kind = 'SignInFailed') = (failure_reason is not null)),
  constraint access_event_unknown_user_id_check check (
    (failure_reason is not distinct from 'UnknownUserId') = (typed_user_id_hmac is not null)
    and (typed_user_id_hmac is null) = (typed_user_id_length is null)
    and (typed_user_id_hmac is null) = (subject_id is not null)
  ),
  constraint access_event_roles_check check (subject_id is not null or roles = '{}')
);

create trigger capture after insert or update or delete on lims.access_event
  for each row execute function lims.capture();
create trigger refuse_change before update or delete on lims.access_event
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.access_event
  for each statement execute function lims.refuse_change();

grant select on lims.access_event to lims_app;
grant insert (kind, subject_id, typed_user_id_hmac, typed_user_id_length, source_address, workstation_id,
              session_lab_id, session_id, roles, failure_reason) on lims.access_event to lims_app;

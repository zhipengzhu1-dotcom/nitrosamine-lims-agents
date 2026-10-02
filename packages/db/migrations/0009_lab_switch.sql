set local role lims_owner;

alter type lims.access_event_kind add value 'LabSwitch';
alter type lims.access_event_kind add value 'LabSwitchFailed';
alter type lims.sign_in_failure add value 'NoLabChosen';
alter type lims.sign_in_failure add value 'NoMembership';
alter type lims.sign_in_failure add value 'OtherUserId';

-- A new enum value cannot be used before its transaction commits, so these checks compare the kind as text.
alter table lims.access_event
  add column previous_session_lab_id uuid,
  add column previous_session_id     uuid,
  add foreign key (previous_session_lab_id, previous_session_id, subject_id) references lims.session (lab_id, id, person_id),
  drop constraint access_event_session_kind_check,
  drop constraint access_event_failure_check,
  add constraint access_event_session_kind_check check (
    (session_id is not null or kind::text not in ('SignInSucceeded', 'SignOut', 'LabSwitch', 'LabSwitchFailed'))
    and (session_id is null or kind <> 'SignInFailed')
  ),
  add constraint access_event_failure_check check (
    (kind::text in ('SignInFailed', 'LabSwitchFailed')) = (failure_reason is not null)
  ),
  add constraint access_event_previous_session_check check (
    (previous_session_lab_id is null) = (previous_session_id is null)
    and (kind::text = 'LabSwitch') = (previous_session_id is not null)
  ),
  add constraint access_event_lab_switch_check check (previous_session_lab_id <> session_lab_id);

grant insert (previous_session_lab_id, previous_session_id) on lims.access_event to lims_app;

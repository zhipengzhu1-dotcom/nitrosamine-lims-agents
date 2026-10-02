set local role lims_owner;

-- A value added to an enum cannot be used in the transaction that adds it, so the checks below compare kind::text.
alter type lims.access_event_kind add value 'Lock';
alter type lims.access_event_kind add value 'Unlock';
alter type lims.access_event_kind add value 'Takeover';
alter type lims.access_event_kind add value 'UnlockFailed';
alter type lims.sign_in_failure add value 'NotInWorkstationLab';

-- The Room record that the Equipment ticket (#129) extends with its Checks and storage locations.
create table lims.room (
  lab_id uuid not null references lims.lab,
  id     uuid not null default gen_random_uuid(),
  name   text not null,
  primary key (lab_id, id),
  unique (lab_id, name)
);

create table lims.workstation (
  lab_id            uuid  not null,
  id                uuid  not null default gen_random_uuid() unique,
  name              text  not null,
  room_id           uuid  not null,
  browser_policy    text  not null,
  device_token_hash bytea unique check (octet_length(device_token_hash) = 32),
  primary key (lab_id, id),
  unique (lab_id, name),
  foreign key (lab_id, room_id) references lims.room
);

-- A session opens in its Workstation's Lab, so a Workstation of another Lab cannot be named.
alter table lims.session
  add column workstation_id uuid,
  add column locked_at      timestamptz,
  add foreign key (lab_id, workstation_id) references lims.workstation;

alter table lims.access_event
  add column taken_by_id uuid references lims.person,
  add foreign key (workstation_id) references lims.workstation (id),
  drop constraint access_event_session_kind_check,
  add constraint access_event_session_kind_check check (
    (session_id is not null
     or kind::text not in ('SignInSucceeded', 'SignOut', 'IdleExpiry', 'AbsoluteExpiry', 'LabSwitch', 'LabSwitchFailed',
                           'Lock', 'Unlock', 'UnlockFailed', 'Takeover'))
    and (session_id is null or kind <> 'SignInFailed')
  ),
  add constraint access_event_takeover_check check ((kind::text = 'Takeover') = (taken_by_id is not null));

create trigger capture after insert or update or delete on lims.room
  for each row execute function lims.capture();
create trigger capture after insert or update or delete on lims.workstation
  for each row execute function lims.capture();

grant select, insert on lims.room to lims_app;
grant select, insert on lims.workstation to lims_app;
grant update (device_token_hash) on lims.workstation to lims_app;
grant insert (taken_by_id) on lims.access_event to lims_app;
-- 0010 left lims_app column grants on session; a Lock is the one change it makes in place.
grant insert (workstation_id) on lims.session to lims_app;
grant update (locked_at) on lims.session to lims_app;

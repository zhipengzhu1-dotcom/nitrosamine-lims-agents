set local role lims_owner;

-- A refused unlock is a failed re-authentication of the session's own person, so it records why, in the vocabulary of
-- a refused sign-in or signing (#245). The reasons only a sign-in, a Lab switch or a signing has stay theirs, under
-- access_event_failure_kind_check. A failed unlock written before this migration holds no reason; an Access Event is
-- never changed, so the check is not valid for those rows and binds every row written from now on.
alter table lims.access_event
  drop constraint access_event_failure_check,
  add constraint access_event_failure_check check (
    (kind::text in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed', 'UnlockFailed'))
    = (failure_reason is not null)
  ) not valid;

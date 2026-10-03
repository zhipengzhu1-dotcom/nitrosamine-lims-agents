set local role lims_owner;

-- A refused unlock is a failed re-authentication of the session's own person, so it records why, in the vocabulary of
-- a refused sign-in or signing (#245). A failed unlock written before this migration holds no reason; an Access Event
-- is never changed, so the check is not valid for those rows and binds every row written from now on.
alter table lims.access_event
  drop constraint access_event_failure_check,
  add constraint access_event_failure_check check (
    (kind::text in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed', 'UnlockFailed'))
    = (failure_reason is not null)
  ) not valid;

-- An unlock types only the password and, under the decided login, a code, so its reason is one of those a password,
-- a code or a Lockout gives.
alter table lims.access_event
  drop constraint access_event_failure_kind_check,
  add constraint access_event_failure_kind_check check (
    (failure_reason::text not in ('UnknownUserId', 'NoLabChosen', 'AlreadyEnrolled', 'OtherPersonSignedIn',
                                  'NoEnrolmentGrant')
     or kind = 'SignInFailed')
    and (failure_reason::text not in ('OtherUserId', 'SessionEnded') or kind::text = 'LabSwitchFailed')
    and (failure_reason::text <> 'WrongUserId' or kind::text = 'ReauthenticationFailed')
    and (kind::text <> 'UnlockFailed'
         or failure_reason::text in ('WrongPassword', 'WrongPasswordOnLockedAccount', 'AccountLocked', 'WrongCode',
                                     'NoAuthenticator', 'CodeAlreadyUsed'))
  );

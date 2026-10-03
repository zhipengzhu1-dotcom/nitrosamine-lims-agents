set local role lims_owner;

-- A refused unlock is a failed re-authentication of the session's own person, so it records why, in the vocabulary of
-- a refused sign-in or signing (#245). A failed unlock may now carry a reason; every other rule on the reason still
-- binds every row.
alter table lims.access_event
  drop constraint access_event_failure_check,
  add constraint access_event_failure_check check (
    (failure_reason is null
     or kind::text in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed', 'UnlockFailed'))
    and (failure_reason is not null or kind::text not in ('SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed'))
  );

-- A failed unlock written before this migration holds no reason, and an Access Event is never changed, so this rule
-- binds only the rows written from now on and can never be validated on a database that holds such a row.
alter table lims.access_event
  add constraint access_event_unlock_failure_check check (kind <> 'UnlockFailed' or failure_reason is not null) not valid;

-- An unlock types only the password and, under the decided login, a code, so its reason is one of those a password,
-- a code or a Lockout gives. The unlock reasons compare as the enum, so a misspelt one fails this migration.
alter table lims.access_event
  drop constraint access_event_failure_kind_check,
  add constraint access_event_failure_kind_check check (
    (failure_reason::text not in ('UnknownUserId', 'NoLabChosen', 'AlreadyEnrolled', 'OtherPersonSignedIn',
                                  'NoEnrolmentGrant')
     or kind = 'SignInFailed')
    and (failure_reason::text not in ('OtherUserId', 'SessionEnded') or kind::text = 'LabSwitchFailed')
    and (failure_reason::text <> 'WrongUserId' or kind::text = 'ReauthenticationFailed')
    and (kind <> 'UnlockFailed'
         or failure_reason in ('WrongPassword', 'WrongPasswordOnLockedAccount', 'AccountLocked', 'WrongCode',
                               'NoAuthenticator', 'CodeAlreadyUsed'))
  );

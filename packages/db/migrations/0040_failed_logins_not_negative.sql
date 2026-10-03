set local role lims_owner;

-- lims_app may update failed_logins (0015), and a count that starts below zero would let a person fail more sign-ins,
-- Lab switches or Re-authentications than the lockout threshold allows before the lockout lands (#274).
alter table lims.person add constraint person_failed_logins_check check (failed_logins >= 0);

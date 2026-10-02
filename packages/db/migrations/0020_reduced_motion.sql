set local role lims_owner;

-- A person's own reduced-motion preference, which the web applies after sign-in and Switch user on top of the
-- device's setting. It only ever reduces motion. The person row's capture trigger records each change.
alter table lims.person add column reduced_motion boolean not null default false;
grant update (reduced_motion) on lims.person to lims_app;

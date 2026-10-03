set local role lims_owner;

-- The app role inserts a person only with the columns the API and the seed write, so id, failed_logins, locked_at and
-- reduced_motion always take their defaults. The grant refuses a lockout at insert before insert_unlocked runs.
revoke insert on lims.person from lims_app;
grant insert (username, display_name, customer_id, password_hash, identity_verification_id) on lims.person to lims_app;

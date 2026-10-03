set local role lims_owner;

-- The app role inserts a person only with the columns the API and the seed write. It cannot insert a lockout, so
-- refusing a person born locked out does not rest on insert_unlocked alone, nor a person born with failed sign-ins.
revoke insert on lims.person from lims_app;
grant insert (username, display_name, customer_id, password_hash, identity_verification_id) on lims.person to lims_app;

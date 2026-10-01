set local role lims_owner;

-- The last TOTP time step accepted for the person; a code for this step or an earlier one is refused as a replay.
alter table lims.person add column totp_last_step bigint not null default 0;

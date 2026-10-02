set local role lims_owner;

-- QA's Verify chain reports each chain's last entry from its head, which the app role could not read.
grant select on lims.audit_chain to lims_app;

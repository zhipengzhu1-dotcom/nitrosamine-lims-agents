set local role lims_owner;

alter type lims.incident_kind add value 'ChainVerifyFailure';

-- A chain-verify failure names the chain as the Audit Trail does ('company' or the Lab's ID, in a column not named
-- lab_id, so capture() keeps the incident on the company chain) and the first entry that fails to verify. One break
-- opens one incident however often it is verified: the pair is unique, and other kinds leave both null. The QA who
-- verified is its requesting person. The chain is checked by shape, not by a foreign key to audit_chain, whose
-- key-share lock would take a Lab chain before the company chain that capture() locks next. The kinds are compared as
-- text because a new enum value cannot be used in the transaction that adds it.
alter table lims.system_incident
  add column chain         text   check (chain = 'company'
                                         or chain ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  add column first_failure bigint check (first_failure >= 1),
  add constraint system_incident_chain_first_failure_key unique (chain, first_failure),
  drop constraint system_incident_facts_check,
  add constraint system_incident_facts_check check (
    (kind::text in ('UnexpectedFailure', 'UnraisableLogLine')) = (step is not null)
    and (step is null) = (error_class is null)
    and (kind::text in ('Lockout', 'RepeatedSignInOnLockedAccount')) = (subject_id is not null)
    and (kind::text = 'SignInBurstFromAddress') = (source_address is not null)
    and (kind::text = 'SignInBurstOnUnknownUserId') = (typed_user_id_hmac is not null)
    and (kind::text = 'ChainVerifyFailure') = (chain is not null)
    and (chain is null) = (first_failure is null)
    and (kind::text <> 'ChainVerifyFailure' or requested_by is not null)
  );

grant insert (chain, first_failure) on lims.system_incident to lims_app;

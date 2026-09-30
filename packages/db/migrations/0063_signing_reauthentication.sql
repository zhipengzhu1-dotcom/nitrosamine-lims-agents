-- Review fix 21 (Part 11 §11.200(a)(1), part11 point 1): the database proves that a signing
-- re-authenticated. A TOTP step row now names the commit that consumed it, filled from the audit
-- context and never by the caller, and lims.sign refuses a signature (LS005) unless this commit
-- consumed a step for the signer with purpose signing in this transaction. The commit key is
-- one attempt's, so a step consumed by an earlier attempt under the same key does not count,
-- and neither does another session's. A group signing shares the one re-authentication of its
-- commit. Rows from before this migration carry no commit key.
alter table lims.totp_step_used add column commit_key uuid;

create function lims.totp_step_defaults() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  new.commit_key := (lims.require_context()->>'commit_key')::uuid;
  new.used_at := clock_timestamp();
  return new;
end $$;
create trigger totp_step_defaults before insert on lims.totp_step_used
  for each row execute function lims.totp_step_defaults();

create or replace function lims.sign(p_signer uuid, p_version uuid, p_hash bytea, p_meaning text, p_authenticator text,
                                     p_group uuid, p_attestation_version uuid default null, p_attestation_hash bytea default null)
returns table (signature_id uuid, signed_at timestamptz)
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx jsonb := lims.require_context();
  v   lims.record_version;
  s   lims.signature;
begin
  select * into v from lims.record_version where id = p_version;
  if not found then
    raise exception 'version % does not exist', p_version using errcode = 'LV001';
  end if;
  if not exists (
    select 1 from lims.totp_step_used t
     where t.person_id = p_signer and t.purpose = 'signing'
       and t.commit_key = (ctx->>'commit_key')::uuid
       and t.used_at >= transaction_timestamp()
  ) then
    raise exception 'signer % did not re-authenticate in this commit', p_signer using errcode = 'LS005';
  end if;
  insert into lims.signature (ledger_id, id, record_version_id, content_hash, meaning, signer_person_id, printed_name,
                              username, role, signer_lab_id, signed_at, authenticator, session_id, app_release,
                              commit_key, group_id, attestation_version_id, attestation_hash)
  select v.ledger_id, gen_random_uuid(), p_version, p_hash, p_meaning, p_signer, p.printed_name, a.username,
         ctx->>'role', (ctx->>'acting_lab_id')::uuid, clock_timestamp(), p_authenticator, (ctx->>'session_id')::uuid,
         ctx->>'app_release', (ctx->>'commit_key')::uuid, p_group, p_attestation_version, p_attestation_hash
    from lims.person p join lims.account a on a.person_id = p.id
   where p.id = p_signer
  returning * into s;
  if s.id is null then
    raise exception 'signer % has no account', p_signer using errcode = 'LS004';
  end if;
  return query select s.id, s.signed_at;
end $$;

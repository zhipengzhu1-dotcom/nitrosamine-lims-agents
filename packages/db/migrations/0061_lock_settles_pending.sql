-- Review fix 2: the release lock covers signing and rejecting a version, not only sealing a new
-- one. version_defaults already refuses a new version of a locked record; without this, a change
-- proposed before release could still be approved after it and move the effective version behind
-- a Released Test Report. No signature of any meaning lands on a locked record (the Released
-- signature itself precedes lock_released in its transaction). releasedGate refuses to release
-- while a change is pending, so the lock never leaves a proposal that can neither be approved
-- nor rejected. A rejected version is settled: it is never approved afterwards either.

-- A record is locked when it or its parent is in the closure of a Released signature.
create function lims.locked(p_record uuid) returns boolean
language sql stable security definer set search_path = lims, pg_temp as $$
  select exists (
    select 1 from lims.record r join lims.record_lock l on l.record_id in (r.id, r.parent_id)
     where r.id = p_record)
$$;

create or replace function lims.signature_guard() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx jsonb := lims.require_context();
  v   lims.record_version;
begin
  new.signed_at := clock_timestamp();
  if new.signer_person_id <> (ctx->>'person_id')::uuid then
    raise exception 'a signature is written only in its signer''s own audited transaction' using errcode = 'LS000';
  end if;
  select * into v from lims.record_version where id = new.record_version_id;
  if lims.locked(v.record_id) then
    raise exception 'record % is locked by a Released Test Report', v.record_id using errcode = 'LR001';
  end if;
  if new.meaning in ('Verified', 'Approved') and exists (select 1 from lims.version_rejection r where r.version_id = v.id) then
    raise exception 'version % was rejected and is not approved afterwards', v.id using errcode = 'LV006';
  end if;
  if v.requires_approval and new.meaning in ('Verified', 'Approved') and new.signer_person_id = v.created_by then
    raise exception 'nobody approves a change they proposed' using errcode = 'LS001';
  end if;
  if new.meaning = 'Verified' and exists (
    select 1 from lims.record_version a where a.record_id = v.record_id and a.created_by = new.signer_person_id
  ) then
    raise exception 'the Verified signer entered a version of this value' using errcode = 'LS002';
  end if;
  if not exists (
    select 1 from lims.record r join lims.record_kind k on k.kind = r.kind
     where r.id = v.record_id and new.meaning = any (k.meanings)
  ) then
    raise exception 'this record kind does not carry the meaning %', new.meaning using errcode = 'LS003';
  end if;
  return new;
end $$;

-- A rejection settles a proposed Critical Data Change (decision 20), so only a pending version
-- can be rejected, and never one behind a Released Test Report. The rejecter is the context's
-- person, as a version's author is, whatever the app passed.
create function lims.rejection_guard() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  v lims.record_version;
begin
  new.rejected_by := (lims.require_context()->>'person_id')::uuid;
  new.at := clock_timestamp();
  select * into v from lims.record_version where id = new.version_id;
  if not exists (select 1 from lims.pending_version p where p.id = new.version_id) then
    raise exception 'version % is not a pending change', new.version_id using errcode = 'LV006';
  end if;
  if lims.locked(v.record_id) then
    raise exception 'record % is locked by a Released Test Report', v.record_id using errcode = 'LR001';
  end if;
  return new;
end $$;
create trigger rejection_guard before insert on lims.version_rejection
  for each row execute function lims.rejection_guard();

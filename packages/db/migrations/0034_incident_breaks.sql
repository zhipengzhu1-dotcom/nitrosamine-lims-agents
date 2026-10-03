set local role lims_owner;

-- A chain verification System Incident keeps every break it records, as the verification read them: entry, kind,
-- last entry and fingerprint, in entry order (#250). A More incident's fingerprint is only a digest of its breaks, so
-- without them a later change inside its range, a further tamper or an entry put back, would leave the incident
-- unable to say which entries were broken when it opened. The breaks are one of its recorded facts, which
-- keep_incident_facts already keeps from changing, and the Acknowledged Signature binds them through the fingerprint
-- they must give. An incident opened before this migration has none, and keeps that shape.
alter table lims.system_incident
  add column breaks jsonb,
  add constraint system_incident_breaks_check check (chain is not null or breaks is null);

-- Checked after the row's own checks, so a row they refuse is refused by them. The breaks give the incident's count,
-- its first and last entry, and its fingerprint: the digest Verify chain records for a More incident
-- (sha256 over each break's entry and the sha256 of its fingerprint, in entry order), or the one break's own.
create function lims.require_breaks() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if new.chain is null or new.fingerprint is null then
    return null;
  end if;
  if new.breaks is null or jsonb_typeof(new.breaks) <> 'array' or jsonb_array_length(new.breaks) <> new.break_count
     or not exists (
       select
       from (
         select (b ->> 'entry')::bigint as seq, b ->> 'kind' as kind, (b ->> 'through')::bigint as through,
           decode(b ->> 'fingerprint', 'hex') as fingerprint
         from jsonb_array_elements(new.breaks) as b
       ) as listed
       having min(seq) = new.first_failure and max(through) = new.last_failure
         and bool_and(kind in ('Changed', 'Missing', 'HeadMoved') and through >= seq)
         and (sha256(string_agg(int8send(seq) || sha256(fingerprint), ''::bytea order by seq)) = new.fingerprint
           or (count(*) = 1 and bool_and(fingerprint = new.fingerprint)))
     ) then
    raise exception 'a chain-verify System Incident records every break it covers, which give its count, range and fingerprint'
      using errcode = '23514';
  end if;
  return null;
end $$;

create trigger require_breaks after insert on lims.system_incident
  for each row execute function lims.require_breaks();

grant insert (breaks) on lims.system_incident to lims_app;

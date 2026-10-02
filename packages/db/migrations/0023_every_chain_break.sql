set local role lims_owner;

-- Every break in a chain, in entry order: each entry that fails to verify (a changed entry, or the first entry written
-- after a changed one), each place an entry is missing, and, after the last entry, a head that moved. After a break the
-- check resumes from the stored entry, so a later break is never hidden behind an earlier one and one break is reported
-- once.
create function lims.chain_breaks(p_chain text) returns setof bigint
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  e audit_entry;
  running bytea := decode(repeat('00', 32), 'hex');
  expected bigint := 1;
begin
  for e in select * from audit_entry where chain = p_chain order by seq loop
    if e.seq <> expected then
      return next expected;
      running := e.prev_hash;
    end if;
    if e.prev_hash <> running or e.hash <> sha256(running || audit_entry_bytes(e)) then
      return next e.seq;
    end if;
    running := e.hash;
    expected := e.seq + 1;
  end loop;
  if running <> coalesce((select head from audit_chain where chain = p_chain), running) then
    return next expected;
  end if;
end $$;

-- Returns the first seq that fails to verify, or null.
create or replace function lims.verify_chain(p_chain text) returns bigint
language sql stable security definer set search_path = lims, pg_temp as $$
  select min(seq) from chain_breaks(p_chain) as seq
$$;

grant execute on function lims.chain_breaks(text) to lims_app;

-- A System Incident moves Open -> Acknowledged -> Closed (spec #85). Verify names a break's incident in whatever state
-- it is in; the moves themselves are #104's.
alter type lims.incident_state add value 'Acknowledged';
alter type lims.incident_state add value 'Closed';

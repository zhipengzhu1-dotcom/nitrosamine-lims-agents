set local role lims_owner;

-- Every break in a chain, in entry order, with its kind and the last entry it covers:
--   Changed: an entry that fails to verify (a changed entry, or the first entry written after one whose hash was
--     recomputed);
--   Missing: a run of entries that are gone, at the end of the chain too, reported at its first entry;
--   HeadMoved: after the last entry, a head that does not match it, or that counts fewer entries than the chain holds.
-- After a missing run the check resumes on the next entry's own link. After a changed entry it accepts the next link,
-- or the head, when it matches that entry's stored hash or the hash its content gives, so one changed entry is one
-- break and a link or head moved behind it is still found.
create function lims.chain_breaks(p_chain text) returns table (seq bigint, kind text, through bigint)
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  e audit_entry;
  recorded audit_chain;
  accepted bytea[] := array[decode(repeat('00', 32), 'hex')];
  computed bytea;
  expected bigint := 1;
begin
  for e in select * from audit_entry a where a.chain = p_chain order by a.seq loop
    if e.seq > expected then
      return query select expected, 'Missing'::text, e.seq - 1;
      accepted := array[e.prev_hash];
    end if;
    computed := sha256(e.prev_hash || audit_entry_bytes(e));
    if e.prev_hash <> all(accepted) or e.hash <> computed then
      return query select e.seq, 'Changed'::text, e.seq;
      accepted := array[e.hash, computed];
    else
      accepted := array[e.hash];
    end if;
    expected := e.seq + 1;
  end loop;
  select * into recorded from audit_chain c where c.chain = p_chain;
  if coalesce(recorded.seq, 0) >= expected then
    return query select expected, 'Missing'::text, recorded.seq;
  elsif coalesce(recorded.seq, 0) < expected - 1
    or coalesce(recorded.head, decode(repeat('00', 32), 'hex')) <> all(accepted) then
    return query select expected, 'HeadMoved'::text, expected;
  end if;
end $$;

-- Returns the first seq that fails to verify, or null.
create or replace function lims.verify_chain(p_chain text) returns bigint
language sql stable security definer set search_path = lims, pg_temp as $$
  select min(b.seq) from chain_breaks(p_chain) as b
$$;

grant execute on function lims.chain_breaks(text) to lims_app;

-- A System Incident moves Open -> Acknowledged -> Closed (spec #85). Verify names a break's incident in whatever state
-- it is in; the moves themselves are #104's.
alter type lims.incident_state add value 'Acknowledged';
alter type lims.incident_state add value 'Closed';

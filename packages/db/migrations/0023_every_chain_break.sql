set local role lims_owner;

-- Every break in a chain, in entry order, with its kind, the last entry it covers, and a fingerprint of what is wrong
-- there:
--   Changed: an entry that fails to verify (a changed entry, or the first entry written after one whose hash was
--     recomputed);
--   Missing: a run of entries that are gone, at the end of the chain too, reported at its first entry;
--   HeadMoved: after the last entry, a head that does not match it, or that counts fewer entries than the chain holds.
-- After a missing run the check resumes on the next entry's own link. After a changed entry it accepts the next link,
-- or the head, when it matches that entry's stored hash or the hash its content gives, so one changed entry is one
-- break and a link or head moved behind it is still found.
-- The fingerprint changes whenever the break does, so a break tampered with again is a new break at the same entry:
-- an entry whose hash fails covers its link, its stored hash and the hash its content gives; a link alone that fails
-- covers that link, the stored hash it should carry and the entry before; a missing run covers its last entry; a moved
-- head covers itself as a link, so the entry later written on it carries the same fingerprint.
create function lims.chain_breaks(p_chain text) returns table (seq bigint, kind text, through bigint, fingerprint bytea)
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
      return query select expected, 'Missing'::text, e.seq - 1, int8send(e.seq - 1);
      accepted := array[e.prev_hash];
    end if;
    computed := sha256(e.prev_hash || audit_entry_bytes(e));
    if e.hash <> computed then
      return query select e.seq, 'Changed'::text, e.seq, sha256(e.prev_hash || e.hash || computed);
      accepted := array[e.hash, computed];
    elsif e.prev_hash <> all(accepted) then
      return query select e.seq, 'Changed'::text, e.seq, sha256(e.prev_hash || accepted[1] || int8send(e.seq - 1));
      accepted := array[e.hash];
    else
      accepted := array[e.hash];
    end if;
    expected := e.seq + 1;
  end loop;
  select * into recorded from audit_chain c where c.chain = p_chain;
  if coalesce(recorded.seq, 0) >= expected then
    return query select expected, 'Missing'::text, recorded.seq, int8send(recorded.seq);
  elsif coalesce(recorded.seq, 0) < expected - 1
    or coalesce(recorded.head, decode(repeat('00', 32), 'hex')) <> all(accepted) then
    return query select expected, 'HeadMoved'::text, expected,
      sha256(coalesce(recorded.head, decode(repeat('00', 32), 'hex')) || accepted[1] || int8send(coalesce(recorded.seq, 0)));
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

-- A chain-verify System Incident records one break, or every break after the first ones a verification records one by
-- one: its first and last entries, how many breaks, and their fingerprint (one break's, or a digest of all of theirs).
-- One break opens one incident however often it is verified, and a break tampered with again opens another, so the
-- key adds the fingerprint. Incidents opened before this migration have no fingerprint and stay as they are; the check
-- holds for every incident opened from now on.
alter table lims.system_incident
  add column fingerprint  bytea,
  add column last_failure bigint,
  add column break_count  integer check (break_count >= 1),
  add constraint system_incident_break_check check (
    (chain is null) = (fingerprint is null)
    and (chain is null) = (last_failure is null)
    and (chain is null) = (break_count is null)
    and last_failure >= first_failure
  ) not valid,
  drop constraint system_incident_chain_first_failure_key,
  add constraint system_incident_chain_break_key unique (chain, first_failure, fingerprint);

grant insert (fingerprint, last_failure, break_count) on lims.system_incident to lims_app;

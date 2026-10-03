set local role lims_owner;

create table lims.chain_verification (
  id              uuid        primary key default gen_random_uuid(),
  chain           text        not null check (chain = 'company'
                                              or chain ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  through         bigint      not null check (through >= 1),
  head            bytea       not null check (octet_length(head) = 32),
  recomputed_from bigint      not null,
  verified_by     uuid        not null references lims.person,
  verified_at     timestamptz not null default now(),
  constraint chain_verification_recomputed_from_check check (recomputed_from >= 1 and recomputed_from <= through + 1)
);

create index chain_verification_latest on lims.chain_verification (chain, through desc, verified_at desc);

create trigger capture after insert or update or delete on lims.chain_verification
  for each row execute function lims.capture();
create trigger refuse_change before update or delete on lims.chain_verification
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.chain_verification
  for each statement execute function lims.refuse_change();

-- A Chain Verification names an entry of its chain and that entry's hash, and its Verified by is the person acting, in
-- the QA role, so that the record of who verified is the audited actor and never a name the write chose.
create function lims.chain_verification_head_matches_entry() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  acting_as text := current_setting('lims.role', true);
  actor     text := current_setting('lims.actor', true);
  verifier  text;
begin
  if not exists (select from audit_entry e where e.chain = new.chain and e.seq = new.through and e.hash = new.head) then
    raise exception 'a Chain Verification names an entry of its chain and that entry''s hash' using errcode = 'LA014';
  end if;
  if acting_as is distinct from 'QA' then
    raise exception 'a Chain Verification is recorded by QA, not %', coalesce(nullif(acting_as, ''), 'no role')
      using errcode = 'LA015';
  end if;
  select 'person:' || p.username into verifier from person p where p.id = new.verified_by;
  if verifier is distinct from actor then
    raise exception 'a Chain Verification is verified by the acting QA %, not %',
      coalesce(nullif(actor, ''), 'no actor'), coalesce(verifier, new.verified_by::text) using errcode = 'LA015';
  end if;
  return new;
end $$;
create trigger head_matches_entry after insert on lims.chain_verification
  for each row execute function lims.chain_verification_head_matches_entry();

grant select on lims.chain_verification to lims_app;
grant insert (chain, through, head, recomputed_from, verified_by) on lims.chain_verification to lims_app;

create index audit_entry_chain_verification on lims.audit_entry (((new_row ->> 'id')::uuid))
  where table_name = 'chain_verification' and op = 'INSERT';

-- Whether the Audit Trail still stands behind the hash p_hash at entry (p_chain, p_seq): the entry carries it, it
-- recomputes to it, and the next entry links to it or the chain head records it. A rewrite that re-hashes the entry,
-- or every entry after it, moves the chain away from the hash a record named, and this says so.
create function lims.entry_holds(p_chain text, p_seq bigint, p_hash bytea) returns boolean
language sql stable security definer set search_path = lims, pg_temp as $$
  select exists (select from audit_entry e
                 where e.chain = p_chain and e.seq = p_seq and e.hash = p_hash
                   and e.hash = sha256(e.prev_hash || audit_entry_bytes(e))
                   and (exists (select from audit_entry n
                                where n.chain = p_chain and n.seq = p_seq + 1 and n.prev_hash = p_hash)
                        or exists (select from audit_chain h
                                   where h.chain = p_chain and h.seq = p_seq and h.head = p_hash)))
$$;

-- Whether the Audit Trail still matches a Chain Verification: its own chain stands behind the hash it names at its
-- entry, and the company chain stands behind the entry that recorded its insert with the same chain, entry and hash.
-- Rewriting an old company entry into a forged record fails the second, because the company chain no longer links to
-- the rewritten entry unless every entry after it is re-hashed up to the company head.
create function lims.chain_verification_holds(c lims.chain_verification) returns boolean
language sql stable security definer set search_path = lims, pg_temp as $$
  select entry_holds(c.chain, c.through, c.head)
     and exists (select from audit_entry a
                 where a.table_name = 'chain_verification' and a.op = 'INSERT' and a.chain = 'company'
                   and (a.new_row ->> 'id')::uuid = c.id
                   and a.new_row ->> 'chain' = c.chain
                   and (a.new_row ->> 'through')::bigint = c.through
                   and (a.new_row ->> 'head')::bytea = c.head
                   and entry_holds('company', a.seq, a.hash))
$$;

-- The latest Chain Verification a verification may resume from: one before the first break any System Incident records
-- on the chain, which the Audit Trail still matches. When entries through it are no longer all present, none is.
create function lims.latest_chain_verification(p_chain text)
returns table (through bigint, head bytea, verified_at timestamptz, verified_by uuid)
language sql stable security definer set search_path = lims, pg_temp as $$
  select c.through, c.head, c.verified_at, c.verified_by
  from (select c.through, c.head, c.verified_at, c.verified_by
        from chain_verification c
        where c.chain = p_chain
          and not exists (select from system_incident i
                          where i.kind = 'ChainVerifyFailure' and i.chain = p_chain and i.first_failure <= c.through)
          and chain_verification_holds(c)
        order by c.through desc, c.verified_at desc
        limit 1) as c
  where (select count(*) from audit_entry e where e.chain = p_chain and e.seq between 1 and c.through) = c.through
$$;

-- Every Chain Verification of the chain that the Audit Trail no longer matches, each a Contradicted break at its
-- entry, whatever System Incidents record: a recorded one keeps being reported and answers the same incident. The
-- fingerprint is the Chain Verification and the hash its entry carries now, so a further rewrite opens a new incident.
create function lims.chain_verification_breaks(p_chain text)
returns table (seq bigint, kind text, through bigint, fingerprint bytea)
language sql stable security definer set search_path = lims, pg_temp as $$
  select c.through, 'Contradicted', c.through,
         sha256(uuid_send(c.id)
                || coalesce((select e.hash from audit_entry e where e.chain = p_chain and e.seq = c.through), ''::bytea))
  from chain_verification c
  where c.chain = p_chain and not chain_verification_holds(c)
  order by c.through, c.verified_at
$$;

-- Every break after entry p_from, whose hash is p_head, each with the fingerprint a recompute from the first entry
-- gives it, so a break names one System Incident however the verification resumed.
drop function lims.chain_breaks(text);
create function lims.chain_breaks(p_chain text, p_from bigint, p_head bytea)
returns table (seq bigint, kind text, through bigint, fingerprint bytea)
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  e audit_entry;
  recorded audit_chain;
  accepted bytea[] := array[p_head];
  computed bytea;
  expected bigint := p_from + 1;
begin
  for e in select * from audit_entry a where a.chain = p_chain and a.seq > p_from order by a.seq loop
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

-- Every break a routine verification finds: the walk from the chain's latest Chain Verification, or from its first
-- entry when it has none, and every Chain Verification the Audit Trail no longer matches, in entry order.
create function lims.chain_breaks(p_chain text) returns table (seq bigint, kind text, through bigint, fingerprint bytea)
language sql stable security definer set search_path = lims, pg_temp as $$
  select b.seq, b.kind, b.through, b.fingerprint
  from (select c.through, c.head from latest_chain_verification(p_chain) c
        union all select 0, decode(repeat('00', 32), 'hex')
        order by through desc limit 1) as resume,
       lateral chain_breaks(p_chain, resume.through, resume.head) as b
  union all
  select v.seq, v.kind, v.through, v.fingerprint from chain_verification_breaks(p_chain) as v
  order by seq, kind
$$;

-- Returns the first seq that fails to verify, or null.
create or replace function lims.verify_chain(p_chain text) returns bigint
language sql stable security definer set search_path = lims, pg_temp as $$
  select min(b.seq) from chain_breaks(p_chain) as b
$$;

grant execute on function lims.latest_chain_verification(text) to lims_app;
grant execute on function lims.chain_breaks(text, bigint, bytea) to lims_app;
grant execute on function lims.chain_breaks(text) to lims_app;
grant execute on function lims.chain_verification_breaks(text) to lims_app;

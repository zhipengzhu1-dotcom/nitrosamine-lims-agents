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

create function lims.chain_verification_head_matches_entry() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  if not exists (select from audit_entry e where e.chain = new.chain and e.seq = new.through and e.hash = new.head) then
    raise exception 'a Chain Verification names an entry of its chain and that entry''s hash' using errcode = 'LA014';
  end if;
  return new;
end $$;
create trigger head_matches_entry after insert on lims.chain_verification
  for each row execute function lims.chain_verification_head_matches_entry();

grant select on lims.chain_verification to lims_app;
grant insert (chain, through, head, recomputed_from, verified_by) on lims.chain_verification to lims_app;

create index audit_entry_chain_verification on lims.audit_entry (((new_row ->> 'id')::uuid))
  where table_name = 'chain_verification' and op = 'INSERT';

-- The latest Chain Verification a verification may resume from: one before the first break any System Incident records
-- on the chain, whose insert the company chain records with the same chain, entry and hash, and whose entry still
-- carries that hash and recomputes to it. When entries through it are no longer all present, none is.
create function lims.latest_chain_verification(p_chain text)
returns table (through bigint, head bytea, verified_at timestamptz, verified_by uuid)
language sql stable security definer set search_path = lims, pg_temp as $$
  select c.through, c.head, c.verified_at, c.verified_by
  from (select c.through, c.head, c.verified_at, c.verified_by
        from chain_verification c
        where c.chain = p_chain
          and not exists (select from system_incident i
                          where i.kind = 'ChainVerifyFailure' and i.chain = p_chain and i.first_failure <= c.through)
          and exists (select from audit_entry a
                      where a.table_name = 'chain_verification' and a.op = 'INSERT' and a.chain = 'company'
                        and (a.new_row ->> 'id')::uuid = c.id
                        and a.new_row ->> 'chain' = c.chain
                        and (a.new_row ->> 'through')::bigint = c.through
                        and (a.new_row ->> 'head')::bytea = c.head)
          and exists (select from audit_entry e
                      where e.chain = p_chain and e.seq = c.through and e.hash = c.head
                        and e.hash = sha256(e.prev_hash || audit_entry_bytes(e)))
        order by c.through desc, c.verified_at desc
        limit 1) as c
  where (select count(*) from audit_entry e where e.chain = p_chain and e.seq between 1 and c.through) = c.through
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

-- Every break a routine verification finds: from the chain's latest Chain Verification, or from its first entry when
-- it has none.
create function lims.chain_breaks(p_chain text) returns table (seq bigint, kind text, through bigint, fingerprint bytea)
language sql stable security definer set search_path = lims, pg_temp as $$
  select b.seq, b.kind, b.through, b.fingerprint
  from (select c.through, c.head from latest_chain_verification(p_chain) c
        union all select 0, decode(repeat('00', 32), 'hex')
        order by through desc limit 1) as resume,
       lateral chain_breaks(p_chain, resume.through, resume.head) as b
$$;

-- Returns the first seq that fails to verify, or null.
create or replace function lims.verify_chain(p_chain text) returns bigint
language sql stable security definer set search_path = lims, pg_temp as $$
  select min(b.seq) from chain_breaks(p_chain) as b
$$;

grant execute on function lims.latest_chain_verification(text) to lims_app;
grant execute on function lims.chain_breaks(text, bigint, bytea) to lims_app;
grant execute on function lims.chain_breaks(text) to lims_app;

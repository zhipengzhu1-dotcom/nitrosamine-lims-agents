set local role lims_owner;

-- Transaction IDs (#45, gap 4). Entries written before this migration keep a null ID and verify with their old bytes;
-- the not-valid constraint refuses a null on every entry written from now on.
alter table lims.audit_entry add column transaction_id uuid;
alter table lims.audit_entry add constraint audit_entry_transaction_id_not_null not null transaction_id not valid;

create or replace function lims.audit_entry_bytes(e lims.audit_entry) returns bytea
language sql stable as $$
  select convert_to((jsonb_build_array(
    e.chain, e.seq, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.actor, e.role, e.reason, e.table_name, e.op, e.old_row, e.new_row)
    || case when e.transaction_id is null then '[]'::jsonb else jsonb_build_array(e.transaction_id) end)::text, 'UTF8')
$$;

-- Chain locks are taken company first, then Labs by ID, so two transactions that write to the same chains never wait
-- on each other in a cycle. A lock that would break the order is refused; a transaction that must write a Lab before
-- the company declares both up front with lock_chains.
create function lims.lock_chain(p_chain text) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  held   text[] := coalesce(string_to_array(nullif(current_setting('lims.chains', true), ''), ','), '{}');
  latest text   := held[cardinality(held)];
begin
  if p_chain = any(held) then
    return;
  end if;
  if p_chain <> 'company' and not exists (select from lab where lab_id::text = p_chain) then
    raise exception 'there is no Audit Trail chain %', p_chain using errcode = 'LA004';
  end if;
  if latest is not null and (p_chain = 'company' or (latest <> 'company' and p_chain::uuid < latest::uuid)) then
    raise exception 'chain % is locked after chain %; declare both chains when the transaction starts', p_chain, latest
      using errcode = 'LA004';
  end if;
  insert into audit_chain (chain) values (p_chain) on conflict do nothing;
  perform from audit_chain where chain = p_chain for update;
  perform set_config('lims.chains', array_to_string(held || p_chain, ','), true);
end $$;

create function lims.lock_chains(variadic p_chains text[]) returns void
language sql security definer set search_path = lims, pg_temp as $$
  select lock_chain(c)
    from unnest(p_chains) c
   order by c <> 'company', case when c <> 'company' then c::uuid end
$$;

create or replace function lims.capture() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  e audit_entry;
begin
  e.actor  := nullif(current_setting('lims.actor', true), '');
  e.role   := nullif(current_setting('lims.role', true), '');
  e.reason := nullif(current_setting('lims.reason', true), '');
  if e.actor is null or e.role is null or e.reason is null then
    raise exception 'an audited write needs an actor, a role and a reason' using errcode = 'LA001';
  end if;
  e.table_name := tg_table_name;
  e.op := tg_op;
  if tg_op <> 'INSERT' then e.old_row := to_jsonb(old) - 'password_hash'; end if;
  if tg_op <> 'DELETE' then e.new_row := to_jsonb(new) - 'password_hash'; end if;
  e.chain := coalesce(coalesce(e.new_row, e.old_row) ->> 'lab_id', 'company');

  -- The first write of a transaction draws its ID, so every entry the transaction writes carries the same one.
  e.transaction_id := nullif(current_setting('lims.transaction', true), '')::uuid;
  if e.transaction_id is null then
    e.transaction_id := gen_random_uuid();
    perform set_config('lims.transaction', e.transaction_id::text, true);
  end if;

  perform lock_chain(e.chain);
  select seq + 1, head into e.seq, e.prev_hash from audit_chain where chain = e.chain;
  e.at := clock_timestamp();
  e.hash := sha256(e.prev_hash || audit_entry_bytes(e));
  insert into audit_entry values (e.*);
  update audit_chain set seq = e.seq, head = e.hash where chain = e.chain;
  return null;
end $$;

-- Counters (#45, gaps 8 and 14). A row is a per-Lab, per-kind counter; a Submission's is company-wide (no Lab). It
-- changes only inside the caller's transaction, so a rollback returns the number and no number is skipped.
create type lims.numbered_kind as enum ('Submission', 'Sample', 'TestReport');

create table lims.counter (
  lab_id uuid references lims.lab,
  kind   lims.numbered_kind not null,
  last   integer not null default 0,
  unique nulls not distinct (lab_id, kind),
  check ((kind = 'Submission') = (lab_id is null))
);

create function lims.refuse_counter_change() returns trigger
language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and current_setting('lims.numbering', true) = 'on' then
    return new;
  end if;
  raise exception 'a counter changes only when lims.take_number takes a number' using errcode = 'LA003';
end $$;

create trigger refuse_change before insert or update or delete on lims.counter
  for each row execute function lims.refuse_counter_change();
create trigger refuse_truncate before truncate on lims.counter
  for each statement execute function lims.refuse_counter_change();

-- Takes the next number of a kind for the Lab, with the Lab's code and the Lab's local date at assignment.
create function lims.take_number(p_kind lims.numbered_kind, p_lab_id uuid)
returns table (seq integer, lab_code text, local_date text)
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  counter_lab uuid := case when p_kind = 'Submission' then null else p_lab_id end;
begin
  select l.code, to_char(clock_timestamp() at time zone l.time_zone, 'YYYY-MM-DD') into lab_code, local_date
    from lab l where l.lab_id = p_lab_id;
  if not found then
    raise exception 'there is no Lab %', p_lab_id using errcode = 'LA004';
  end if;
  perform lock_chain(coalesce(counter_lab::text, 'company'));
  perform set_config('lims.numbering', 'on', true);
  insert into counter (lab_id, kind) values (counter_lab, p_kind) on conflict (lab_id, kind) do nothing;
  update counter c set last = c.last + 1
   where c.lab_id is not distinct from counter_lab and c.kind = p_kind
  returning c.last into seq;
  perform set_config('lims.numbering', '', true);
  return next;
end $$;

-- The Lab's own time zone sets the year of its numbers. The existing Lab is taken to keep US Eastern time (agent
-- default on #88).
alter table lims.lab add column time_zone text not null default 'America/New_York'
  check (now() at time zone time_zone is not null);
alter table lims.lab alter column time_zone drop default;

-- Submissions made before counters get numbers in the order they were made, in the year they were made.
alter table lims.submission add column number text unique;

select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Number the Submissions made before counters', true);

do $$
declare
  s record;
  n record;
begin
  for s in
    select sub.id, lab_id, lab.time_zone, sub.made_at
      from (select id,
                   coalesce((select lab_id from lims.sample where submission_id = submission.id order by lab_id limit 1),
                            (select lab_id from lims.lab order by lab_id limit 1)) as lab_id,
                   (select min(at) from lims.audit_entry
                     where table_name = 'submission' and op = 'INSERT' and new_row ->> 'id' = submission.id::text) as made_at
              from lims.submission) sub
      join lims.lab using (lab_id)
     order by sub.made_at, sub.id
  loop
    select * into n from lims.take_number('Submission', s.lab_id);
    update lims.submission
       set number = format('SUB-%s-%s', coalesce(to_char(s.made_at at time zone s.time_zone, 'YYYY'),
                                                 left(n.local_date, 4)), lpad(n.seq::text, 6, '0'))
     where id = s.id;
  end loop;
end $$;

alter table lims.submission alter column number set not null;

grant execute on function lims.take_number(lims.numbered_kind, uuid), lims.lock_chains(text[]) to lims_app;

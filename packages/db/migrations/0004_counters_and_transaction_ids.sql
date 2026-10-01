set local role lims_owner;

-- Per-transaction state lives in settings stamped with the transaction's xid, so a value left over from an earlier
-- transaction on the same connection, or set at session level, is never taken for this transaction's.
create function lims.this_transaction(p_name text) returns text
language sql volatile set search_path = lims, pg_temp as $$
  select nullif(split_part(coalesce(current_setting(p_name, true), ''), ':', 2), '')
   where split_part(coalesce(current_setting(p_name, true), ''), ':', 1) = pg_current_xact_id()::text
$$;

create function lims.set_this_transaction(p_name text, p_value text) returns void
language sql volatile set search_path = lims, pg_temp as $$
  select set_config(p_name, pg_current_xact_id()::text || ':' || p_value, true)
$$;

-- Transaction IDs (#45, gap 4). Entries written before this migration keep a null ID and verify with their old bytes;
-- the not-valid check refuses a null on every entry written from now on.
alter table lims.audit_entry add column transaction_id uuid;
alter table lims.audit_entry add constraint audit_entry_transaction_id_check check (transaction_id is not null) not valid;

create or replace function lims.audit_entry_bytes(e lims.audit_entry) returns bytea
language sql stable as $$
  select convert_to((jsonb_build_array(
    e.chain, e.seq, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.actor, e.role, e.reason, e.table_name, e.op, e.old_row, e.new_row)
    || case when e.transaction_id is null then '[]'::jsonb else jsonb_build_array(e.transaction_id) end)::text, 'UTF8')
$$;

-- Chain locks are taken company first, then Labs by ID, so two transactions that write to the same chains never wait
-- on each other in a cycle. A lock that would break the order is refused; a transaction that must write a Lab before
-- the company, or several Labs in one statement, declares its chains up front with lock_chains.
create function lims.lock_chain(p_chain text) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  held   text[] := coalesce(string_to_array(this_transaction('lims.chains'), ','), '{}');
  latest text   := held[cardinality(held)];
begin
  if not p_chain = any(held) then
    if latest is not null and (p_chain = 'company' or (latest <> 'company' and p_chain::uuid < latest::uuid)) then
      raise exception 'chain % is locked after chain %; declare both chains when the transaction starts', p_chain, latest
        using errcode = 'LA004';
    end if;
    insert into audit_chain (chain) values (p_chain) on conflict do nothing;
    perform set_this_transaction('lims.chains', array_to_string(held || p_chain, ','));
  end if;
  perform from audit_chain where chain = p_chain for update;
end $$;

create function lims.lock_chains(variadic p_chains text[]) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  c text;
begin
  foreach c in array p_chains loop
    if c <> 'company' and not exists (select from lab where lab_id::text = c) then
      raise exception 'there is no Audit Trail chain %', c using errcode = 'LA005';
    end if;
  end loop;
  foreach c in array (select array_agg(x order by x <> 'company', case when x <> 'company' then x::uuid end)
                        from unnest(p_chains) x) loop
    perform lock_chain(c);
  end loop;
end $$;

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

  -- Derived from the transaction itself, so no caller can choose it: the xid is unique within this cluster, and the
  -- cluster's system identifier keeps it unique after a restore into another.
  e.transaction_id := md5((select system_identifier from pg_control_system())::text || ':'
                          || pg_current_xact_id()::text)::uuid;

  perform lock_chain(e.chain);
  select seq + 1, head into e.seq, e.prev_hash from audit_chain where chain = e.chain for update;
  e.at := clock_timestamp();
  e.hash := sha256(e.prev_hash || audit_entry_bytes(e));
  insert into audit_entry values (e.*);
  update audit_chain set seq = e.seq, head = e.hash where chain = e.chain;
  return null;
end $$;

-- Counters (#45, gaps 8 and 14). A row is a per-Lab, per-kind counter; a Submission's is company-wide (no Lab). It
-- moves only inside the caller's transaction, so a rollback returns the number and no number is skipped. Six digits.
create type lims.numbered_kind as enum ('Submission', 'Sample', 'TestReport');

create table lims.counter (
  lab_id uuid references lims.lab,
  kind   lims.numbered_kind not null,
  last   integer not null default 0 check (last between 0 and 999999),
  unique nulls not distinct (lab_id, kind),
  check ((kind = 'Submission') = (lab_id is null))
);

-- Inside take_number a counter starts at zero and moves up by one; nothing else changes one, even for the owner.
create function lims.refuse_counter_change() returns trigger
language plpgsql set search_path = lims, pg_temp as $$
begin
  if this_transaction('lims.numbering') = 'on' and (
       (tg_op = 'INSERT' and new.last = 0) or
       (tg_op = 'UPDATE' and new.last = old.last + 1 and new.kind = old.kind
        and new.lab_id is not distinct from old.lab_id)) then
    return new;
  end if;
  raise exception 'a counter changes only when lims.take_number takes a number' using errcode = 'LA003';
end $$;

create trigger refuse_change before insert or update or delete on lims.counter
  for each row execute function lims.refuse_counter_change();
create trigger refuse_truncate before truncate on lims.counter
  for each statement execute function lims.refuse_counter_change();

-- Takes the next number of a kind for the Lab inside an audited transaction, with the Lab's code and the Lab's local
-- date at the moment the number is assigned.
create function lims.take_number(p_kind lims.numbered_kind, p_lab_id uuid)
returns table (seq integer, lab_code text, local_date text)
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  counter_lab uuid := case when p_kind = 'Submission' then null else p_lab_id end;
begin
  if nullif(current_setting('lims.actor', true), '') is null or nullif(current_setting('lims.role', true), '') is null
     or nullif(current_setting('lims.reason', true), '') is null then
    raise exception 'an audited write needs an actor, a role and a reason' using errcode = 'LA001';
  end if;
  if not exists (select from lab where lab_id = p_lab_id) then
    raise exception 'there is no Lab %', p_lab_id using errcode = 'LA005';
  end if;
  perform lock_chain(coalesce(counter_lab::text, 'company'));
  perform set_this_transaction('lims.numbering', 'on');
  insert into counter (lab_id, kind) values (counter_lab, p_kind) on conflict (lab_id, kind) do nothing;
  update counter c set last = c.last + 1
   where c.lab_id is not distinct from counter_lab and c.kind = p_kind
  returning c.last into seq;
  perform set_this_transaction('lims.numbering', 'off');
  select l.code, to_char(clock_timestamp() at time zone l.time_zone, 'YYYY-MM-DD') into lab_code, local_date
    from lab l where l.lab_id = p_lab_id;
  return next;
end $$;

-- Only a named zone of the time zone database, so an offset such as 'UTC+5' (which POSIX reads as five hours behind)
-- cannot set a Lab's year.
create function lims.is_time_zone(p_name text) returns boolean
language sql stable set search_path = lims, pg_temp as $$
  select exists (select from pg_timezone_names where name = p_name)
$$;

-- The Lab's own time zone sets the year of its numbers. The existing Lab is taken to keep US Eastern time (agent
-- default on #88).
alter table lims.lab add column time_zone text not null default 'America/New_York' check (lims.is_time_zone(time_zone));
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
    with made as (
      select new_row ->> 'id' as id, min(at) as at
        from lims.audit_entry
       where table_name = 'submission' and op = 'INSERT'
       group by 1
    )
    select sub.id, lab.lab_id, lab.time_zone, made.at as made_at
      from lims.submission sub
      left join made on made.id = sub.id::text
      left join lateral (
        select l.lab_id, l.time_zone
          from lims.lab l
         order by exists (select from lims.sample where submission_id = sub.id and lab_id = l.lab_id) desc, l.lab_id
         limit 1) lab on true
     order by made.at, sub.id
  loop
    if s.lab_id is null then
      raise exception 'Submission % has no Lab to number it in', s.id;
    end if;
    select * into n from lims.take_number('Submission', s.lab_id);
    update lims.submission
       set number = format('SUB-%s-%s', coalesce(to_char(s.made_at at time zone s.time_zone, 'YYYY'),
                                                 left(n.local_date, 4)), lpad(n.seq::text, 6, '0'))
     where id = s.id;
  end loop;
end $$;

alter table lims.submission alter column number set not null;

grant execute on function lims.take_number(lims.numbered_kind, uuid), lims.lock_chains(text[]), lims.is_time_zone(text)
  to lims_app;

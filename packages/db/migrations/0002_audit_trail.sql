set local role lims_owner;

create table lims.audit_chain (
  chain text   primary key,
  seq   bigint not null default 0,
  head  bytea  not null default decode(repeat('00', 32), 'hex')
);

create table lims.audit_entry (
  chain      text        not null references lims.audit_chain,
  seq        bigint      not null,
  at         timestamptz not null,
  actor      text        not null,
  role       text        not null,
  reason     text        not null,
  table_name text        not null,
  op         text        not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  old_row    jsonb,
  new_row    jsonb,
  prev_hash  bytea       not null,
  hash       bytea       not null,
  primary key (chain, seq)
);

-- The time is rendered in UTC explicitly so the bytes do not depend on the session's TimeZone.
create function lims.audit_entry_bytes(e lims.audit_entry) returns bytea
language sql stable as $$
  select convert_to(jsonb_build_array(
    e.chain, e.seq, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.actor, e.role, e.reason, e.table_name, e.op, e.old_row, e.new_row)::text, 'UTF8')
$$;

create function lims.capture() returns trigger
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

  insert into audit_chain (chain) values (e.chain) on conflict do nothing;
  select seq + 1, head into e.seq, e.prev_hash from audit_chain where chain = e.chain for update;
  e.at := clock_timestamp();
  e.hash := sha256(e.prev_hash || audit_entry_bytes(e));
  insert into audit_entry values (e.*);
  update audit_chain set seq = e.seq, head = e.hash where chain = e.chain;
  return null;
end $$;

-- Returns the first seq that fails to verify (a gap, a changed entry, or a head that moved), or null.
create function lims.verify_chain(p_chain text) returns bigint
language plpgsql stable security definer set search_path = lims, pg_temp as $$
declare
  e audit_entry;
  running bytea := decode(repeat('00', 32), 'hex');
  expected bigint := 1;
begin
  for e in select * from audit_entry where chain = p_chain order by seq loop
    if e.seq <> expected or e.prev_hash <> running or e.hash <> sha256(running || audit_entry_bytes(e)) then
      return expected;
    end if;
    running := e.hash;
    expected := expected + 1;
  end loop;
  if running <> coalesce((select head from audit_chain where chain = p_chain), running) then
    return expected;
  end if;
  return null;
end $$;

create function lims.refuse_change() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are never changed or removed', tg_table_name using errcode = 'LA002';
end $$;

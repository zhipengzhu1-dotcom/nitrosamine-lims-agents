-- Each service identity writes only the tables, and changes only the columns, its own code writes
-- (part11 residual R2 on S2). require_context admits a svc:% grant in any Lab and on any table, so
-- until now only the app's SERVICE_COMMANDS kept a service in bounds. The rows below were taken
-- from the code: svc:auth from the login, enrolment, unlock and takeover commands, the survivors
-- and spec gaps the pipeline writes after a refusal, and retireSeed; svc:seed from its reference
-- and identity commands (identity.reenrol included) and seed.lab; the sweeper from sweeper.ts. An
-- UPDATE row names the only columns that service may change. A service not listed writes nothing.
create table lims.service_write (
  role       text not null check (role like 'svc:%'),
  table_name text not null,
  op         text not null check (op in ('INSERT', 'UPDATE')),
  columns    text[] check ((op = 'UPDATE') = (columns is not null)),
  primary key (role, table_name, op)
);

insert into lims.service_write values
  ('svc:auth', 'session',         'INSERT', null),
  ('svc:auth', 'session',         'UPDATE', array['locked_at', 'lock_reason', 'ended_at', 'end_reason']),
  ('svc:auth', 'auth_event',      'INSERT', null),
  ('svc:auth', 'totp_step_used',  'INSERT', null),
  ('svc:auth', 'alert',           'INSERT', null),
  ('svc:auth', 'spec_gap',        'INSERT', null),
  ('svc:auth', 'account',         'UPDATE', array['password_hash', 'totp_secret_enc']),
  ('svc:auth', 'enrolment_link',  'UPDATE', array['totp_secret_enc', 'used_at']),
  ('svc:auth', 'role_grant',      'UPDATE', array['revoked_at']),
  ('svc:seed', 'lab',             'INSERT', null),
  ('svc:seed', 'customer',        'INSERT', null),
  ('svc:seed', 'substance',       'INSERT', null),
  ('svc:seed', 'product',         'INSERT', null),
  ('svc:seed', 'method',          'INSERT', null),
  ('svc:seed', 'method_version',  'INSERT', null),
  ('svc:seed', 'specification',   'INSERT', null),
  ('svc:seed', 'method_adoption', 'INSERT', null),
  ('svc:seed', 'method_adoption_scope', 'INSERT', null),
  ('svc:seed', 'equipment',       'INSERT', null),
  ('svc:seed', 'record',          'INSERT', null),
  ('svc:seed', 'record_version',  'INSERT', null),
  ('svc:seed', 'record_version_cite', 'INSERT', null),
  ('svc:seed', 'person',          'INSERT', null),
  ('svc:seed', 'account',         'INSERT', null),
  ('svc:seed', 'account',         'UPDATE', array['password_hash', 'totp_secret_enc', 'identity_checked_by', 'identity_checked_at', 'identity_check_method']),
  ('svc:seed', 'role_grant',      'INSERT', null),
  ('svc:seed', 'enrolment_link',  'INSERT', null),
  ('svc:seed', 'session',         'UPDATE', array['ended_at', 'end_reason']),
  ('svc:seed', 'auth_event',      'INSERT', null),
  ('svc:session-sweeper', 'session',    'UPDATE', array['locked_at', 'lock_reason']),
  ('svc:session-sweeper', 'auth_event', 'INSERT', null);

-- BEFORE INSERT OR UPDATE on every audited table. It reads only the role from the context:
-- capture() validates the whole context on the same row, so a forged role still has to name a
-- live grant. Once a row carries a stamp that ends it (a session's end, a link's use, a grant's
-- revocation), a service changes nothing on it, so nothing ended comes back or is rewritten. The
-- one role_grant change a service makes is svc:auth retiring the seed, so a person's grant is
-- refused.
create function lims.service_scope() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  v_role  text := nullif(current_setting('lims.ctx', true), '')::jsonb->>'role';
  allowed text[];
  changed text[];
begin
  if v_role is null or v_role not like 'svc:%' then
    return new;
  end if;
  select w.columns into allowed from lims.service_write w
   where w.role = v_role and w.table_name = tg_table_name and w.op = tg_op;
  if not found then
    raise exception '% may not % %', v_role, lower(tg_op), tg_table_name using errcode = 'LA011';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key), '{}') into changed
      from jsonb_each(to_jsonb(new)) n
     where n.value is distinct from to_jsonb(old)->n.key;
    if not changed <@ allowed then
      raise exception '% may change only % on %, not %', v_role, allowed, tg_table_name, changed using errcode = 'LA011';
    end if;
    if changed <> '{}' and exists (select 1 from unnest(array['ended_at', 'used_at', 'revoked_at']) c
                                    where to_jsonb(old)->>c is not null) then
      raise exception '% may not change % on a % row that has ended', v_role, changed, tg_table_name using errcode = 'LA011';
    end if;
    if tg_table_name = 'role_grant' and changed <> '{}' and to_jsonb(old)->>'role' <> 'svc:seed' then
      raise exception '% may only revoke the svc:seed grant', v_role using errcode = 'LA011';
    end if;
  end if;
  return new;
end $$;

do $$
declare t regclass;
begin
  for t in select tgrelid::regclass from pg_trigger where tgname = 'capture' loop
    execute format('create trigger service_scope before insert or update on %s for each row execute function lims.service_scope()', t);
  end loop;
end $$;

-- As in 0010, plus the service_scope trigger, so a table registered later is guarded too.
create or replace function lims.register_table(tbl regclass, ledger_source text, insert_only boolean,
                                               record_col text default null, redact text[] default '{}')
returns void language plpgsql as $$
declare
  pk  text[];
  rec text;
begin
  if ledger_source not in ('lab_id', 'ledger_id', 'company') then
    raise exception 'ledger source must be lab_id, ledger_id or company';
  end if;
  select array_agg(a.attname order by k.ord) into pk
    from pg_index i
    cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = tbl and i.indisprimary;
  if pk is null then
    raise exception 'table % has no primary key', tbl;
  end if;
  rec := coalesce(record_col, (select a.attname::text from pg_attribute a
                                where a.attrelid = tbl and a.attname = 'record_id' and not a.attisdropped));
  execute format('create trigger capture after insert or update on %s for each row execute function lims.capture(%L, %L, %L, %L)',
                 tbl, ledger_source, array_to_string(pk, ','), coalesce(rec, ''), array_to_string(redact, ','));
  execute format('create trigger service_scope before insert or update on %s for each row execute function lims.service_scope()', tbl);
  execute format('create trigger block_truncate before truncate on %s for each statement execute function lims.block_mutation()', tbl);
  if insert_only then
    execute format('create trigger block_mutation before update or delete on %s for each row execute function lims.block_mutation()', tbl);
    execute format('grant select, insert on %s to lims_app', tbl);
  else
    execute format('create trigger block_delete before delete on %s for each row execute function lims.block_mutation()', tbl);
    execute format('grant select, insert, update on %s to lims_app', tbl);
  end if;
end $$;

grant select on lims.service_write to lims_app;

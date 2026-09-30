-- Review fix 17: what a Customer may write into a Lab ledger, row shape by row shape. Decision 12
-- lets a Submission create its Samples as Expected and its Tests as Requested in the Lab that will
-- test them, and decision 13 §2 records every download as an event. Nothing else a Customer
-- context inserts is its own, and no in-place change ever is (LA006). The earlier guard admitted
-- any INSERT naming the Customer and any bare record row. The GxP Class stays at its default
-- until a decision names who sets it. A download names a report of the Customer's own; 0064's
-- composite keys keep a Sample on the Customer's own Product and a Test on its own Sample.
create or replace function lims.capture() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx      jsonb := lims.require_context();
  newj     jsonb := to_jsonb(new);
  oldj     jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  redacted text[] := string_to_array(tg_argv[3], ',');
  diff     jsonb := '{}'::jsonb;
  ledger   uuid;
  k        text;
  customer_own boolean;
begin
  ledger := case tg_argv[0] when 'company' then lims.company_ledger() else (newj->>tg_argv[0])::uuid end;
  if ledger is null then
    raise exception 'row on % names no ledger', tg_table_name using errcode = 'LA006';
  end if;
  customer_own := tg_op = 'INSERT' and (ctx->>'customer_id') is not null and case tg_table_name
    when 'record' then newj->>'kind' = 'test' and newj->>'parent_id' is null
    when 'sample' then newj->>'customer_id' = ctx->>'customer_id'
                       and newj->>'state' = 'Expected' and newj->>'number' is null
                       and newj->>'received_at' is null and newj->>'received_by' is null
    when 'test' then newj->>'customer_id' = ctx->>'customer_id'
                     and newj->>'state' = 'Requested' and newj->>'number' is null
                     and newj->>'method_version_id' is null and newj->>'specification_version_id' is null
                     and newj->>'assigned_analyst' is null and newj->>'acceptance_reason' is null
                     and newj->>'gxp_class' = 'GMP'
    when 'report_download' then newj->>'customer_id' = ctx->>'customer_id' and newj->>'person_id' = ctx->>'person_id'
                     and exists (select 1 from lims.report_issue i
                                   join lims.record_version v on v.id = i.report_version_id
                                   join lims.test_report r on r.id = v.record_id
                                  where i.report_version_id = (newj->>'report_version_id')::uuid
                                    and r.customer_id = (ctx->>'customer_id')::uuid)
    else false end;
  if ctx->>'role' not like 'svc:%'
     and exists (select 1 from lims.lab where id = ledger)
     and ledger is distinct from (ctx->>'acting_lab_id')::uuid
     and not customer_own then
    raise exception 'row for Lab % written while acting in Lab %', ledger, ctx->>'acting_lab_id' using errcode = 'LA006';
  end if;
  if tg_op = 'UPDATE' and ctx->>'reason_code' = 'first_save' then
    raise exception 'a change after first save needs a Reason for Change' using errcode = 'LA007';
  end if;
  for k in select jsonb_object_keys(newj) loop
    if oldj is null or (oldj->k) is distinct from (newj->k) then
      if k = any (redacted) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(case when oldj is null then null else '[changed]' end, '[changed]'));
      else
        diff := diff || jsonb_build_object(k, jsonb_build_array(oldj->k, newj->k));
      end if;
    end if;
  end loop;
  if diff = '{}'::jsonb then
    return null;
  end if;
  perform lims.append_audit(
    ledger, tg_table_name,
    (select jsonb_agg(newj->c) from unnest(string_to_array(tg_argv[1], ',')) c)::text,
    case when tg_argv[2] <> '' then (newj->>tg_argv[2])::uuid end,
    lower(tg_op), diff);
  return null;
end $$;

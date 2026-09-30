-- Review fix 20: re-proposing a value that was rejected is a new pending version. The seal door
-- reuses a version only when the bytes equal the latest version that was not rejected, so the
-- second proposal gets its own version, audit entry and approval. The version number still
-- follows the highest one, rejected or not.
create or replace function lims.seal(p_record uuid, p_content bytea, p_schema text, p_cites jsonb default '[]'::jsonb)
returns table (version_id uuid, version_no int, content_hash bytea, reused boolean)
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ctx     jsonb := lims.require_context();
  rec     lims.record;
  latest  lims.record_version;
  cited   lims.record_version;
  h       bytea := sha256(p_content);
  vid     uuid  := gen_random_uuid();
  next_no int;
  c       jsonb;
begin
  select * into rec from lims.record where id = p_record;
  if not found then
    raise exception 'record % does not exist', p_record using errcode = 'LV001';
  end if;
  select * into latest from lims.record_version v
   where v.record_id = p_record
     and not exists (select 1 from lims.version_rejection r where r.version_id = v.id)
   order by v.version_no desc limit 1;
  if found and latest.content_hash = h then
    return query select latest.id, latest.version_no, latest.content_hash, true;
    return;
  end if;
  select coalesce(max(v.version_no), 0) + 1 into next_no from lims.record_version v where v.record_id = p_record;
  insert into lims.record_version (ledger_id, id, record_id, version_no, content, content_schema, created_by, app_release)
  values (rec.ledger_id, vid, p_record, next_no, p_content, p_schema, (ctx->>'person_id')::uuid, ctx->>'app_release');
  for c in select * from jsonb_array_elements(p_cites) loop
    select * into cited from lims.record_version where id = (c->>'version_id')::uuid;
    if not found or cited.content_hash <> decode(c->>'hash', 'hex') then
      raise exception 'cite of version % does not match its stored hash', c->>'version_id' using errcode = 'LV002';
    end if;
    if position(encode(cited.content_hash, 'hex') in convert_from(p_content, 'UTF8')) = 0 then
      raise exception 'content does not carry the hash it cites (%)', c->>'version_id' using errcode = 'LV003';
    end if;
    insert into lims.record_version_cite (ledger_id, version_id, cited_version, cited_hash)
    values (rec.ledger_id, vid, cited.id, cited.content_hash);
  end loop;
  return query select vid, next_no, h, false;
end $$;

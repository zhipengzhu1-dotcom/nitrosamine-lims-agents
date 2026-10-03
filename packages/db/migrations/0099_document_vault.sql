set local role lims_owner;

-- The Document vault (#113): a Lab's controlled Documents, each a number and a type that never change, and its
-- versions, each written as a Draft by its author and made Effective only by three independent Signatures.
create type lims.document_type as enum ('QualityManual', 'Policy', 'SOP', 'WorkInstruction', 'Method', 'MethodProtocol',
                                        'MethodReport', 'Form', 'Worksheet', 'ExternalDocument');
create type lims.document_status as enum ('Draft', 'InReview', 'Approved', 'Effective', 'Superseded', 'Retired',
                                          'Abandoned');

create function lims.document_type_code(p_type lims.document_type) returns text
language sql immutable as $$
  select case p_type
    when 'QualityManual' then 'QM' when 'Policy' then 'POL' when 'SOP' then 'SOP' when 'WorkInstruction' then 'WI'
    when 'Method' then 'MTH' when 'MethodProtocol' then 'MP' when 'MethodReport' then 'MR' when 'Form' then 'FRM'
    when 'Worksheet' then 'WS' when 'ExternalDocument' then 'EXT'
  end
$$;

create table lims.document (
  id            uuid               primary key default gen_random_uuid(),
  lab_id        uuid               not null references lims.lab,
  document_type lims.document_type not null,
  number        text               not null unique,
  created_at    timestamptz        not null default now(),
  unique (lab_id, id)
);

-- A Document's number is {Lab}-{Type}-{NNNN}, the next of its type in its Lab. Documents are never removed, so the
-- count of the Lab's Documents of that type, taken under the Lab chain's lock, never hands out a number twice.
create function lims.number_document() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  if new.lab_id is null or new.document_type is null then
    return new; -- their not-null constraints refuse it
  end if;
  perform lock_chain(new.lab_id::text);
  -- A Lab that does not exist leaves the code empty, and document_lab_id_fkey refuses the row.
  new.number := coalesce((select code from lab where lab_id = new.lab_id), '') || '-'
    || document_type_code(new.document_type) || '-'
    || lpad((select count(*) + 1 from document where lab_id = new.lab_id and document_type = new.document_type)::text,
            4, '0');
  return new;
end $$;

create trigger number_document before insert on lims.document
  for each row execute function lims.number_document();
create trigger capture after insert or update or delete on lims.document
  for each row execute function lims.capture();
create trigger refuse_change before update or delete on lims.document
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.document
  for each statement execute function lims.refuse_change();

create table lims.document_version (
  lab_id         uuid                 not null,
  id             uuid                 primary key default gen_random_uuid(),
  document_id    uuid                 not null,
  version        integer              not null check (version >= 1),
  status         lims.document_status not null default 'Draft',
  title          text                 not null check (btrim(title) <> ''),
  body           text                 not null,
  author_id      uuid                 not null references lims.person,
  effective_date date                 not null,
  abandon_reason text,
  saved_at       timestamptz          not null default now(),
  foreign key (lab_id, document_id) references lims.document (lab_id, id),
  unique (document_id, version),
  constraint document_version_abandon_reason_check
    check ((status = 'Abandoned') = (nullif(btrim(abandon_reason), '') is not null))
);

create unique index document_version_one_effective on lims.document_version (document_id) where status = 'Effective';
-- Approved waits for its Effective Date, so it is still open: a second Draft waits until it takes effect.
create unique index document_version_one_open on lims.document_version (document_id)
  where status in ('Draft', 'InReview', 'Approved');

-- Canonical form 1 of a Document version: what its Signatures cover, the Effective Date among it, because each Signature
-- approves what takes effect and when. Its status and abandon reason are left out, so that approval leaves the Authored
-- and Reviewed Signatures standing; the Audit Trail records each.
create function lims.document_version_content(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', v.id,
    'number', d.number,
    'documentType', d.document_type,
    'version', v.version,
    'title', v.title,
    'body', v.body,
    'effectiveDate', v.effective_date,
    'author', p.username)
  from lims.document_version v
  join lims.document d on d.id = v.document_id
  join lims.person p on p.id = v.author_id
  where v.id = p_id
$$;

-- The signers of a Document version with a Meaning, over its content as it is now: a Signature over content that has
-- since changed no longer counts.
create function lims.document_signers(p_id uuid, p_meaning lims.meaning) returns uuid[]
language sql stable as $$
  select coalesce(array_agg(s.person_id), '{}') from lims.signature s
    join lims.record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
   where v.record_table = 'document_version' and v.record_id = p_id and s.meaning = p_meaning
     and v.content_hash = sha256(convert_to(lims.document_version_content(p_id)::text, 'UTF8'))
$$;

-- A version opens as a Draft, the next of its Document, written by the person acting, who is its author and holds a
-- business role in the Document's Lab, with an Effective Date that has not passed in the Lab.
create function lims.open_document_version() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  if new.effective_date < (select (clock_timestamp() at time zone time_zone)::date from lab where lab_id = new.lab_id) then
    raise exception 'a Document version''s Effective Date is today or later in the Lab' using errcode = 'LA014';
  end if;
  if new.status <> 'Draft' then
    raise exception 'a Document version opens as a Draft, not %', new.status using errcode = 'LA014';
  end if;
  if new.version <> (select coalesce(max(version), 0) + 1 from document_version where document_id = new.document_id) then
    raise exception 'a Document version is the next version of its Document' using errcode = 'LA014';
  end if;
  -- With no actor, capture refuses the write as unaudited.
  if nullif(current_setting('lims.actor', true), '') is not null and exists (select from person where id = new.author_id
                and 'person:' || username is distinct from current_setting('lims.actor', true)) then
    raise exception 'a Document version''s author is the person who writes it' using errcode = 'LA014';
  end if;
  -- An author who is not recorded, or a Document of another Lab, is left to the foreign keys.
  if exists (select from person where id = new.author_id)
     and exists (select from document where id = new.document_id and lab_id = new.lab_id)
     and not exists (select from membership where lab_id = new.lab_id and person_id = new.author_id
                        and role in ('LabManager', 'Analyst', 'Reviewer', 'QA')) then
    raise exception 'a Document version''s author holds the Lab Manager, Analyst, Reviewer or QA role in its Lab'
      using errcode = 'LA014';
  end if;
  return new;
end $$;

-- A version moves Draft to In Review on its Authored Signature, In Review to Approved on its Reviewed and Approved
-- Signatures, each over its content as it is now, Approved to Effective once its Effective Date has come in the Lab's
-- zone, and Effective to Superseded when a later version is Effective or Approved with an Effective Date that has
-- come, which the API then makes Effective in the same transaction. An open version may be Abandoned, by its author
-- or a person who holds QA in its Lab, with a reason written then and never changed, an Approved one only before its
-- Effective Date: once the date has come it is the version that replaces the Effective one.
-- What the Signatures cover, the Effective Date among it, changes only while Draft, and the Effective Date is never
-- written in the past. A version whose Effective Date has passed is not Approved: its Signatures would approve a day
-- it did not take effect on.
create function lims.move_document_version() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  lab_today date;
begin
  select (clock_timestamp() at time zone time_zone)::date into lab_today from lab where lab_id = old.lab_id;
  if (new.lab_id, new.document_id, new.version, new.author_id, new.saved_at)
     is distinct from (old.lab_id, old.document_id, old.version, old.author_id, old.saved_at)
     or ((new.title, new.body, new.effective_date) is distinct from (old.title, old.body, old.effective_date)
         and not (old.status = 'Draft' and new.status = 'Draft')) then
    raise exception 'a Document version''s content changes only while it is a Draft' using errcode = 'LA014';
  end if;
  if new.effective_date is distinct from old.effective_date and new.effective_date < lab_today then
    raise exception 'a Document version''s Effective Date is today or later in the Lab' using errcode = 'LA014';
  end if;
  if new.abandon_reason is distinct from old.abandon_reason
     and not (old.status <> 'Abandoned' and new.status = 'Abandoned') then
    raise exception 'a Document version''s abandon reason is written once, as it is Abandoned' using errcode = 'LA014';
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not ((old.status = 'Draft' and new.status = 'InReview')
          or (old.status = 'InReview' and new.status = 'Approved')
          or (old.status = 'Approved' and new.status = 'Effective')
          or (old.status = 'Effective' and new.status = 'Superseded')
          or (old.status in ('Draft', 'InReview', 'Approved') and new.status = 'Abandoned')) then
    raise exception 'a Document version does not move from % to %', old.status, new.status using errcode = 'LA014';
  end if;
  if new.status = 'InReview' and cardinality(document_signers(new.id, 'Authored')) = 0 then
    raise exception 'a Document version goes In Review only on an Authored Signature over its content as it is now'
      using errcode = 'LA014';
  end if;
  if new.status = 'Approved' and (cardinality(document_signers(new.id, 'Reviewed')) = 0
                                  or cardinality(document_signers(new.id, 'Approved')) = 0) then
    raise exception 'a Document version is Approved only by Reviewed and Approved Signatures over its content as it is now'
      using errcode = 'LA014';
  end if;
  if new.status = 'Approved' and new.effective_date < lab_today then
    raise exception 'a Document version is not Approved after its Effective Date, %, has passed', new.effective_date
      using errcode = 'LA014';
  end if;
  if new.status = 'Effective' and new.effective_date > lab_today then
    raise exception 'a Document version takes effect on its Effective Date, %, not before', new.effective_date
      using errcode = 'LA014';
  end if;
  if new.status = 'Superseded' and not exists (
       select from document_version later where later.document_id = new.document_id and later.version > new.version
          and (later.status = 'Effective' or (later.status = 'Approved' and later.effective_date <= lab_today))) then
    raise exception 'a Document version is Superseded only by a later version whose Effective Date has come'
      using errcode = 'LA014';
  end if;
  if old.status = 'Approved' and new.status = 'Abandoned' and old.effective_date <= lab_today then
    raise exception 'a Document version Approved for an Effective Date that has come is not Abandoned'
      using errcode = 'LA014';
  end if;
  if new.status = 'Abandoned'
     and not exists (select from person where id = new.author_id
                        and 'person:' || username = current_setting('lims.actor', true))
     and not (current_setting('lims.role', true) = 'QA'
              and exists (select from membership m join person p on p.id = m.person_id
                           where m.lab_id = new.lab_id and m.role = 'QA'
                             and 'person:' || p.username = current_setting('lims.actor', true))) then
    raise exception 'a Document version is Abandoned by its author or QA' using errcode = 'LA014';
  end if;
  return new;
end $$;

create function lims.version_document() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform save_record_version(new.lab_id, 'document_version', new.id);
  return null;
end $$;

create trigger open_document_version before insert on lims.document_version
  for each row execute function lims.open_document_version();
create trigger move_document_version before update on lims.document_version
  for each row execute function lims.move_document_version();
create trigger capture after insert or update or delete on lims.document_version
  for each row execute function lims.capture();
create trigger version_record after insert or update on lims.document_version
  for each row execute function lims.version_document();
create trigger refuse_change before delete on lims.document_version
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.document_version
  for each statement execute function lims.refuse_change();

alter table lims.record_version
  drop constraint record_version_record_table_check,
  add constraint record_version_record_table_check
    check (record_table in ('test', 'test_report', 'system_incident', 'document_version'));

create or replace function lims.save_record_version(p_lab_id uuid, p_table text, p_record_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  bytes bytea;
  latest record_version;
begin
  bytes := convert_to((case p_table
    when 'test' then test_content(p_lab_id, p_record_id)
    when 'test_report' then test_report_content(p_lab_id, p_record_id)
    when 'system_incident' then incident_content(p_record_id)
    when 'document_version' then document_version_content(p_record_id)
  end)::text, 'UTF8');
  if bytes is null then return; end if;
  select * into latest from record_version
    where lab_id = p_lab_id and record_table = p_table and record_id = p_record_id
    order by version desc limit 1;
  if latest.content_hash = sha256(bytes) then return; end if;
  insert into record_version (lab_id, record_table, record_id, version, canonical_form, content)
    values (p_lab_id, p_table, p_record_id, coalesce(latest.version, 0) + 1, 1, bytes);
end $$;

select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Document versions are signed Authored by their author and Approved by QA', true);
insert into lims.signing_role (role, meaning) values
  ('LabManager', 'Authored'), ('Analyst', 'Authored'), ('Reviewer', 'Authored'), ('QA', 'Authored'), ('QA', 'Approved');

-- Authored is a Signature Meaning of a Document version only, and QA signs Approved only on one; another record kind
-- may be signed Approved in another role. A Document version is signed Authored, Reviewed or Approved, each by a
-- different person: Authored once, by its author in a business role, on the Draft; Reviewed In Review, after
-- Authored, in the Reviewer role, by someone who did not author it; Approved once, In Review, after a Reviewed, in
-- the QA role, by someone who neither authored nor reviewed it. lims.sign checks the signer, the proof, the role they
-- hold and the version shown; this checks who may sign what.
create function lims.check_document_signing() returns trigger
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  signed  record_version;
  doc     document_version;
  authors uuid[];
  reviews uuid[];
begin
  select * into signed from record_version where lab_id = new.lab_id and id = new.record_version_id;
  if signed.id is null then
    return new; -- signature_record_version_fkey refuses it
  end if;
  if signed.record_table <> 'document_version' then
    if new.meaning = 'Authored' then
      raise exception 'Authored is a Signature Meaning of a Document version only' using errcode = 'LA010';
    end if;
    if new.meaning = 'Approved' and new.role = 'QA' then
      raise exception 'QA signs Approved only on a Document version' using errcode = 'LA010';
    end if;
    return new;
  end if;
  if new.meaning not in ('Authored', 'Reviewed', 'Approved') then
    raise exception 'a Document version is signed Authored, Reviewed or Approved, not %', new.meaning
      using errcode = 'LA010';
  end if;
  if new.meaning = 'Authored' and new.role not in ('LabManager', 'Analyst', 'Reviewer', 'QA') then
    raise exception 'a Document version is signed Authored in the Lab Manager, Analyst, Reviewer or QA role, not %',
      new.role using errcode = 'LA010';
  end if;
  if new.meaning = 'Reviewed' and new.role <> 'Reviewer' then
    raise exception 'a Document version is signed Reviewed in the Reviewer role, not %', new.role using errcode = 'LA010';
  end if;
  if new.meaning = 'Approved' and new.role <> 'QA' then
    raise exception 'a Document version is signed Approved in the QA role, not %', new.role using errcode = 'LA010';
  end if;
  select * into doc from document_version where id = signed.record_id;
  authors := document_signers(doc.id, 'Authored');
  reviews := document_signers(doc.id, 'Reviewed');
  if new.meaning = 'Authored' then
    if doc.status <> 'Draft' or cardinality(authors) > 0 then
      raise exception 'a Document version is signed Authored once, while a Draft' using errcode = 'LA010';
    end if;
    if new.person_id <> doc.author_id then
      raise exception 'a Document version is signed Authored only by its author' using errcode = 'LA010';
    end if;
  elsif new.meaning = 'Reviewed' then
    if doc.status <> 'InReview' then
      raise exception 'a Document version is signed Reviewed while In Review, not %', doc.status using errcode = 'LA010';
    end if;
    if new.person_id = any(authors) or new.person_id = any(reviews) then
      raise exception 'a Document version is signed Reviewed by someone who has not authored or reviewed it'
        using errcode = 'LA010';
    end if;
  else
    if doc.status <> 'InReview' or cardinality(reviews) = 0
       or cardinality(document_signers(doc.id, 'Approved')) > 0 then
      raise exception 'a Document version is signed Approved once, while In Review, after a Reviewed Signature'
        using errcode = 'LA010';
    end if;
    if new.person_id = any(authors) or new.person_id = any(reviews) then
      raise exception 'a Document version is signed Approved by someone who has not authored or reviewed it'
        using errcode = 'LA010';
    end if;
  end if;
  return new;
end $$;

create trigger document_signing before insert on lims.signature
  for each row execute function lims.check_document_signing();

revoke execute on function lims.document_type_code(lims.document_type), lims.document_version_content(uuid),
  lims.document_signers(uuid, lims.meaning) from public;
grant select on lims.document, lims.document_version to lims_app;
grant insert (lab_id, document_type) on lims.document to lims_app;
grant insert (lab_id, document_id, version, title, body, author_id, effective_date) on lims.document_version to lims_app;
grant update (status, abandon_reason) on lims.document_version to lims_app;

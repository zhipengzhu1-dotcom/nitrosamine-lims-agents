set local role lims_owner;

alter type lims.role add value 'PlatformOperator';
alter type lims.access_event_kind add value 'PasswordSet';
alter type lims.sign_in_failure add value 'NoCredential';

-- Who checked a person's identity, what they checked, and when, recorded before the account's first credential.
-- A company record: the Lab whose Admin checked is in a column not named lab_id, so lims.capture() keeps it on the
-- company chain.
create table lims.identity_verification (
  id                uuid        primary key default gen_random_uuid(),
  printed_name      text        not null check (btrim(printed_name) <> ''),
  evidence          text        not null check (btrim(evidence) <> ''),
  checked_by        uuid        not null references lims.person,
  checked_in_lab_id uuid        not null references lims.lab,
  checked_at        timestamptz not null default clock_timestamp()
);

-- The checker is the Admin of that Lab whose audited transaction records the check, so no one records a check in
-- another's name.
create function lims.checked_by_the_acting_admin() returns trigger language plpgsql as $$
begin
  -- capture refuses a write with no actor, and the foreign keys a checker or Lab that does not exist
  if nullif(current_setting('lims.actor', true), '') is null
     or not exists (select from lims.person where id = new.checked_by)
     or not exists (select from lims.lab where lab_id = new.checked_in_lab_id) then
    return new;
  end if;
  if not exists (select from lims.person p
                  where p.id = new.checked_by
                    and 'person:' || p.username = current_setting('lims.actor', true)
                    and exists (select from lims.membership m
                                 where m.person_id = p.id and m.lab_id = new.checked_in_lab_id and m.role = 'Admin')) then
    raise exception 'an Identity Verification is recorded by the Admin who checked' using errcode = 'LA007';
  end if;
  return new;
end $$;
create trigger checked_by_the_acting_admin before insert on lims.identity_verification
  for each row execute function lims.checked_by_the_acting_admin();

-- An account created after this migration names its Identity Verification; the seeded demo accounts have none
-- under ADR 0002's demo-login exception.
alter table lims.person
  alter column password_hash drop not null,
  add column identity_verification_id uuid unique references lims.identity_verification;

create function lims.keep_identity() returns trigger language plpgsql as $$
begin
  if new.username is distinct from old.username then
    raise exception 'a username is never changed' using errcode = 'LA002';
  end if;
  if new.identity_verification_id is distinct from old.identity_verification_id then
    raise exception 'a person''s Identity Verification is never changed' using errcode = 'LA002';
  end if;
  return new;
end $$;
create trigger keep_identity before update on lims.person
  for each row execute function lims.keep_identity();

-- Admin and Platform Operator are held apart from every business role, per person across all Labs. The person row
-- lock serialises two grants to one person, so two Labs cannot each grant one side at once.
create function lims.keep_administration_apart() returns trigger language plpgsql as $$
declare
  administrative constant text[] := array['Admin', 'PlatformOperator'];
begin
  perform from lims.person where id = new.person_id for update;
  if exists (select from lims.membership m
              where m.person_id = new.person_id
                and (m.role::text = any (administrative)) <> (new.role::text = any (administrative))) then
    raise exception 'a person who holds Admin or Platform Operator holds no business role, in any Lab'
      using errcode = 'LA008';
  end if;
  return new;
end $$;
create trigger keep_administration_apart before insert or update on lims.membership
  for each row execute function lims.keep_administration_apart();

-- A one-time link through which a person sets their own first password; only the token's hash is kept.
create table lims.credential_link (
  id         uuid        primary key default gen_random_uuid(),
  person_id  uuid        not null references lims.person,
  token_hash bytea       not null unique check (octet_length(token_hash) = 32),
  issued_at  timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '72 hours',
  used_at    timestamptz,
  constraint credential_link_expiry_check check (expires_at > issued_at),
  constraint credential_link_use_check check (used_at is null or used_at between issued_at and expires_at)
);

create function lims.link_needs_identity_verification() returns trigger language plpgsql as $$
begin
  if exists (select from lims.person where id = new.person_id and identity_verification_id is null) then
    raise exception 'a one-time link goes only to an account with an Identity Verification' using errcode = 'LA007';
  end if;
  return new;
end $$;
create trigger link_needs_identity_verification before insert on lims.credential_link
  for each row execute function lims.link_needs_identity_verification();

create function lims.use_link_once() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.used_at is not null
     or (to_jsonb(new) - 'used_at') <> (to_jsonb(old) - 'used_at') then
    raise exception 'a one-time link is only ever marked used, once' using errcode = 'LA002';
  end if;
  return coalesce(new, old);
end $$;
create trigger use_link_once before update or delete on lims.credential_link
  for each row execute function lims.use_link_once();
create trigger refuse_truncate before truncate on lims.credential_link
  for each statement execute function lims.refuse_change();

-- The only way a password reaches an existing account: the link is marked used and the password set in one
-- statement's transaction, so a link sets at most one password. Returns the person, or null for a link that is
-- unknown, used or expired.
create function lims.set_password_through_link(link_token_hash bytea, new_password_hash text) returns uuid
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  who uuid;
begin
  update lims.credential_link set used_at = clock_timestamp()
   where token_hash = link_token_hash and used_at is null and clock_timestamp() < expires_at
  returning person_id into who;
  if who is not null then
    update lims.person set password_hash = new_password_hash where id = who;
  end if;
  return who;
end $$;

-- A Signature keeps the printed name and username its signer had at signing, so a later rename leaves it as signed.
alter table lims.signature add column printed_name text, add column username text;

create function lims.sign_as_the_person() returns trigger language plpgsql as $$
begin
  -- for a person who does not exist both stay null, and not null refuses the row
  select display_name, username into new.printed_name, new.username from lims.person where id = new.person_id;
  return new;
end $$;
create trigger sign_as_the_person before insert on lims.signature
  for each row execute function lims.sign_as_the_person();

-- The thin slice's Signatures take their signer's printed name and username as they stand now, the nearest record
-- of the name as signed: no printed name has changed through the LIMS before this migration.
select set_config('lims.actor', 'svc:migrate', true), set_config('lims.role', 'system', true),
       set_config('lims.reason', 'Keep each Signature''s printed name and username as signed', true);
do $$ begin
  if exists (select from lims.lab) then
    perform lims.lock_chains(variadic (select array_agg(lab_id::text) from lims.lab));
  end if;
end $$;
alter table lims.signature disable trigger refuse_change;
update lims.signature s set printed_name = p.display_name, username = p.username
  from lims.person p where p.id = s.person_id;
alter table lims.signature enable trigger refuse_change;
alter table lims.signature alter column printed_name set not null, alter column username set not null;

do $$
declare
  t text;
begin
  foreach t in array array['identity_verification', 'credential_link'] loop
    execute format('create trigger capture after insert or update or delete on lims.%I
                    for each row execute function lims.capture()', t);
  end loop;
end $$;
create trigger refuse_change before update or delete on lims.identity_verification
  for each row execute function lims.refuse_change();
create trigger refuse_truncate before truncate on lims.identity_verification
  for each statement execute function lims.refuse_change();

grant select on lims.identity_verification, lims.credential_link to lims_app;
grant insert (printed_name, evidence, checked_by, checked_in_lab_id) on lims.identity_verification to lims_app;
grant insert (person_id, token_hash) on lims.credential_link to lims_app;
revoke update on lims.person from lims_app;
grant update (display_name, failed_logins, locked_at) on lims.person to lims_app;
grant execute on function lims.set_password_through_link(bytea, text) to lims_app;

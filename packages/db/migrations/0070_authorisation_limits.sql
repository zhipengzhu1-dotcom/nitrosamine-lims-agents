-- Decision 19: an Authorisation is valid for 12 months; a renewal is a new Authorisation through a
-- Competence Assessment. valid_until is exclusive, so a year from valid_from is the longest.
alter table lims.authorisation add constraint authorisation_at_most_12_months
  check (valid_until <= (valid_from + interval '12 months')::date);

-- iso 6: the Lab Manager directs the Lab's work, so never releases it. Roles are granted only when
-- a person is created, before any Authorisation, so checking the Authorisation side is enough.
create function lims.no_released_for_lab_manager() returns trigger
language plpgsql as $$
begin
  if new.meaning = 'Released' and exists (
    select 1 from lims.role_grant g
     where g.person_id = new.person_id and g.role = 'LabManager' and g.lab_id = new.lab_id and g.revoked_at is null
  ) then
    raise exception 'a Released Authorisation for the Lab Manager of the same Lab' using errcode = 'LI002';
  end if;
  return new;
end $$;
create trigger no_released_for_lab_manager before insert on lims.authorisation
  for each row execute function lims.no_released_for_lab_manager();

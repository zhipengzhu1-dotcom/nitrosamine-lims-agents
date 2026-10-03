set local role lims_owner;

-- The stamping triggers of 0029 fill each kept zone from the Lab, but a trigger can be bypassed, so the columns hold
-- only what the Lab's own time_zone may hold: a named zone of the time zone database (#279). Every row the 0029
-- backfill and the triggers wrote passes, so the checks are validated over them.
alter table lims.signature add constraint signature_signed_time_zone_check
  check (lims.is_time_zone(signed_time_zone));
-- lims.is_time_zone(null) is false, not null, so a Sample with no Received passes only through the null arm.
alter table lims.sample add constraint sample_received_time_zone_check
  check (received_time_zone is null or lims.is_time_zone(received_time_zone));
-- A Received with no zone would read on whatever zone its Lab holds later, and a zone with no Received keeps nothing.
alter table lims.sample add constraint sample_received_time_zone_received_at_check
  check ((received_time_zone is null) = (received_at is null));

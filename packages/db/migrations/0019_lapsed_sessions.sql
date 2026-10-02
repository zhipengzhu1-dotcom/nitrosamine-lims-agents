set local role lims_owner;

-- A person's lock lands once, at the database clock, and stands: lims_app may set it but neither choose its instant
-- nor move or clear it, because a session's end and its Lockout Access Event are stamped from it. An account unlock
-- (#101) must end the person's lapsed sessions before it clears the lock, or they would come back to life.
create function lims.lock_once() returns trigger
language plpgsql as $$
begin
  if old.locked_at is not null then
    raise exception 'a lockout stands; it cannot be moved or cleared' using errcode = '23514';
  end if;
  new.locked_at := clock_timestamp();
  return new;
end $$;

create trigger lock_once before update of locked_at on lims.person
  for each row when (new.locked_at is distinct from old.locked_at) execute function lims.lock_once();

-- A Lockout Access Event is stamped at the instant the lock landed on the person, the same instant the person's
-- sessions end at below, and only a locked person can have one.
create function lims.stamp_lockout() returns trigger
language plpgsql as $$
begin
  select p.locked_at into new.at from lims.person p where p.id = new.subject_id;
  if new.at is null then
    raise exception 'a Lockout Access Event needs its person locked' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger stamp_lockout before insert on lims.access_event
  for each row when (new.kind = 'Lockout') execute function lims.stamp_lockout();

-- The instant a session stopped being able to serve a request: its person's lock if that came first, else the idle
-- limit after its last request or the absolute limit after sign-in, whichever is sooner.
create function lims.session_lapse(last_seen_at timestamptz, created_at timestamptz, locked_at timestamptz,
                                   idle interval, absolute interval)
returns timestamptz
language sql stable as $$
  select case when locked_at < lims.session_end(last_seen_at, created_at, idle, absolute) then locked_at
              else lims.session_end(last_seen_at, created_at, idle, absolute) end
$$;

-- Ends sessions whose lapse has passed, each at its lapse. A session ended by its person's lock carries the
-- Lockout's instant, which the Lockout Access Event records; any other ends at its idle or absolute end with its expiry
-- Access Event stamped there, not at the time it was noticed. Null ids end every such session (the sweep); ids end
-- that one session if it is one (a request that found it). Only a session not yet ended is ended, so a second call,
-- or one racing the sweep or a sign-out, writes nothing more. The company chain is locked before any session row, the
-- order sign-in and takeover already take, so a sweep and a request cannot wait on each other in a cycle. Security
-- definer because lims_app may neither end a session at a chosen instant nor choose an Access Event's time; the
-- caller sets the audit context.
create function lims.end_lapsed_sessions(idle interval, absolute interval, p_lab_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform check_session_limits(idle, absolute);
  if not exists (
    select from session s join person p on p.id = s.person_id
     where s.ended_at is null
       and (p_id is null or (s.lab_id = p_lab_id and s.id = p_id))
       and session_lapse(s.last_seen_at, s.created_at, p.locked_at, idle, absolute) <= clock_timestamp()
  ) then
    return;
  end if;
  perform lock_chain('company');
  with lapsed as (
    update session s
       set ended_at = session_lapse(s.last_seen_at, s.created_at, p.locked_at, idle, absolute)
      from person p
     where p.id = s.person_id
       and s.ended_at is null
       and (p_id is null or (s.lab_id = p_lab_id and s.id = p_id))
       and session_lapse(s.last_seen_at, s.created_at, p.locked_at, idle, absolute) <= clock_timestamp()
    returning s.lab_id, s.id, s.person_id, s.workstation_id, s.ended_at,
              case when p.locked_at < session_end(s.last_seen_at, s.created_at, idle, absolute) then null
                   when s.last_seen_at + idle <= s.created_at + absolute then 'IdleExpiry'
                   else 'AbsoluteExpiry' end as kind
  )
  insert into access_event (kind, subject_id, session_lab_id, session_id, workstation_id, roles, at)
  select l.kind::access_event_kind, l.person_id, l.lab_id, l.id, l.workstation_id,
         array(select m.role from membership m where m.lab_id = l.lab_id and m.person_id = l.person_id order by m.role),
         l.ended_at
    from lapsed l
   where l.kind is not null;
end $$;

-- Counts a request as activity on a session that has not lapsed, as 0010's did, now also refusing one whose person is
-- locked, so a request that read the session just before a Lockout committed cannot move it past the Lockout.
create or replace function lims.touch_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval) returns integer
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  left_ms integer;
begin
  perform check_session_limits(idle, absolute);
  update session s
     set last_seen_at = now()
    from person p
   where p.id = s.person_id and p.locked_at is null
     and s.lab_id = p_lab_id and s.id = p_id and s.ended_at is null
     and session_end(s.last_seen_at, s.created_at, idle, absolute) > now()
  returning (extract(epoch from s.created_at + absolute - now()) * 1000)::integer into left_ms;
  return left_ms;
end $$;

-- Ends a session at now() and says so, unless it has lapsed: then it ends at its lapse, as above, and the answer is
-- false. So a sign-out, takeover or Lab switch that finds its session lapsed records the lapse, never a silent end.
create or replace function lims.end_session(p_lab_id uuid, p_id uuid, idle interval, absolute interval) returns boolean
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform end_lapsed_sessions(idle, absolute, p_lab_id, p_id);
  update session s
     set ended_at = now()
   where s.lab_id = p_lab_id and s.id = p_id and s.ended_at is null
     and session_end(s.last_seen_at, s.created_at, idle, absolute) > now();
  return found;
end $$;

drop function lims.end_expired_sessions(interval, interval);

grant execute on function lims.session_lapse(timestamptz, timestamptz, timestamptz, interval, interval) to lims_app;
grant execute on function lims.end_lapsed_sessions(interval, interval, uuid, uuid) to lims_app;

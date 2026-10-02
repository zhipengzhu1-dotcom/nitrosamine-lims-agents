set local role lims_owner;

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

-- Ends sessions that can no longer serve a request, each at the instant it stopped being able to. A session whose
-- person was locked out before its end ends at the Lockout's instant, which the Lockout Access Event records. Any
-- other session past its idle or absolute end ends at that end, with its expiry Access Event stamped there, not at the
-- time it was noticed. Null ids end every such session (the sweep); ids end that one session if it is one (a request
-- that found it). Only a session not yet ended is ended, so a second call, or one racing the sweep or a sign-out,
-- writes nothing more. Security definer because lims_app may neither end a session at a chosen instant nor choose an
-- Access Event's time; the caller sets the audit context.
create function lims.end_lapsed_sessions(idle interval, absolute interval, p_lab_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = lims, pg_temp as $$
begin
  perform check_session_limits(idle, absolute);
  with lapsed as (
    update session s
       set ended_at = case when p.locked_at < session_end(s.last_seen_at, s.created_at, idle, absolute)
                           then p.locked_at
                           else session_end(s.last_seen_at, s.created_at, idle, absolute) end
      from person p
     where p.id = s.person_id
       and s.ended_at is null
       and (p_id is null or (s.lab_id = p_lab_id and s.id = p_id))
       and (p.locked_at is not null
            or session_end(s.last_seen_at, s.created_at, idle, absolute) <= clock_timestamp())
    returning s.lab_id, s.id, s.person_id, s.workstation_id, s.ended_at,
              case when s.ended_at is not distinct from p.locked_at then null
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

grant execute on function lims.end_lapsed_sessions(interval, interval, uuid, uuid) to lims_app;

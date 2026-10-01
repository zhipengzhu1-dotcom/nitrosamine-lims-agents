set local role lims_owner;

alter type lims.access_event_kind add value 'IdleExpiry';
alter type lims.access_event_kind add value 'AbsoluteExpiry';

-- A new enum value cannot be used in the transaction that adds it, so these checks compare the kind as text.
-- An expiry is written by the sweep, with no request and so no source address; every other kind has one.
alter table lims.access_event
  alter column source_address drop not null,
  add constraint access_event_source_address_check
    check ((source_address is null) = (kind::text in ('IdleExpiry', 'AbsoluteExpiry'))),
  drop constraint access_event_session_kind_check,
  add constraint access_event_session_kind_check check (
    (session_id is not null or kind::text not in ('SignInSucceeded', 'SignOut', 'IdleExpiry', 'AbsoluteExpiry'))
    and (session_id is null or kind <> 'SignInFailed')
  );

-- The instant a session ends unless a request arrives first: the idle limit after its last request, or the absolute
-- limit after sign-in, whichever comes sooner.
create function lims.session_end(last_seen_at timestamptz, created_at timestamptz, idle interval, absolute interval)
returns timestamptz
language sql stable as $$
  select least(last_seen_at + idle, created_at + absolute)
$$;

-- Ends every session past its end and writes its expiry Access Event at that end, not at the time the sweep runs.
-- Only a session not yet ended is ended, so a second sweep, or one racing a sign-out, writes nothing more.
-- Security definer because lims_app may not choose an Access Event's time; the caller sets the audit context.
create function lims.end_expired_sessions(idle interval, absolute interval) returns integer
language plpgsql security definer set search_path = lims, pg_temp as $$
declare
  ended integer;
begin
  with expired as (
    update session s
       set ended_at = session_end(s.last_seen_at, s.created_at, idle, absolute)
     where s.ended_at is null
       and session_end(s.last_seen_at, s.created_at, idle, absolute) <= clock_timestamp()
    returning s.lab_id, s.id, s.person_id, s.ended_at,
              case when s.last_seen_at + idle <= s.created_at + absolute then 'IdleExpiry'
                   else 'AbsoluteExpiry' end as kind
  )
  insert into access_event (kind, subject_id, session_lab_id, session_id, roles, at)
  select e.kind::access_event_kind, e.person_id, e.lab_id, e.id,
         array(select m.role from membership m where m.lab_id = e.lab_id and m.person_id = e.person_id order by m.role),
         e.ended_at
    from expired e;
  get diagnostics ended = row_count;
  return ended;
end $$;

grant execute on function lims.session_end(timestamptz, timestamptz, interval, interval) to lims_app;
grant execute on function lims.end_expired_sessions(interval, interval) to lims_app;

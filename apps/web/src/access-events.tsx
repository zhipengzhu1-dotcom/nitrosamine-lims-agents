import {
  type ActorContext,
  type EndedSession,
  type ListedAccessEvent,
  type PersonAccessEvents,
  routes,
} from '@lims/domain';
import { useApi } from './api.ts';
import { Shell, words } from './rail.tsx';
import { type Column, StackTable } from './stack.tsx';
import { time } from './time.tsx';

function EndedSessions({ sessions }: { sessions: readonly EndedSession[] | null }) {
  if (sessions === null)
    return (
      <span className="muted">
        This Lockout was recorded before the LIMS ended sessions at a Lockout&apos;s instant, so the record does not say
        which sessions in this Lab it ended.
      </span>
    );
  if (sessions.length === 0) return <span>Ended no session in this Lab.</span>;
  return (
    <div>
      Ended {sessions.length === 1 ? 'this session' : `these ${sessions.length} sessions`} at the Lockout:
      <ul className="ended">
        {sessions.map((s) => (
          <li key={s.id}>
            Signed in {time(s.signedInAt)}
            {s.workstation ? ` on ${s.workstation}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

const columns: Column<ListedAccessEvent>[] = [
  { head: 'When', cell: (e) => time(e.at) },
  { head: 'Access Event', label: 'Event', cell: (e) => words(e.kind) },
  {
    head: 'Detail',
    cell: (e) =>
      e.kind === 'Lockout' ? <EndedSessions sessions={e.endedSessions} /> : e.failureReason && words(e.failureReason),
  },
  { head: 'Workstation', cell: (e) => e.workstation },
  { head: 'Source address', label: 'Address', cell: (e) => e.sourceAddress },
];
const noEvents: ListedAccessEvent[] = [];

/** A person's newest Access Events, or those before the Access Event `before`, each page as the server read it. */
export function AccessEventsPage({ me, id, before }: { me: ActorContext; id: string; before: string | null }) {
  return before === null ? <Newest me={me} id={id} /> : <Earlier me={me} id={id} before={before} />;
}

const Newest = ({ me, id }: { me: ActorContext; id: string }) => (
  <AccessEvents me={me} id={id} earlierPage={false} read={useApi(routes.accessEvents, { id })} />
);

const Earlier = ({ me, id, before }: { me: ActorContext; id: string; before: string }) => (
  <AccessEvents me={me} id={id} earlierPage read={useApi(routes.earlierAccessEvents, { id, before })} />
);

function AccessEvents({
  me,
  id,
  earlierPage,
  read: { data, error },
}: {
  me: ActorContext;
  id: string;
  earlierPage: boolean;
  read: { data?: PersonAccessEvents; error?: string };
}) {
  const list = `#/staff/${encodeURIComponent(id)}/access-events`;
  return (
    <Shell me={me} active="staff" action={null}>
      <h1>Access Events{data && ` of ${data.person.printedName}`}</h1>
      <p>
        <a className="tap" href="#/staff">
          Staff accounts
        </a>
      </p>
      {earlierPage && (
        <p>
          <a className="tap" href={list}>
            Newest Access Events
          </a>
        </p>
      )}
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <p className="muted">
          {earlierPage ? 'Earlier ones, newest first' : 'Newest first'}, those of {me.lab.name} and those of no session.
          A Lockout lists the sessions here that it ended, where the record says which.
        </p>
      )}
      <StackTable columns={columns} rows={data?.events ?? noEvents} rowKey={(e) => e.id} />
      {data?.earlier && (
        <p>
          <a className="tap" href={`${list}?before=${encodeURIComponent(data.earlier)}`}>
            Earlier Access Events
          </a>
        </p>
      )}
    </Shell>
  );
}

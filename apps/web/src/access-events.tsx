import { type ActorContext, type EndedSession, type ListedAccessEvent, routes } from '@lims/domain';
import { useApi } from './api.ts';
import { Shell, words } from './rail.tsx';
import { type Column, StackTable } from './stack.tsx';
import { time } from './time.ts';

function EndedSessions({ sessions }: { sessions: readonly EndedSession[] }) {
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

export function AccessEventsPage({ me, id }: { me: ActorContext; id: string }) {
  const { data, error } = useApi(routes.accessEvents, { id });
  return (
    <Shell me={me} active="staff" action={null}>
      <h1>Access Events{data && ` of ${data.person.printedName}`}</h1>
      <p>
        <a className="tap" href="#/staff">
          Staff accounts
        </a>
      </p>
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <p className="muted">
          Newest first, those of {me.lab.name} and those of no session. A Lockout lists the sessions here that it ended.
          {data.earlierNotListed && ' Earlier Access Events are not listed.'}
        </p>
      )}
      <StackTable columns={columns} rows={data?.events ?? noEvents} rowKey={(e) => e.id} />
    </Shell>
  );
}

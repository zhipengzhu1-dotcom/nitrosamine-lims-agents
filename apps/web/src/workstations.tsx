import { type ActorContext, routes, type Workstation } from '@lims/domain';
import { useState } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { type RailAction, Shell } from './rail.tsx';

const reason = { name: 'reason', label: 'Reason', kind: 'text' } as const;

function registration(onDone: () => Promise<void>): RailAction {
  return {
    label: 'Register Workstation',
    context: 'A bench PC of this Lab, with its Room and browser policy',
    fields: [
      { name: 'name', label: 'Workstation name', kind: 'text' },
      { name: 'roomId', label: 'Room', kind: 'room' },
      { name: 'browserPolicy', label: 'Browser policy', kind: 'text' },
      reason,
    ],
    signs: null,
    async run(input) {
      const { name = '', roomId = '', browserPolicy = '', reason = '' } = input;
      const registered = await api(routes.registerWorkstation, { name, roomId, browserPolicy, reason });
      await onDone();
      return `Workstation ${registered.name} registered in the Audit Trail. Enrol its browser on the bench PC.`;
    },
  };
}

function roomRegistration(onDone: () => Promise<void>): RailAction {
  return {
    label: 'Register Room',
    context: 'A Room of this Lab where Workstations stand',
    fields: [{ name: 'name', label: 'Room name', kind: 'text' }, reason],
    signs: null,
    async run(input) {
      const room = await api(routes.registerRoom, { name: input.name ?? '', reason: input.reason ?? '' });
      await onDone();
      return `Room ${room.name} registered in the Audit Trail.`;
    },
  };
}

function enrolment(workstation: Workstation, onDone: () => Promise<void>): RailAction {
  return {
    label: 'Enrol this browser',
    context: `This browser becomes Workstation ${workstation.name} in ${workstation.room}`,
    fields: [reason],
    signs: null,
    async run(input) {
      await api(routes.enrolWorkstation, { workstationId: workstation.id, reason: input.reason ?? '' });
      await onDone();
      return `This browser is enrolled as ${workstation.name}. Every sign-in on it from now on carries the Workstation.`;
    },
  };
}

export function WorkstationsPage({ me }: { me: ActorContext }) {
  const { data, error, reload } = useApi(routes.workstations);
  const [chosen, setChosen] = useState<Workstation | 'room' | null>(null);
  const fresh = useFresh(data, (d) => d.workstations.map((w) => `${w.id}:${w.enrolled}`));
  const done = async () => {
    await reload();
    setChosen(null);
  };
  const pick = () => {
    if (chosen === 'room') return roomRegistration(done);
    return chosen ? enrolment(chosen, done) : registration(reload);
  };
  const action = data ? pick() : null;
  const isChosen = (w: Workstation) => typeof chosen === 'object' && chosen?.id === w.id;
  return (
    <Shell me={me} active="workstations" action={action}>
      <h1>Workstations</h1>
      {data && (
        <p className="muted">
          {data.thisBrowser ? (
            <>
              This browser is enrolled as{' '}
              <b>
                Workstation {data.thisBrowser.name} in {data.thisBrowser.room}
              </b>
              {me.workstation?.name === data.thisBrowser.name
                ? '.'
                : '; the next sign-in on it carries the Workstation.'}
            </>
          ) : (
            <>
              This browser is <b>not enrolled</b>; it signs in as an unregistered device.
            </>
          )}
        </p>
      )}
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <p>
          <button
            type="button"
            className="btn"
            aria-pressed={chosen === 'room'}
            onClick={() => setChosen(chosen === 'room' ? null : 'room')}
          >
            {chosen === 'room' ? 'Register a Workstation instead' : 'Register a Room'}
          </button>
        </p>
      )}
      {data && (
        <table className="stack">
          <thead>
            <tr>
              <th>Workstation</th>
              <th>Room</th>
              <th>Browser policy</th>
              <th>Browser</th>
              <th>Enrol</th>
            </tr>
          </thead>
          <tbody>
            {data.workstations.map((w) => (
              <tr key={w.id} className={fresh.has(`${w.id}:${w.enrolled}`) ? 'row--fresh' : undefined}>
                <td data-label="Workstation">{w.name}</td>
                <td data-label="Room">{w.room}</td>
                <td data-label="Policy">{w.browserPolicy}</td>
                <td data-label="Browser">{w.enrolled ? 'Enrolled' : 'Not enrolled'}</td>
                <td data-label="">
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={isChosen(w)}
                    onClick={() => setChosen(isChosen(w) ? null : w)}
                  >
                    {isChosen(w) ? 'Chosen to enrol' : 'Choose to enrol'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.workstations.length === 0 && <p className="muted">No Workstations registered yet.</p>}
    </Shell>
  );
}

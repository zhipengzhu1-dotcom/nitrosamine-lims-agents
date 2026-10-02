import type { ActorContext } from '@lims/domain';
import { AccessEventsPage } from './access-events.tsx';
import { type Module, Shell } from './rail.tsx';
import { StaffPage } from './staff.tsx';
import { WorkstationsPage } from './workstations.tsx';

export function Placeholder({ me, module, of }: { me: ActorContext; module: Module; of: string | null }) {
  if (module.key === 'workstations') return <WorkstationsPage me={me} />;
  if (module.key === 'staff') return of ? <AccessEventsPage me={me} id={of} /> : <StaffPage me={me} />;
  return (
    <Shell me={me} active={module.key} action={null}>
      <h1>{module.name}</h1>
      <p>{module.holds}</p>
      <p className="muted">Not built in the thin slice.</p>
    </Shell>
  );
}

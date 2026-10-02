import type { ActorContext } from '@lims/domain';
import { type Module, Shell } from './rail.tsx';
import { StaffPage } from './staff.tsx';
import { WorkstationsPage } from './workstations.tsx';

export function Placeholder({ me, module }: { me: ActorContext; module: Module }) {
  if (module.key === 'workstations') return <WorkstationsPage me={me} />;
  if (module.key === 'staff') return <StaffPage me={me} />;
  return (
    <Shell me={me} active={module.key} action={null}>
      <h1>{module.name}</h1>
      <p>{module.holds}</p>
      <p className="muted">Not built in the thin slice.</p>
    </Shell>
  );
}

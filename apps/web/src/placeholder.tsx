import type { ActorContext } from '@lims/domain';
import { AccessEventsPage } from './access-events.tsx';
import { IncidentsPage } from './incidents.tsx';
import { type Module, Shell } from './rail.tsx';
import { StaffPage } from './staff.tsx';
import { WorkstationsPage } from './workstations.tsx';

/**
 * The page of a nav module: a built one, or the placeholder that names what the module will hold. `open` is the record
 * beside it, and `before` the Access Event whose earlier ones the Staff module lists.
 */
export function Placeholder({
  me,
  module,
  open,
  before,
}: {
  me: ActorContext;
  module: Module;
  open: string | null;
  before: string | null;
}) {
  if (module.key === 'workstations') return <WorkstationsPage me={me} />;
  if (module.key === 'incidents') return <IncidentsPage me={me} open={open} />;
  if (module.key === 'staff')
    return open ? <AccessEventsPage me={me} id={open} before={before} /> : <StaffPage me={me} />;
  return (
    <Shell me={me} active={module.key} action={null}>
      <h1>{module.name}</h1>
      <p>{module.holds}</p>
      <p className="muted">Not built in the thin slice.</p>
    </Shell>
  );
}

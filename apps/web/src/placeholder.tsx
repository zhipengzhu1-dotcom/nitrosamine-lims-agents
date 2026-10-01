import type { ActorContext } from '@lims/domain';
import { type Module, Shell } from './rail.tsx';

export function Placeholder({ me, module }: { me: ActorContext; module: Module }) {
  return (
    <Shell me={me} active={module.key} action={null}>
      <h1>{module.name}</h1>
      <p>{module.holds}</p>
      <p className="muted">Not built in the thin slice.</p>
    </Shell>
  );
}

import type { Me } from './api.ts';
import { type ModuleKey, modules, Shell } from './rail.tsx';

export function Placeholder({ me, module }: { me: Me; module: Exclude<ModuleKey, 'tests'> }) {
  const m = modules.find((x) => x.key === module)!;
  return (
    <Shell me={me} active={module} action={null}>
      <h1>{m.name}</h1>
      <p>{m.holds}</p>
      <p className="muted">Not built in the thin slice.</p>
    </Shell>
  );
}

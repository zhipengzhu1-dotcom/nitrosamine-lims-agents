// Everything the sample chain plugs into the API core: its kinds, commands and views. main.ts
// and the seed build the app with these; the core's own tests build it without them.

import type { AnyCommandDef, AnyViewDef } from '../doors.ts';
import { chainCommands } from '../commands/chain.ts';
import { referenceCommands } from '../commands/reference.ts';
import type { KindDef } from '../records/kinds.ts';
import { CHAIN_KINDS } from '../records/kinds/chain.ts';
import { methodAdoptionKind, methodVersionKind, specificationKind } from '../records/kinds/reference.ts';
import { chainViews } from '../views/chain.ts';

export const CHAIN: { readonly kinds: readonly KindDef[]; readonly commands: readonly AnyCommandDef[]; readonly views: readonly AnyViewDef[] } = {
  kinds: [methodVersionKind, specificationKind, methodAdoptionKind, ...CHAIN_KINDS],
  commands: [...referenceCommands, ...chainCommands],
  views: chainViews,
};

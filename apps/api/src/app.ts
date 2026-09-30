// The server, assembled. Everything a request touches is passed in here: the database, the
// release, the secrets, the kind register, and the commands and views the doors expose.

import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '@lims/db';
import type { Config } from './config.ts';
import type { Deps } from './commit.ts';
import { registerDoors, type AnyCommandDef, type AnyViewDef } from './doors.ts';
import { KindRegistry, type KindDef } from './records/kinds.ts';
import { FileTokens } from './files.ts';
import { authorisationKind } from './records/kinds/authorisation.ts';
import { trainingRecordKind } from './records/kinds/training-record.ts';
import { sessionCommands } from './commands/session.ts';
import { identityCommands } from './commands/identity.ts';
import { signingCommands } from './commands/signing.ts';
import { valueCommands } from './commands/values.ts';
import { enablementCommands } from './commands/enablement.ts';
import { recordViews } from './views/records.ts';

export const CORE_KINDS: readonly KindDef[] = [authorisationKind, trainingRecordKind];
export const CORE_COMMANDS: readonly AnyCommandDef[] = [...sessionCommands, ...identityCommands, ...signingCommands, ...valueCommands, ...enablementCommands];
export const CORE_VIEWS: readonly AnyViewDef[] = recordViews;

export type AppOptions = {
  readonly db: Kysely<DB>;
  readonly config: Pick<Config, 'release' | 'pepper' | 'totpKey' | 'reportStore'>;
  /** The sample-chain kinds, commands and views plug in here. */
  readonly kinds?: readonly KindDef[];
  readonly commands?: readonly AnyCommandDef[];
  readonly views?: readonly AnyViewDef[];
};

export type Route = { readonly method: string; readonly url: string };

export type Api = { readonly app: FastifyInstance; readonly deps: Deps; readonly commands: readonly AnyCommandDef[]; readonly views: readonly AnyViewDef[]; readonly routes: readonly Route[] };

/** Each release identifies itself before its first audited write. */
export async function registerRelease(db: Kysely<DB>, release: string): Promise<void> {
  await db.insertInto('release').values({ id: release }).onConflict((oc) => oc.doNothing()).execute();
}

export async function buildApp(opts: AppOptions): Promise<Api> {
  await registerRelease(opts.db, opts.config.release);
  const deps: Deps = {
    db: opts.db,
    release: opts.config.release,
    pepper: opts.config.pepper,
    totpKey: opts.config.totpKey,
    kinds: new KindRegistry([...CORE_KINDS, ...(opts.kinds ?? [])]),
    reportStore: opts.config.reportStore,
    fileTokens: new FileTokens(),
  };
  const commands = [...CORE_COMMANDS, ...(opts.commands ?? [])];
  const views = [...CORE_VIEWS, ...(opts.views ?? [])];
  const app = Fastify({ logger: false, trustProxy: false });
  const routes: Route[] = [];
  app.addHook('onRoute', (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) routes.push({ method, url: r.url });
  });
  await app.register(fastifyCookie);
  registerDoors(app, deps, { commands, views });
  await app.ready();
  return { app, deps, commands, views, routes };
}

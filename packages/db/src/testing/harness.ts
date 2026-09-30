import pg from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../generated.ts';
import { connectionFor } from '../config.ts';
import { createDb } from '../pool.ts';
import { cloneTemplate, dropDatabase } from './template.ts';

export type TestDb = {
  readonly name: string;
  /** Connected as lims_app: what the API sees. */
  readonly app: Kysely<DB>;
  /** Connected as the superuser, to simulate tampering and to create test-only tables as the owner. */
  readonly superuser: pg.Pool;
  /** Runs SQL as lims_owner, the way a migration would. */
  readonly asOwner: (sqlText: string) => Promise<void>;
  /** Ends the pools and drops the database. */
  readonly close: () => Promise<void>;
};

/**
 * A fresh database cloned from the migrated template, for one test file. Files run in parallel
 * and never share rows. The vitest globalSetup builds the template once per migration set.
 */
export async function testDatabase(): Promise<TestDb> {
  const name = await cloneTemplate();
  const app = createDb(name, 'lims_app', 25);
  const superuser = new pg.Pool({ ...connectionFor('postgres', name), max: 4 });
  return {
    name,
    app,
    superuser,
    asOwner: async (sqlText) => {
      const c = await superuser.connect();
      try {
        await c.query('begin');
        await c.query('set local role lims_owner');
        await c.query(sqlText);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => {
      await app.destroy();
      await superuser.end();
      await dropDatabase(name);
    },
  };
}

/** The SQLSTATE of a thrown database error, or null. Kysely rethrows pg's DatabaseError as is. */
export function sqlState(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

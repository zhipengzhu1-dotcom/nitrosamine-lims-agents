import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { clusterConfig, connectionFor } from '../config.ts';
import { cloneTemplate, dropDatabase, ensureTemplate } from './template.ts';
import { classificationSource } from './classify.ts';

export const GENERATED_URL = new URL('../generated.ts', import.meta.url);
export const TABLES_URL = new URL('../tables.generated.ts', import.meta.url);

/** The Kysely types and the table classification, as read from a freshly migrated database. */
export async function generate(): Promise<{ generated: string; tables: string }> {
  await ensureTemplate();
  const db = await cloneTemplate();
  try {
    const { host, port } = clusterConfig();
    const generated = execFileSync(
      'kysely-codegen',
      ['--dialect', 'postgres', '--url', `postgres://postgres@${host}:${port}/${db}`, '--default-schema', 'lims',
       '--include-pattern', 'lims.*', '--exclude-pattern', 'lims.migration', '--print', '--log-level', 'error'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const client = new pg.Client(connectionFor('postgres', db));
    await client.connect();
    try {
      return { generated, tables: await classificationSource(client) };
    } finally {
      await client.end();
    }
  } finally {
    await dropDatabase(db);
  }
}

/** Paths of the committed files that differ from a fresh generation. */
export async function staleGeneratedFiles(): Promise<readonly string[]> {
  const out = await generate();
  const checks: readonly [URL, string][] = [[GENERATED_URL, out.generated], [TABLES_URL, out.tables]];
  const stale: string[] = [];
  for (const [url, text] of checks) {
    if ((await readFile(url, 'utf8').catch(() => '')) !== text) stale.push(url.pathname);
  }
  return stale;
}

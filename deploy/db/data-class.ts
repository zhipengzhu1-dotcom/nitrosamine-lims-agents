// The deployment's data class, stored on the `state` volume beside the data (ADR 0002 "The
// real-data gate"). The first start records it; every later start must ask for the same class;
// only an owner-run change that cites a Release Log entry moves it.
//   node deploy/db/data-class.ts show
//   node deploy/db/data-class.ts set <fictional|real> <release log reference>
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type DataClass = 'fictional' | 'real';
export type Decision = { kind: 'record' } | { kind: 'ok' } | { kind: 'refuse'; reason: string };

const MARKER = 'data_class';
const HISTORY = 'data_class.log';

export function parseDataClass(text: string | undefined): DataClass | undefined {
  return text === 'fictional' || text === 'real' ? text : undefined;
}

export function checkDataClass(start: { requested: DataClass; stored: DataClass | undefined; databaseExisted: boolean }): Decision {
  if (start.stored === undefined) {
    return start.databaseExisted
      ? { kind: 'refuse', reason: 'the database exists but its data class marker is missing; restore the state volume or record why in a System Incident' }
      : { kind: 'record' };
  }
  if (start.stored !== start.requested) {
    return {
      kind: 'refuse',
      reason: `the data is stored as ${start.stored}, and this start asks for ${start.requested}; change it with deploy/mac/data-class.sh`,
    };
  }
  return { kind: 'ok' };
}

/** Throws on a marker that is neither class: that is tampering or corruption, not a state to decide on. */
export async function readMarker(dir: string): Promise<DataClass | undefined> {
  let text: string;
  try {
    text = (await readFile(join(dir, MARKER), 'utf8')).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  const cls = parseDataClass(text);
  if (cls === undefined) throw new Error(`data_class marker holds "${text}"`);
  return cls;
}

async function writeMarker(dir: string, from: DataClass | null, to: DataClass, releaseLog: string, at: Date): Promise<void> {
  await appendFile(join(dir, HISTORY), JSON.stringify({ at: at.toISOString(), from, to, releaseLog }) + '\n');
  await writeFile(join(dir, `${MARKER}.new`), to + '\n');
  await rename(join(dir, `${MARKER}.new`), join(dir, MARKER));
}

export async function recordFirstStart(dir: string, cls: DataClass, at: Date): Promise<void> {
  await writeMarker(dir, null, cls, 'first start', at);
}

export async function changeDataClass(dir: string, to: DataClass, releaseLog: string, at: Date): Promise<Decision> {
  if (releaseLog.trim() === '') return { kind: 'refuse', reason: 'a data class change needs the Release Log reference' };
  const from = await readMarker(dir);
  if (from === undefined) return { kind: 'refuse', reason: 'no data class is recorded yet; the first start records it' };
  if (from === to) return { kind: 'refuse', reason: `the data class is already ${to}` };
  await writeMarker(dir, from, to, releaseLog.trim(), at);
  return { kind: 'ok' };
}

if (import.meta.main) {
  const dir = process.env['LIMS_STATE_DIR'] ?? '/var/lib/lims/state';
  const [command, cls, releaseLog] = process.argv.slice(2);
  if (command === 'show') {
    console.log((await readMarker(dir)) ?? 'none');
  } else if (command === 'set' && parseDataClass(cls) !== undefined) {
    const decision = await changeDataClass(dir, parseDataClass(cls)!, releaseLog ?? '', new Date());
    if (decision.kind === 'refuse') {
      console.error(`REFUSED: ${decision.reason}`);
      process.exitCode = 1;
    } else {
      console.log(`data class is now ${cls} (Release Log: ${releaseLog})`);
    }
  } else {
    console.error('usage: data-class.ts show | set <fictional|real> <release log reference>');
    process.exitCode = 2;
  }
}

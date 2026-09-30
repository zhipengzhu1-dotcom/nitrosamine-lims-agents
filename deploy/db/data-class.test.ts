import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changeDataClass, checkDataClass, parseDataClass, readMarker, recordFirstStart } from './data-class.ts';

const dirs: string[] = [];
function stateDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lims-state-'));
  dirs.push(d);
  return d;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const AT = new Date('2026-09-30T19:00:00Z');

describe('data class decision', () => {
  it('records the requested class on the first start of a new database', () => {
    expect(checkDataClass({ requested: 'fictional', stored: undefined, databaseExisted: false })).toEqual({ kind: 'record' });
  });

  it('lets a start through when the stored class matches', () => {
    expect(checkDataClass({ requested: 'real', stored: 'real', databaseExisted: true })).toEqual({ kind: 'ok' });
  });

  it('refuses a start whose class differs from the stored one', () => {
    expect(checkDataClass({ requested: 'fictional', stored: 'real', databaseExisted: true })).toEqual({
      kind: 'refuse',
      reason: 'the data is stored as real, and this start asks for fictional; change it with deploy/mac/data-class.sh',
    });
  });

  it('refuses when the database exists but its marker is gone, so deleting the marker cannot reset the class', () => {
    expect(checkDataClass({ requested: 'real', stored: undefined, databaseExisted: true })).toMatchObject({ kind: 'refuse' });
  });

  it('parses only the two classes', () => {
    expect(parseDataClass('real')).toBe('real');
    expect(parseDataClass('Real')).toBeUndefined();
    expect(parseDataClass(undefined)).toBeUndefined();
  });
});

describe('the marker on the state volume', () => {
  it('has no class before the first start, and the recorded one after', async () => {
    const dir = stateDir();
    expect(await readMarker(dir)).toBeUndefined();
    await recordFirstStart(dir, 'fictional', AT);
    expect(await readMarker(dir)).toBe('fictional');
    expect(readFileSync(join(dir, 'data_class.log'), 'utf8')).toBe(
      '{"at":"2026-09-30T19:00:00.000Z","from":null,"to":"fictional","releaseLog":"first start"}\n',
    );
  });

  it('changes the class only with a Release Log reference, and logs the change', async () => {
    const dir = stateDir();
    await recordFirstStart(dir, 'fictional', AT);
    expect(await changeDataClass(dir, 'real', '', AT)).toEqual({ kind: 'refuse', reason: 'a data class change needs the Release Log reference' });
    expect(await changeDataClass(dir, 'real', 'https://github.com/o/r/issues/24#issuecomment-1', AT)).toEqual({ kind: 'ok' });
    expect(await readMarker(dir)).toBe('real');
    expect(readFileSync(join(dir, 'data_class.log'), 'utf8').trim().split('\n').at(-1)).toBe(
      '{"at":"2026-09-30T19:00:00.000Z","from":"fictional","to":"real","releaseLog":"https://github.com/o/r/issues/24#issuecomment-1"}',
    );
  });

  it('refuses to change a class that was never recorded, or to the class already stored', async () => {
    const dir = stateDir();
    expect(await changeDataClass(dir, 'real', 'ref', AT)).toMatchObject({ kind: 'refuse' });
    await recordFirstStart(dir, 'fictional', AT);
    expect(await changeDataClass(dir, 'fictional', 'ref', AT)).toMatchObject({ kind: 'refuse' });
  });

  it('treats an unreadable marker as a refusal, not as no class', async () => {
    const dir = stateDir();
    writeFileSync(join(dir, 'data_class'), 'secret\n');
    await expect(readMarker(dir)).rejects.toThrow('data_class marker holds "secret"');
  });
});

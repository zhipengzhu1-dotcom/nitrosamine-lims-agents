import { describe, expect, it } from 'vitest';
import type { PreparedSigningDto } from '@lims/contract';
import { signedValues, sourceFilesOf } from './values';

type Item = PreparedSigningDto['items'][number];
const H = 'a'.repeat(64);
const item = (body: unknown, values: Item['values'] = []): Item => ({
  record: 'r', kind: 'test', label: 'Test RD-S-2026-000001/T1', version: { versionId: 'v', versionNo: 1, hash: H }, body, values, pendingChanges: [],
});

describe('what a prompt lists under "What you are signing"', () => {
  it("prints the record's typed values with who recorded them", () => {
    const listed = signedValues(item({ schema: 'test@1', runs: [], judgement: null }, [{ label: 'P1 weight', text: '100.12', unit: 'mg', by: 'Ann Kowalczyk (ann)', at: '2026-09-30T14:00:00.000Z' }]));
    expect(listed).toEqual([expect.objectContaining({ label: 'P1 weight', value: '100.12', unit: 'mg', by: 'Ann Kowalczyk (ann)' })]);
  });

  it("lists a Test's Run Versions by id and hash, and each Section's result against its limit as written", () => {
    const listed = signedValues(item({
      schema: 'test@1',
      runs: [{ run: 'run-1', number: 'RD-R-2026-000001', version: 'ver-run-1', sha256: H }],
      judgement: { kind: 'judged', outcome: 'conforms', sections: [{ jurisdiction: 'FDA', ruleSetVersion: 'FDA-RS@1', outcome: 'conforms', reportable: [{ kind: 'judged', analyte: 'NDMA', limit: '0.30', compared: '0.12', conforms: true, sharePercent: '40.6' }], preparations: [] }] },
    }));
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Run RD-R-2026-000001', value: `Record Version ver-run-1, SHA-256 ${H}` }),
      expect.objectContaining({ label: 'FDA Section, NDMA Reportable Result', value: '0.12 ppm against NMT 0.30 ppm: conforms, 40.6 % of limit' }),
    ]));
  });

  it("lists a Run's instrument and Run Checks, and a report's Test Versions", () => {
    const run = signedValues(item({ schema: 'run@1', instrument: { equipment: 'LCMS-01' }, runChecks: [{ name: 'S/N at LOQ standard', unit: 'ratio', outcome: 'conforms' }], trueCopy: { fileSha256: H } }));
    expect(run).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Instrument', value: 'LCMS-01' }),
      expect.objectContaining({ label: 'Run Check S/N at LOQ standard', value: 'conforms' }),
    ]));
    expect(sourceFilesOf(item({ schema: 'run@1', trueCopy: { fileSha256: H } }))).toEqual([{ name: 'True Copy', sha256: H }]);
    const report = signedValues(item({ schema: 'test_report@1', tests: [{ test: 't', number: 'RD-S-2026-000001/T1', version: 'ver-t', sha256: H }] }));
    expect(report).toEqual([expect.objectContaining({ label: 'Test RD-S-2026-000001/T1', value: `Record Version ver-t, SHA-256 ${H}` })]);
  });
});

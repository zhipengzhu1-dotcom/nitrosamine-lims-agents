import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkoutDatabase } from '../src/checkout.ts';

const cli = fileURLToPath(new URL('../src/checkout.ts', import.meta.url));

describe('checkout-scoped database names', () => {
  it('two checkout paths give different database names, and one path gives the same name each time', () => {
    const one = checkoutDatabase('lims_test', '/a/one');
    assert.notEqual(one, checkoutDatabase('lims_test', '/a/two'));
    assert.equal(one, checkoutDatabase('lims_test', '/a/one'));
    assert.match(one, /^lims_test_[0-9a-f]{8}$/);
  });

  it('a database name past Postgres 63 bytes is refused, and the longest name the tests create fits', () => {
    assert.throws(() => checkoutDatabase('x'.repeat(55), '/a/one'), /63 bytes/);
    assert.ok(Buffer.byteLength(checkoutDatabase('lims_migrate_legacy_missing')) <= 63);
  });

  it('the checkout CLI prints the database name the tests use', () => {
    const printed = execFileSync(process.execPath, [cli, 'database', 'lims_e2e'], { encoding: 'utf8' });
    assert.equal(printed.trim(), checkoutDatabase('lims_e2e'));
  });
});

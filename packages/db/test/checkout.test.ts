import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkoutDatabase, checkoutE2ePorts } from '../src/checkout.ts';

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

describe('checkout-scoped e2e ports', () => {
  it('two checkout paths give different e2e ports, and one path gives the same ports each time', () => {
    const one = checkoutE2ePorts('/a/one');
    assert.notDeepEqual(one, checkoutE2ePorts('/a/two'));
    assert.deepEqual(one, checkoutE2ePorts('/a/one'));
  });

  it('every checkout gets ports in 10000-19999, clear of the dev, demo and cluster ports, and its web port is never another checkout API port', () => {
    const pairs = Array.from({ length: 2000 }, (_, i) => checkoutE2ePorts(`/checkouts/${i}`));
    const apiPorts = new Set(pairs.map(({ api }) => api));
    for (const { api, web } of pairs) {
      assert.ok(api >= 10_000 && web <= 19_999, `ports ${api} ${web} lie in 10000-19999`);
      assert.equal(web, api + 1);
      assert.ok(!apiPorts.has(web), `web port ${web} is no checkout's API port`);
    }
  });

  it('the checkout CLI prints the e2e ports Playwright uses', () => {
    const printed = execFileSync(process.execPath, [cli, 'e2e-ports'], { encoding: 'utf8' });
    const { api, web } = checkoutE2ePorts();
    assert.equal(printed.trim(), `${api} ${web}`);
  });
});

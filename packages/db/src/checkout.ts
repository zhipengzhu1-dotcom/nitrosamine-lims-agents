import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface E2ePorts {
  api: number;
  web: number;
}

interface Checkout {
  port: number;
  suffix: string;
  e2e: E2ePorts;
}

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const MAX_IDENTIFIER_BYTES = 63;
const CLUSTER_PORT_BASE = 20_000;
const CLUSTER_PORT_SLOTS = 12_000;
// Below the cluster ports and the OS ephemeral ranges (Linux 32768+, macOS 49152+) that verify's free ports come from.
const E2E_PORT_BASE = 10_000;
const E2E_PORT_SLOTS = 5_000;

function checkoutOf(root: string): Checkout {
  const digest = createHash('sha256').update(root).digest();
  const api = E2E_PORT_BASE + 2 * (digest.readUInt32BE(4) % E2E_PORT_SLOTS);
  return {
    port: CLUSTER_PORT_BASE + (digest.readUInt32BE(0) % CLUSTER_PORT_SLOTS),
    suffix: digest.toString('hex').slice(0, 8),
    e2e: { api, web: api + 1 },
  };
}

/** `<base>_<suffix>` for a database this checkout creates and drops; refuses a name Postgres would truncate past 63 bytes. */
export function checkoutDatabase(base: string, root: string = ROOT): string {
  const name = `${base}_${checkoutOf(root).suffix}`;
  if (Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES)
    throw new Error(`${name} is longer than the ${MAX_IDENTIFIER_BYTES} bytes Postgres keeps of a database name`);
  return name;
}

/** The API and web ports this checkout's `pnpm e2e` binds: the same pair each time, web one above API, inside 10000-19999. */
export function checkoutE2ePorts(root: string = ROOT): E2ePorts {
  return checkoutOf(root).e2e;
}

if (import.meta.main) {
  const [command, base] = process.argv.slice(2);
  if (command === 'port') console.log(checkoutOf(ROOT).port);
  else if (command === 'database' && base) console.log(checkoutDatabase(base));
  else if (command === 'e2e-ports') {
    const { api, web } = checkoutE2ePorts();
    console.log(`${api} ${web}`);
  } else {
    console.error('usage: node packages/db/src/checkout.ts port | database <base> | e2e-ports');
    process.exitCode = 2;
  }
}

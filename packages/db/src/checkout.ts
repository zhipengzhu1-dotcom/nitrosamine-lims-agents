import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Checkout {
  port: number;
  suffix: string;
}

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const MAX_IDENTIFIER_BYTES = 63;

function checkoutOf(root: string): Checkout {
  const digest = createHash('sha256').update(root).digest();
  return { port: 20_000 + (digest.readUInt32BE(0) % 12_000), suffix: digest.toString('hex').slice(0, 8) };
}

/** `<base>_<suffix>` for a database this checkout creates and drops; refuses a name Postgres would truncate past 63 bytes. */
export function checkoutDatabase(base: string, root: string = ROOT): string {
  const name = `${base}_${checkoutOf(root).suffix}`;
  if (Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES)
    throw new Error(`${name} is longer than the ${MAX_IDENTIFIER_BYTES} bytes Postgres keeps of a database name`);
  return name;
}

if (import.meta.main) {
  const [command, base] = process.argv.slice(2);
  if (command === 'port') console.log(checkoutOf(ROOT).port);
  else if (command === 'database' && base) console.log(checkoutDatabase(base));
  else {
    console.error('usage: node packages/db/src/checkout.ts port | database <base>');
    process.exitCode = 2;
  }
}

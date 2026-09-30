// @vitest-environment node
// Rule 2's build check, and the gallery's exclusion: a production bundle must not contain dev-only
// or demo-only modules. Each such module carries a marker string; this build scans for them.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { GALLERY_MARKER } from './dev/Gallery';

const FORBIDDEN_IN_PRODUCTION = [GALLERY_MARKER, 'lims-demo-aid'];
const root = join(import.meta.dirname, '..');
const outDir = mkdtempSync(join(tmpdir(), 'lims-web-bundle-'));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('production bundle', () => {
  it('contains the app and none of the dev-only or demo-only modules', () => {
    // The real CLI build in its own process: inside vitest NODE_ENV is "test", which would keep DEV true.
    execFileSync(join(root, 'node_modules', '.bin', 'vite'), ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production' },
    });
    const text = files(outDir)
      .filter((f) => /\.(js|css|html)$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(text).toContain('Sign-in arrives with the session gate');
    for (const marker of FORBIDDEN_IN_PRODUCTION) expect(text).not.toContain(marker);
  }, 60_000);
});

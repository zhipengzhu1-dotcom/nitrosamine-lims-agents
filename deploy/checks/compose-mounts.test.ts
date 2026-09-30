import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { composeFileSets, forbiddenMounts, renderConfig } from './compose-mounts.ts';

const dir = mkdtempSync(join(tmpdir(), 'lims-compose-check-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(yaml: string): string[] {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, yaml);
  return forbiddenMounts(renderConfig([file]));
}

const SERVICE = 'services:\n  app:\n    image: busybox\n';

describe('compose mount check', () => {
  it('passes named volumes and secrets from the secrets folder', () => {
    expect(
      check(`${SERVICE}    volumes: ["data:/data"]\n    secrets: [k]\nvolumes:\n  data: {}\nsecrets:\n  k: { file: "\${LIMS_SECRETS_DIR}/k" }\n`),
    ).toEqual([]);
  });

  it('fails a short-syntax bind mount', () => {
    expect(check(`${SERVICE}    volumes: ["./OneDrive_3_9-29-2026:/exports:ro"]\n`)).toEqual([
      expect.stringContaining('service app bind-mounts'),
    ]);
  });

  it('fails a long-syntax bind mount', () => {
    expect(check(`${SERVICE}    volumes:\n      - { type: bind, source: /Users, target: /u }\n`)).toEqual([
      'service app bind-mounts /Users at /u',
    ]);
  });

  it('fails a named volume that is a host directory through driver_opts', () => {
    expect(
      check(`${SERVICE}    volumes: ["exports:/x"]\nvolumes:\n  exports:\n    driver_opts: { type: none, o: bind, device: /Users }\n`),
    ).toEqual([expect.stringContaining('volume exports is a host directory')]);
  });

  it('fails an rbind volume, which names no "bind" option but still maps a host device', () => {
    expect(
      check(`${SERVICE}    volumes: ["exports:/x"]\nvolumes:\n  exports:\n    driver_opts: { type: none, o: rbind, device: /Users }\n`),
    ).toEqual([expect.stringContaining('volume exports is a host directory')]);
  });

  it('fails a bind mount in a service that only starts under a profile', () => {
    expect(check(`${SERVICE}    profiles: [tunnel]\n    volumes: ["/Users:/u"]\n`)).toEqual(['service app bind-mounts /Users at /u']);
  });

  it('fails a secret or config read from outside the secrets folder', () => {
    expect(
      check(
        `${SERVICE}    secrets: [s]\n    configs: [c]\nsecrets:\n  s: { file: ./pepper }\nconfigs:\n  c: { file: /etc/hosts }\n`,
      ),
    ).toEqual([expect.stringContaining('secret s reads'), 'config c reads /etc/hosts, outside the owner\'s secrets folder']);
  });

  it('finds the deploy compose file with each override layered on it', () => {
    const sets = composeFileSets(join(import.meta.dirname, '..', '..')).map((s) => s.map((f) => f.split('/deploy/')[1]));
    expect(sets).toEqual(
      expect.arrayContaining([['compose.yaml'], ['compose.yaml', 'compose.local.yaml'], ['compose.yaml', 'compose.vps.yaml']]),
    );
  });
});

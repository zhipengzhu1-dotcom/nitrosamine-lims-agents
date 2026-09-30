// ADR 0002 "Storage": compose uses named volumes only, so the server can never reach the owner's
// real instrument exports in the repo folder. Checks every compose file in the repo, each override
// layered on its directory's compose.yaml, through `docker compose config` so short and long
// syntax are judged alike. Secret and config files must come from the owner's secrets folder.
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, sep } from 'node:path';

/** Stands in for the owner's secrets folder, so a secret path outside it is visible. */
export const SECRETS_DIR_PLACEHOLDER = '/lims-secrets-dir';

interface ComposeConfig {
  services?: Record<string, { volumes?: { type: string; source?: string; target: string }[] }>;
  volumes?: Record<string, { driver_opts?: Record<string, string> }>;
  secrets?: Record<string, { file?: string }>;
  configs?: Record<string, { file?: string }>;
}

function composeCommand(): [string, string[]] {
  for (const [bin, args] of [['docker-compose', []], ['docker', ['compose']]] as [string, string[]][]) {
    try {
      execFileSync(bin, [...args, 'version'], { stdio: 'ignore' });
      return [bin, args];
    } catch {}
  }
  throw new Error('neither docker-compose nor docker compose is installed');
}

export function renderConfig(files: readonly string[]): ComposeConfig {
  const [bin, args] = composeCommand();
  const out = execFileSync(bin, [...args, ...files.flatMap((f) => ['-f', f]), '--profile', '*', 'config', '--format', 'json'], {
    env: { ...process.env, LIMS_SECRETS_DIR: SECRETS_DIR_PLACEHOLDER, LIMS_DATA_CLASS: 'fictional' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out) as ComposeConfig;
}

export function forbiddenMounts(config: ComposeConfig): string[] {
  const found: string[] = [];
  for (const [name, service] of Object.entries(config.services ?? {})) {
    for (const v of service.volumes ?? []) {
      if (v.type === 'bind') found.push(`service ${name} bind-mounts ${v.source} at ${v.target}`);
    }
  }
  for (const [name, volume] of Object.entries(config.volumes ?? {})) {
    // The local driver mounts a host path only through `device`; a bind option without one fails.
    const device = volume.driver_opts?.['device'];
    if (device !== undefined) found.push(`volume ${name} is a host directory in disguise (device ${device})`);
  }
  for (const [kind, entries] of [['secret', config.secrets], ['config', config.configs]] as const) {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      if (entry.file !== undefined && !entry.file.startsWith(SECRETS_DIR_PLACEHOLDER + '/')) {
        found.push(`${kind} ${name} reads ${entry.file}, outside the owner's secrets folder`);
      }
    }
  }
  return found;
}

const COMPOSE_FILE = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/;

/** Each compose file set the repo can run: a directory's compose.yaml alone and with each override. */
export function composeFileSets(repoRoot: string): string[][] {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((f) => COMPOSE_FILE.test(f) && !f.split('/').includes('node_modules'));
  const byDir = Map.groupBy(tracked, (f) => dirname(f));
  return [...byDir.values()].flatMap((files) => {
    const base = files.find((f) => /(^|\/)compose\.ya?ml$/.test(f));
    if (base === undefined) return files.map((f) => [join(repoRoot, f)]);
    return [[base], ...files.filter((f) => f !== base).map((f) => [base, f])].map((set) => set.map((f) => join(repoRoot, f)));
  });
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dirname, '..', '..');
  const sets = composeFileSets(repoRoot);
  let failed = false;
  for (const set of sets) {
    const label = set.map((f) => relative(repoRoot, f).split(sep).join('/')).join(' + ');
    const found = forbiddenMounts(renderConfig(set));
    for (const f of found) console.error(`FAIL ${label}: ${f}`);
    if (found.length === 0) console.log(`ok   ${label}: named volumes only, secrets from the secrets folder`);
    failed ||= found.length > 0;
  }
  if (sets.length === 0) {
    console.error('FAIL no compose files found');
    failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}

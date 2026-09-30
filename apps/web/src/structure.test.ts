// @vitest-environment node
// Structural lints: the rules below hold for every source file, not just the ones a test renders.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

function offenders(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (!isComment(line) && pattern.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [])),
  );
}

/** The source of each effect callback: from `useEffect(` to its matching parenthesis. */
export function effectBodies(source: string): string[] {
  const bodies: string[] = [];
  const opener = /\buse(?:Layout|Insertion)?Effect\(/g;
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    bodies.push(source.slice(m.index, i));
  }
  return bodies;
}

/** A command sent from an effect: useCommand's run, the client's command, or the commands door. */
const COMMAND_CALL = /\.run\(|\.command\(|\/api\/commands\//;

describe('structure', () => {
  it('sends no command from an effect: navigation and render never change anything (sessions.md, no-command-in-effect)', () => {
    const offending = sources(SRC).flatMap((file) =>
      effectBodies(readFileSync(file, 'utf8'))
        .filter((body) => COMMAND_CALL.test(body))
        .map((body) => `${relative(SRC, file)}: ${body.split('\n')[0]}`),
    );
    expect(offending).toEqual([]);
  });

  it('the no-command-in-effect scan finds a command inside an effect and nothing outside one', () => {
    const planted = `useEffect(() => { if (x) { void lock.run({}); } }, [x]);\nconst onClick = () => lock.run({});`;
    expect(effectBodies(planted).filter((b) => COMMAND_CALL.test(b))).toHaveLength(1);
    expect(effectBodies('useEffect(() => { void api.view("a", {}); }, []);').filter((b) => COMMAND_CALL.test(b))).toHaveLength(0);
  });

  it('formats no number anywhere: limits and values print from their stored strings (rule 20)', () => {
    const numberFormatting = /\.toFixed\(|\.toPrecision\(|\.toLocaleString\(|NumberFormat|parseFloat\(|parseInt\(|\bNumber\(|Math\.round\(/;
    expect(offenders(sources(SRC), numberFormatting)).toEqual([]);
  });

  it('keeps rough screens inert: no commit, no field, no request', () => {
    const rough = sources(join(SRC, 'screens', 'rough'));
    expect(rough.length).toBeGreaterThan(0);
    const commits = /CommitButton|onCommit|useCommand|\/api\/|fetch\(|<input|<select|<textarea|<form/;
    expect(offenders(rough, commits)).toEqual([]);
  });

  it('gives the signing and sign-in components no fill path and no simulated authenticator (rule 2)', () => {
    const credentialOwners = ['components/CredentialFields.tsx', 'components/SignaturePrompt.tsx', 'components/LockScreen.tsx'].map((f) => join(SRC, f));
    expect(offenders(credentialOwners, /\bfill\b|demo|simulat|defaultValue|autoComplete="(?!off)/i)).toEqual([]);
  });
});

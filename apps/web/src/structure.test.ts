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

describe('structure', () => {
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

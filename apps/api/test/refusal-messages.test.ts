import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SENTENCE } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

type Sources = ReadonlyMap<string, string>;

/** Where a message for the person at the bench is written: a call's argument, or the value of a `message:` literal. */
interface Position {
  start: RegExp;
  argument: number | 'value';
  scope: (path: string) => boolean;
}

const shown = (path: string) => /^(apps\/(api|web)\/src|packages\/domain\/src)\/.+\.tsx?$/.test(path);

const positions: Position[] = [
  { start: /(?<!function )\brefuse\(/g, argument: 1, scope: shown },
  { start: /\bnew Refused\(/g, argument: 1, scope: shown },
  { start: /(?<!function )\brefusedBy\(/g, argument: 1, scope: shown },
  // The API log redacts an error's message: the person never sees it.
  {
    start: /\bmessage:\s*(?=['"`])/g,
    argument: 'value',
    scope: (path) => shown(path) && path !== 'apps/api/src/log.ts',
  },
  // The web shows a thrown Error's message in the form that threw it.
  { start: /\bnew Error\(/g, argument: 0, scope: (path) => path.startsWith('apps/web/src/') && shown(path) },
];

/**
 * Messages that are not literals, each with where its own literals are checked. A key is `<path>: <expression>`.
 * An entry no message uses fails the check, so the list cannot go stale.
 */
const elsewhere: Readonly<Record<string, string>> = {
  'apps/api/src/refuse.ts: message': "refuse's own parameter, collected at each refuse call",
  'apps/api/src/steps.ts: refused.message':
    'a step registry Refusal, each one checked in packages/domain/test/steps.test.ts',
  'apps/api/src/staff.ts: refused.message': "staffRefusal's message: literal in packages/domain/src/staff.ts",
  'apps/api/src/staff.ts: administrationApart.message': 'its message: literal in packages/domain/src/staff.ts',
  "apps/web/src/api.ts: 'message' in body && typeof body.message === 'string' ? body.message : fallback":
    "the API's message as sent, collected at its refuse call, or the fallback, collected at each refusedBy call",
};

const CLOSE: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/** The index just past the string or template literal that opens at `i`. */
function pastLiteral(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote) {
    if (text[j] === '\\') j += 2;
    else if (quote === '`' && text.startsWith('${', j)) j = expressionEnd(text, j + 2) + 1;
    else j += 1;
  }
  return j + 1;
}

/** The index of the first `,`, `;` or unmatched closing bracket from `i` that is outside literals and comments. */
function expressionEnd(text: string, i: number): number {
  const open: string[] = [];
  let j = i;
  while (j < text.length) {
    const c = text.charAt(j);
    if (c === "'" || c === '"' || c === '`') j = pastLiteral(text, j);
    else if (text.startsWith('//', j)) j = text.includes('\n', j) ? text.indexOf('\n', j) : text.length;
    else if (text.startsWith('/*', j)) j = text.indexOf('*/', j) + 2;
    else {
      const closer = CLOSE[c];
      if (closer) open.push(closer);
      else if (c === open.at(-1)) open.pop();
      else if (open.length === 0 && ',;)]}'.includes(c)) return j;
      j += 1;
    }
  }
  return j;
}

function callArguments(text: string, i: number): string[] {
  const found: string[] = [];
  for (let j = i; ; ) {
    const end = expressionEnd(text, j);
    found.push(text.slice(j, end));
    if (text[end] !== ',') return found;
    j = end + 1;
  }
}

/** A template literal's text before its first substitution, and after its last. */
function templateEnds(literal: string): { head: string; tail: string } {
  let head: string | null = null;
  let tailFrom = 1;
  for (let j = 1; j < literal.length - 1; ) {
    if (literal[j] === '\\') j += 2;
    else if (literal.startsWith('${', j)) {
      head ??= literal.slice(1, j);
      j = expressionEnd(literal, j + 2) + 1;
      tailFrom = j;
    } else j += 1;
  }
  return { head: head ?? literal.slice(1, -1), tail: literal.slice(tailFrom, -1) };
}

const NAME = /^[A-Za-z_$][\w$]*$/;
const ARROW = /^(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(:\s*[\w<>[\]| ]+)?\s*=>\s*/;

/** The expression a `const` of that name is set to, in any of the sources, or null. */
function constant(name: string, sources: Sources): string | null {
  const declaration = new RegExp(`\\bconst ${name}\\s*(?::[^=]*)?=\\s*`, 'g');
  for (const text of sources.values()) {
    const match = declaration.exec(text);
    declaration.lastIndex = 0;
    if (match) return text.slice(match.index + match[0].length, expressionEnd(text, match.index + match[0].length));
  }
  return null;
}

/** The const an expression reads, as `NAME` or as the call `NAME(...)`, or null. */
function readsConstant(e: string): { name: string; called: boolean } | null {
  if (NAME.test(e)) return { name: e, called: false };
  const [opening, name] = /^([A-Za-z_$][\w$]*)\(/.exec(e) ?? [];
  return opening && name && expressionEnd(e, opening.length) === e.length - 1 ? { name, called: true } : null;
}

/** Why the message an expression gives is not a sentence, or null when it is one. */
function problemOf(expression: string, path: string, sources: Sources, used: Set<string>): string | null {
  const e = expression.trim();
  if (/^(['"]).*\1$/s.test(e) && pastLiteral(e, 0) === e.length)
    return SENTENCE.test(e.slice(1, -1)) ? null : 'it does not start with a capital letter and end with a full stop';
  if (e.startsWith('`') && pastLiteral(e, 0) === e.length) {
    const { head, tail } = templateEnds(e);
    if (!/^[A-Z]/.test(head)) return 'it does not start with a capital letter in the literal text';
    return tail.endsWith('.') ? null : 'it does not end with a full stop in the literal text';
  }
  const read = readsConstant(e);
  const value = read && constant(read.name, sources);
  if (!read || value === null) {
    const key = `${path}: ${e}`;
    if (!(key in elsewhere))
      return 'the check cannot read it; write it as a literal or a const, or list it in elsewhere';
    used.add(key);
    return null;
  }
  const body = read.called ? value.replace(ARROW, '') : value;
  if (read.called && body === value) return `${read.name} is not an arrow function the check can read`;
  return problemOf(body, path, sources, used);
}

/** Each message that is not a sentence, as `<path>:<line> <message> (<why>)`, and the elsewhere keys that were used. */
function unsentenced(sources: Sources): { findings: string[]; used: Set<string> } {
  const findings: string[] = [];
  const used = new Set<string>();
  for (const [path, text] of sources)
    for (const { start, argument, scope } of positions) {
      if (!scope(path)) continue;
      for (const match of text.matchAll(start)) {
        const at = match.index + match[0].length;
        const message =
          argument === 'value' ? text.slice(at, expressionEnd(text, at)) : callArguments(text, at)[argument];
        if (message === undefined) continue;
        const problem = problemOf(message, path, sources, used);
        const line = text.slice(0, match.index).split('\n').length;
        if (problem) findings.push(`${path}:${line} ${message.trim()} (${problem})`);
      }
    }
  return { findings, used };
}

function trackedSources(): Sources {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  return new Map(tracked.filter((path) => shown(path)).map((path) => [path, readFileSync(`${root}${path}`, 'utf8')]));
}

describe('every refusal and failure message is a sentence for the person at the bench', () => {
  const { findings, used } = unsentenced(trackedSources());

  it('every message passed to refuse, Refused or refusedBy, every message: literal and every Error the web throws starts with a capital letter and ends with a full stop', () => {
    assert.deepEqual(findings, [], 'write the message as a sentence in glossary terms');
  });

  it('every message the check cannot read is listed in elsewhere, and every entry there is still used', () => {
    assert.deepEqual(
      Object.keys(elsewhere).filter((key) => !used.has(key)),
      [],
    );
  });

  const api = 'apps/api/src/x.ts';
  const cases: [string, Record<string, string>, number][] = [
    ['a lower-case refusal', { [api]: "refuse('role', 'only QA releases a Test.');" }, 1],
    ['a refusal with no full stop', { [api]: "refuse('role', 'Only QA releases a Test');" }, 1],
    ['a sentence', { [api]: "refuse('role', 'Only QA releases a Test.');" }, 0],
    ['a refusal wrapped over lines', { [api]: "refuse(\n  'state',\n  `you already work in ${lab.name}`,\n);" }, 1],
    ['a template that is a sentence', { [api]: "refuse('state', `You already work in ${lab.name}.`)" }, 0],
    ['a template that starts with a value', { [api]: "refuse('state', `${name} already holds QA.`)" }, 1],
    ['a template that ends with a value', { [api]: "refuse('notFound', `No Test is numbered ${n}`)" }, 1],
    ['a template with a nested literal', { [api]: "refuse('state', `The Test is ${s ?? 'new'}; reload it.`)" }, 0],
    ['a constant that is a sentence', { [api]: "const ENDED = 'Sign in again.';\nrefuse('noSession', ENDED);" }, 0],
    ['a constant that is not', { [api]: "const ENDED = 'sign in again';\nrefuse('noSession', ENDED);" }, 1],
    ['an arrow that is not', { [api]: 'const locked = (n: string) =>\n  `locked by ${n}`;\nrefuse(k, locked(n));' }, 1],
    [
      'an arrow that is',
      { [api]: 'const locked = (n: string) => `This screen is locked by ${n}.`;\nrefuse(k, locked(n));' },
      0,
    ],
    ['a message the check cannot read', { [api]: 'refuse(r.kind, r.message);' }, 1],
    ['a message: literal', { 'packages/domain/src/x.ts': "return { kind: 'role', message: 'staff only' };" }, 1],
    ['a message: type', { 'packages/domain/src/x.ts': 'interface R { message: string }' }, 0],
    ['an Error the web throws', { 'apps/web/src/x.tsx': "throw new Error('choose a role');" }, 1],
    ['an Error the API throws, which the person never sees', { [api]: "throw new Error('signing failed');" }, 0],
    ['the declaration of refuse', { [api]: 'export function refuse(kind: Kind, message: string) {}' }, 0],
    ['a file the web does not show', { 'apps/api/test/x.ts': "refuse('role', 'only QA');" }, 0],
  ];
  for (const [name, files, count] of cases)
    it(`${count ? 'refuses' : 'allows'} ${name}`, () => {
      assert.equal(unsentenced(new Map(Object.entries(files))).findings.length, count);
    });
});

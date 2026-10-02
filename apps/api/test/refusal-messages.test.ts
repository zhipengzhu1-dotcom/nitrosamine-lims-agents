import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The compiler checks the form of every refusal message: `refuse`, `Refused` and the step and staff refusals take a
// `Sentence` from @lims/domain. What it cannot see is the web adding a full stop of its own after a message it shows.

const web = fileURLToPath(new URL('../../web/src/', import.meta.url));

/** A message shown in JSX or a template, followed by a full stop of the web's own. */
const FULL_STOP_AFTER = /(\$\{|\{)[^{}]*\b(message|error|refusal|failed|intro|failureText\([^()]*\))\}\./gi;

/** Each place in `sources` that adds a full stop after a shown message, as `<path>:<line>`. */
function fullStopsAfter(sources: ReadonlyMap<string, string>): string[] {
  return [...sources].flatMap(([path, text]) =>
    [...text.matchAll(FULL_STOP_AFTER)].map((m) => `${path}:${text.slice(0, m.index).split('\n').length}`),
  );
}

describe('the web shows a refusal message as written', () => {
  it('the web adds no full stop after a message it shows, which already ends with one', () => {
    const files = readdirSync(web, { recursive: true, encoding: 'utf8' }).filter((path) => /\.tsx?$/.test(path));
    assert.deepEqual(fullStopsAfter(new Map(files.map((path) => [path, readFileSync(`${web}${path}`, 'utf8')]))), []);
  });

  const cases: [string, string, number][] = [
    ['a message in JSX', '<p className="muted">{message}.</p>', 1],
    ['a message in a template', 'text: `Refused: ${e.message}.`', 1],
    ['a refusal held in state', '<p>{refusal}.</p>', 1],
    ['an answer that failed', '<p>{answer.failed}.</p>', 1],
    ['an intro', 'intro={`${intro}.`}', 1],
    ['the failure text of a call', '<p>{failureText(e)}.</p>', 1],
    ['a message shown as written', '<p className="muted">{message}</p>', 0],
    ['a count followed by a full stop', '<p>{count} Tests are waiting.</p>', 0],
  ];
  for (const [name, text, count] of cases)
    it(`the check ${count ? 'flags' : 'passes'} ${name}`, () => {
      assert.equal(fullStopsAfter(new Map([['x.tsx', text]])).length, count);
    });
});

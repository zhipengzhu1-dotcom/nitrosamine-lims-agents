import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const self = 'packages/db/test/interpolated-sql.test.ts';

interface Pattern {
  shape: RegExp;
  scope: (path: string) => boolean;
}

const rawWithValue: Pattern = {
  shape: /sql\.raw\((?!\s*('[^'\\\n]*'|"[^"\\\n]*")\s*\))/g,
  scope: (path) => /\.tsx?$/.test(path),
};

const psqlCommandWithValue: Pattern = {
  shape: /psql[^\n]*\s-[A-Za-z]*c[A-Za-z]*\s+"([^"\\\n]|\\.)*\$[{A-Za-z_]|'-[A-Za-z]*c[A-Za-z]*'\s*,\s*`[^`]*\$\{/g,
  scope: (path) => ['scripts/', '.claude/skills/verify/', 'apps/web/e2e/'].some((dir) => path.startsWith(dir)),
};

function matchedLines({ shape }: Pattern, text: string): number[] {
  return [...text.matchAll(shape)].map((match) => text.slice(0, match.index).split('\n').length);
}

function offendingLines(pattern: Pattern): string[] {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  return tracked
    .filter((path) => path && path !== self && pattern.scope(path))
    .flatMap((path) => matchedLines(pattern, readFileSync(`${root}${path}`, 'utf8')).map((line) => `${path}:${line}`));
}

describe('SQL built from an interpolated value', () => {
  it('sql.raw is given only a quoted string literal anywhere in the TypeScript', () => {
    assert.deepEqual(
      offendingLines(rawWithValue),
      [],
      'pass the value through the sql tag, which binds it as a parameter',
    );
  });

  it('no psql -c in scripts, the verify skill or the e2e walks holds a shell or template variable', () => {
    assert.deepEqual(
      offendingLines(psqlCommandWithValue),
      [],
      "bind the value with psql -v name=value and send the SQL on stdin, where :'name' quotes it",
    );
  });

  const cases: [Pattern, string, number[]][] = [
    [rawWithValue, 'sql.raw(`drop table ${name}`)', [1]],
    [rawWithValue, 'sql`${sql.raw(grant)} execute`', [1]],
    [rawWithValue, "sql.raw('a' + b)", [1]],
    [rawWithValue, 'const a = 1;\nsql.raw(\n  `select ${x}`,\n)', [2]],
    [rawWithValue, "sql.raw('select 1')", []],
    [rawWithValue, 'sql.raw(\n  "select 1"\n)', []],
    [rawWithValue, 'sql`select ${x}`', []],
    [psqlCommandWithValue, "psql(db, ['-tAc', `select ${column} from t`])", [1]],
    [psqlCommandWithValue, "[\n  'psql',\n  '-c',\n  `select ${column}`,\n]", [3]],
    [psqlCommandWithValue, 'scripts/pg.sh psql -qc "drop database if exists \\"$DB\\" with (force)"', [1]],
    [psqlCommandWithValue, 'scripts/pg.sh psql -d "$DB" -tAc \'select count(*) from lims.person\'', []],
    [psqlCommandWithValue, 'scripts/pg.sh psql -q -v db="$DB" <<<\'drop database if exists :"db" with (force)\'', []],
    [psqlCommandWithValue, "['psql', '-d', database, '-qtA', '-v', `hash=${hash}`]", []],
    [psqlCommandWithValue, 'psql(`do $$ begin null; end $$;`)', []],
    [psqlCommandWithValue, 'scripts/pg.sh psql -c "select ${n}"', [1]],
    [psqlCommandWithValue, `scripts/pg.sh psql -c 'select 1' -d "$DB"`, []],
    [psqlCommandWithValue, `scripts/pg.sh psql -tAc 'select count(*) from x' | tee "$LOG"`, []],
  ];
  for (const [pattern, text, lines] of cases) {
    it(`${lines.length ? `refuses line ${lines.join(', ')} of` : 'allows'} ${JSON.stringify(text)}`, () =>
      assert.deepEqual(matchedLines(pattern, text), lines));
  }
});

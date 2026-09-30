// Writes src/generated.ts and src/tables.generated.ts from a freshly migrated database.
// `--check` writes nothing and exits 1 when either committed file is stale.
import { writeFile } from 'node:fs/promises';
import { GENERATED_URL, TABLES_URL, generate, staleGeneratedFiles } from '../src/testing/codegen.ts';

if (process.argv.includes('--check')) {
  const stale = await staleGeneratedFiles();
  if (stale.length) {
    console.error(`stale: ${stale.join(', ')} (run pnpm --filter @lims/db codegen)`);
    process.exit(1);
  }
} else {
  const out = await generate();
  await writeFile(GENERATED_URL, out.generated);
  await writeFile(TABLES_URL, out.tables);
}

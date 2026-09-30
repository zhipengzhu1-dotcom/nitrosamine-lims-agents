import { expect, it } from 'vitest';
import { staleGeneratedFiles } from '../src/testing/codegen.ts';

it('generated.ts and tables.generated.ts match a fresh generation from the migrations', async () => {
  expect(await staleGeneratedFiles()).toEqual([]);
});

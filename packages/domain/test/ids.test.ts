import { expectTypeOf, it } from 'vitest';
import type { RecordId, RunId, TestId } from '../src/ids.ts';

it('keeps sibling record ids apart and each one a RecordId', () => {
  expectTypeOf<TestId>().toExtend<RecordId>();
  expectTypeOf<RunId>().toExtend<RecordId>();
  expectTypeOf<RunId>().not.toExtend<TestId>();
  expectTypeOf<RecordId>().not.toExtend<TestId>();
  expectTypeOf<string>().not.toExtend<RecordId>();
  expectTypeOf<TestId>().not.toBeNever();
});

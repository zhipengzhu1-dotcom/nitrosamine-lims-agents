// Drops the test databases an interrupted run left behind.
import { dropAllTestDatabases } from '../src/testing/template.ts';

const dropped = await dropAllTestDatabases();
console.log(dropped.length ? `dropped ${dropped.join(', ')}` : 'nothing to drop');

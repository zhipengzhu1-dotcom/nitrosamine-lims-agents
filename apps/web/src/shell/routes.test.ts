import { describe, expect, it } from 'vitest';
import { match, resolve } from './routes';

describe('routes', () => {
  it('takes a record id from the path and nothing else', () => {
    expect(match('/tests/:id', '/tests/0b6e1f7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toEqual({ id: '0b6e1f7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b' });
    expect(match('/tests/:id', '/tests/../admin')).toBeNull();
    expect(match('/tests/:id', '/tests')).toBeNull();
  });

  it('resolves "/" to the audience\'s own home: the queue for staff, the portal for a Customer', () => {
    expect(resolve('/', 'staff')?.route.title).toBe('Work');
    expect(resolve('/', 'customer')?.route.title).toBe('Submissions');
    expect(resolve('/review/run/abc', 'staff')?.params).toEqual({ kind: 'run', id: 'abc' });
  });
});

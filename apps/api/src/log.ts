import { fchmodSync, openSync, writeSync } from 'node:fs';
import { postgresFault } from '@lims/db';

export interface LogSink {
  write(line: string): void;
}

/** The API log on its own volume: appended line by line to a file only its owner can read or write. */
export function logFile(path: string): LogSink {
  const fd = openSync(path, 'a', 0o600);
  fchmodSync(fd, 0o600);
  return { write: (line) => writeSync(fd, line) };
}

const REDACTED = [
  'req.body',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  '*.*.password',
];

function errForLog(error: Error) {
  const frames = (error.stack ?? '').split('\n').filter((line) => line.startsWith('    at '));
  return { type: error.constructor.name, message: '[redacted]', stack: frames.join('\n'), ...postgresFault(error) };
}

/** The logger that never writes a body, a password, a token, a cookie or an error's message; a Postgres error keeps its SQLSTATE and the names it carries. */
export function apiLogger(sink: LogSink) {
  return {
    level: 'info',
    stream: sink,
    redact: { paths: REDACTED, censor: '[redacted]' },
    serializers: { err: errForLog },
  };
}

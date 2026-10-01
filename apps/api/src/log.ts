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

/** The log's view of an error: a Postgres error keeps its SQLSTATE and the names it carries, never its message, which can quote a record. */
function errForLog(error: Error) {
  const fault = postgresFault(error);
  const type = error.constructor.name;
  if (fault) return { type, message: '[redacted]', stack: '[redacted]', ...fault };
  return { type, message: error.message, stack: error.stack ?? '' };
}

/** The logger that never writes a body, a password, a token, a cookie or a Postgres error's message. */
export function apiLogger(sink: LogSink) {
  return {
    level: 'info',
    stream: sink,
    redact: { paths: REDACTED, censor: '[redacted]' },
    serializers: { err: errForLog },
  };
}

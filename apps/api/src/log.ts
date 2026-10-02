import { fchmodSync, openSync, writeSync } from 'node:fs';
import { type DB, postgresFault } from '@lims/db';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { openJobIncident, raiseUnwrittenIncidents } from './incident.ts';
import { requestReference } from './refuse.ts';

export interface LogSink {
  write(line: string): void;
}

/** The API log on its own volume: appended line by line to a file only its owner can read or write, and to stderr when the volume refuses a line. */
export function logFile(path: string): LogSink {
  const fd = openSync(path, 'a', 0o600);
  fchmodSync(fd, 0o600);
  return {
    write: (line) => {
      try {
        writeSync(fd, line);
      } catch {
        process.stderr.write(line);
      }
    },
  };
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

/** The timer the API schedules its checks on: `every` runs `task` each `ms` until the returned function cancels it. */
export interface Clock {
  every(ms: number, task: () => Promise<void>): () => void;
}

/** The process's own timer, for production; tests inject a clock they advance by hand. */
export const systemClock: Clock = {
  every: (ms, task) => {
    const timer = setInterval(() => void task(), ms);
    return () => clearInterval(timer);
  },
};

export interface LogVolume {
  file: string;
  clock: Clock;
}

const CHECK_EVERY_MS = 15 * 60 * 1000;

/**
 * Raises every unwritten System Incident on the log volume at API start, where a failure stops the start, and every
 * 15 minutes after, one check at a time, where a failure opens a System Incident and the next check tries again.
 */
export function checkLogVolume(app: FastifyInstance, db: Kysely<DB>, volume: LogVolume): void {
  const check = () => raiseUnwrittenIncidents(db, volume.file, app.log);
  let running: Promise<void> | null = null;
  let cancel = () => {};
  app.addHook('onReady', async () => {
    await check();
    cancel = volume.clock.every(CHECK_EVERY_MS, async () => {
      running ??= check()
        .catch((err: Error) =>
          openJobIncident(db, app.log, { reference: requestReference(), step: 'raiseUnwrittenIncidents' }, err),
        )
        .finally(() => {
          running = null;
        });
      await running;
    });
  });
  app.addHook('onClose', async () => {
    cancel();
    await running;
  });
}

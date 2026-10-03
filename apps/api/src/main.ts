import { createDb } from '@lims/db';
import { buildApp } from './app.ts';
import { LOGIN } from './auth.ts';
import { apiConfig, SWEEP_EVERY_MS } from './config.ts';
import { logFile, systemClock } from './log.ts';

const config = apiConfig();
await buildApp(createDb(config.databaseUrl), {
  log: config.logFile ? logFile(config.logFile) : config.log ? process.stdout : null,
  logVolume: config.logFile ? { file: config.logFile, clock: systemClock } : null,
  secureCookie: config.secureCookie,
  accessEventKey: config.accessEventKey,
  trustedProxies: config.trustedProxies,
  credentials: { policy: LOGIN[config.login], pepper: config.passwordPepper, totpKey: config.totpKey },
  release: config.release,
  sweepEveryMs: SWEEP_EVERY_MS,
}).listen(config.listen);

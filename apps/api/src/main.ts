import { createDb } from '@lims/db';
import { buildApp } from './app.ts';
import { apiConfig } from './config.ts';
import { logFile, systemClock } from './log.ts';

const config = apiConfig();
await buildApp(createDb(config.databaseUrl), {
  log: config.logFile ? logFile(config.logFile) : config.log ? process.stdout : null,
  logVolume: config.logFile ? { file: config.logFile, clock: systemClock } : null,
  secureCookie: config.secureCookie,
  accessEventKey: config.accessEventKey,
}).listen(config.listen);

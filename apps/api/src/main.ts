import { createDb } from '@lims/db';
import { buildApp } from './app.ts';
import { apiConfig } from './config.ts';

const config = apiConfig();
await buildApp(createDb(config.databaseUrl), {
  log: config.log ? process.stdout : null,
  secureCookie: config.secureCookie,
  accessEventKey: config.accessEventKey,
}).listen(config.listen);

import { createDb } from '@lims/db';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { sweepIdleSessions } from './sweeper.ts';

const config = loadConfig();
const db = createDb(config.database);
const { app } = await buildApp({ db, config });
const sweeper = setInterval(() => void sweepIdleSessions(db, config.release).catch((e) => app.log.error(e)), 60_000);
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(sweeper);
    await app.close();
    await db.destroy();
  });
}

import { buildApp } from './app.ts';
import { createPool, migrate } from './db.ts';

const port = Number(process.env.PORT ?? 3000);
const baseUrl = (process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '');

const pool = createPool();
const ran = await migrate(pool);
if (ran.length) console.log(`Migrations: ${ran.join(', ')}`);

const app = buildApp({ pool, baseUrl, timezone: process.env.TZ_STATS });
await app.listen({ port, host: '0.0.0.0' });
console.log(`Short links on ${baseUrl}`);

// waiting clicks go to the database before the process stops
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

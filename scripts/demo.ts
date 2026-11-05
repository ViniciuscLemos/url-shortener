// npm run demo: the app on an embedded Postgres with a few links and a month of clicks,
// to click around without setting anything up. Everything is gone when it stops.
import { buildApp } from '../src/app.ts';
import { DEMO_LINKS, seedDemo } from '../src/demo.ts';
import { startDatabase } from '../tests/db.ts';

const port = Number(process.env.PORT ?? 3000);
const baseUrl = `http://localhost:${port}`;
const db = await startDatabase();
await seedDemo(db.pool);

const app = buildApp({ pool: db.pool, baseUrl, demo: true });
await app.listen({ port, host: '127.0.0.1' });
console.log(`Demo on ${baseUrl} with: ${DEMO_LINKS.map((l) => l.code).join(', ')}`);

process.on('SIGINT', async () => {
  await app.close();
  await db.stop();
  process.exit(0);
});

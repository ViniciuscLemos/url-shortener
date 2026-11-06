// a Postgres for the tests: the CI one when TEST_DATABASE_URL is set, otherwise an
// embedded one that npm downloads, so nothing needs to be installed to run them
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { migrate } from '../src/db.ts';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export async function startDatabase() {
  let stop = async () => {};
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = await freePort();
    const db = new EmbeddedPostgres({
      databaseDir: mkdtempSync(path.join(os.tmpdir(), 'shortener-pg-')),
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      onLog: () => {},
    });
    await db.initialise();
    await db.start();
    stop = () => db.stop();
    url = `postgres://postgres:postgres@localhost:${port}/postgres`;
  }

  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  // twice, to be sure running it again changes nothing
  await migrate(pool);
  return {
    pool,
    clear: () => pool.query('TRUNCATE links, clicks, link_days RESTART IDENTITY CASCADE'),
    async stop() {
      await pool.end();
      await stop();
    },
  };
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import QRCode from 'qrcode';
import type pg from 'pg';
import { ClickQueue, browserOf, deviceOf, isBot, referrerOf } from './clicks.ts';
import { RateLimit } from './limits.ts';
import { checkAlias, checkUrl, randomCode } from './links.ts';
import { DEMO_LINKS } from './demo.ts';
import { linkStats } from './stats.ts';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

interface Link {
  id: number;
  code: string;
  url: string;
  created_at: Date;
  clicks: string;
}

export interface Options {
  pool: pg.Pool;
  /** what goes in front of the code, e.g. https://trail.link */
  baseUrl: string;
  timezone?: string;
  clickFlushMs?: number;
  /** links one IP can make per 10 minutes (default 20) */
  linksPer10Min?: number;
  /** the public demo: the page shows the example links to someone who hasn't made any */
  demo?: boolean;
}

/**
 * The most used links stay in memory, so a redirect usually doesn't touch the database.
 * A Map keeps insertion order: reading an entry moves it to the end, the oldest goes first.
 */
class RecentLinks {
  private map = new Map<string, { id: number; url: string }>();
  constructor(private max = 1000) {}

  get(code: string) {
    const hit = this.map.get(code);
    if (hit) {
      this.map.delete(code);
      this.map.set(code, hit);
    }
    return hit;
  }

  set(code: string, link: { id: number; url: string }) {
    this.map.set(code, link);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

export function buildApp(options: Options): FastifyInstance & { clicks: ClickQueue } {
  const { pool, baseUrl } = options;
  const ownHost = new URL(baseUrl).host;
  const app = Fastify({ logger: false, trustProxy: true });
  const clicks = new ClickQueue(pool, options.clickFlushMs ?? 2000);
  const recent = new RecentLinks();
  // a shortener without a limit turns into a free tool for spam
  const limit = new RateLimit(options.linksPer10Min ?? 20, 10 * 60_000);

  const view = (link: Link) => ({
    code: link.code,
    shortUrl: `${baseUrl}/${link.code}`,
    url: link.url,
    createdAt: link.created_at,
    clicks: Number(link.clicks),
  });

  app.register(fastifyStatic, { root: PUBLIC, prefix: '/assets/' });
  app.get('/', (_req, reply) => reply.sendFile('index.html'));

  // for the host's health check and the ping that keeps the free instance awake
  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  app.get('/api/config', async () => ({ examples: options.demo ? DEMO_LINKS.map((l) => l.code) : [] }));

  app.post<{ Body: { url?: unknown; alias?: unknown } }>('/api/links', async (req, reply) => {
    const wait = limit.take(req.ip);
    if (wait) {
      const minutes = Math.ceil(wait / 60_000);
      return reply.code(429).header('Retry-After', Math.ceil(wait / 1000))
        .send({ error: `That's a lot of links in a short time. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
    }
    const body = req.body ?? {};
    const url = checkUrl(typeof body.url === 'string' ? body.url : '', ownHost);
    if (!url.ok) return reply.code(400).send({ error: url.error });

    if (typeof body.alias === 'string' && body.alias.trim()) {
      const alias = checkAlias(body.alias);
      if (!alias.ok) return reply.code(400).send({ error: alias.error });
      const { rows } = await pool.query<Link>(
        'INSERT INTO links (code, url) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING *',
        [alias.value, url.value],
      );
      if (!rows[0]) return reply.code(409).send({ error: `"${alias.value}" is taken, try another name.` });
      return reply.code(201).send(view(rows[0]));
    }

    // a collision among 34 billion codes is rare, but it's one line to try again
    for (let attempt = 0; attempt < 5; attempt++) {
      const { rows } = await pool.query<Link>(
        'INSERT INTO links (code, url) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING *',
        [randomCode(), url.value],
      );
      if (rows[0]) return reply.code(201).send(view(rows[0]));
    }
    return reply.code(503).send({ error: 'Could not make a code right now, try again.' });
  });

  app.get<{ Params: { code: string }; Querystring: { days?: string } }>('/api/links/:code', async (req, reply) => {
    const { rows } = await pool.query<Link>('SELECT * FROM links WHERE code = $1', [req.params.code.toLowerCase()]);
    const link = rows[0];
    if (!link) return reply.code(404).send({ error: 'No short link with this name.' });
    // the clicks still waiting in the queue would make the numbers look behind
    await clicks.flush();
    const fresh = (await pool.query<Link>('SELECT * FROM links WHERE id = $1', [link.id])).rows[0]!;
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    return { ...view(fresh), stats: await linkStats(pool, fresh.id, Number(fresh.clicks), days, options.timezone) };
  });

  // a QR code of the short link, for a poster or a menu on the table. The short link is
  // what goes in it, so the clicks from the QR are counted too
  app.get<{ Params: { code: string } }>('/api/links/:code/qr.svg', async (req, reply) => {
    const { rows } = await pool.query<{ code: string }>('SELECT code FROM links WHERE code = $1', [req.params.code.toLowerCase()]);
    if (!rows[0]) return reply.code(404).send({ error: 'No short link with this name.' });
    const svg = await QRCode.toString(`${baseUrl}/${rows[0].code}`, {
      type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#161513', light: '#ffffff' },
    });
    return reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400').send(svg);
  });

  app.get<{ Params: { code: string } }>('/:code', async (req, reply) => {
    const code = req.params.code.toLowerCase();
    let link = recent.get(code);
    if (!link) {
      const { rows } = await pool.query<{ id: string; url: string }>('SELECT id, url FROM links WHERE code = $1', [code]);
      if (!rows[0]) return reply.code(404).type('text/html').send(notFoundPage(baseUrl));
      link = { id: Number(rows[0].id), url: rows[0].url };
      recent.set(code, link);
    }

    const ua = req.headers['user-agent'];
    if (!isBot(ua)) {
      clicks.add({ linkId: link.id, at: new Date(), referrer: referrerOf(req.headers.referer), device: deviceOf(ua!), browser: browserOf(ua!) });
    }
    // 302 and not 301: a browser keeps a 301 forever and stops asking, so later clicks
    // wouldn't be counted (and the link could never point somewhere else)
    return reply.header('Cache-Control', 'private, max-age=0').redirect(link.url, 302);
  });

  app.addHook('onClose', async () => {
    await clicks.flush();
  });

  return Object.assign(app, { clicks });
}

function notFoundPage(baseUrl: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not found</title><link rel="stylesheet" href="/assets/styles.css"></head>
<body><main class="wrap missing"><p class="kicker">404</p><h1>This short link doesn't exist.</h1>
<p>It may have been typed wrong. <a href="${baseUrl}/">Make a new one</a></p></main></body></html>`;
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { browserOf, deviceOf, isBot, referrerOf } from '../src/clicks.ts';
import { RateLimit } from '../src/limits.ts';
import { checkAlias, checkUrl, randomCode } from '../src/links.ts';
import { startDatabase } from './db.ts';

const BASE = 'http://sho.rt';
const CHROME_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const FIREFOX_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';

let db: Awaited<ReturnType<typeof startDatabase>>;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  db = await startDatabase();
  // clicks only go to the database when the test flushes them
  app = buildApp({ pool: db.pool, baseUrl: BASE, clickFlushMs: 0 });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(async () => {
  // clicks left in the queue by the test before would land on the new links (ids restart at 1)
  await app.clicks.flush();
  await db.clear();
});

const shorten = (body: object) => app.inject({ method: 'POST', url: '/api/links', payload: body });
const visit = (code: string, headers: Record<string, string> = { 'user-agent': FIREFOX_PC }) =>
  app.inject({ method: 'GET', url: `/${code}`, headers });

describe('making links', () => {
  it('shortens a link and redirects with 302', async () => {
    const res = await shorten({ url: 'https://example.com/a/very/long/path?with=query' });
    expect(res.statusCode).toBe(201);
    const link = res.json();
    expect(link.code).toMatch(/^[a-z2-9]{7}$/);
    expect(link.shortUrl).toBe(`${BASE}/${link.code}`);

    const hop = await visit(link.code);
    expect(hop.statusCode).toBe(302);
    expect(hop.headers.location).toBe('https://example.com/a/very/long/path?with=query');
  });

  it('adds https when it was left out', async () => {
    expect((await shorten({ url: 'example.com/page' })).json().url).toBe('https://example.com/page');
  });

  it('custom names, case insensitive, and taken ones are refused', async () => {
    expect((await shorten({ url: 'https://example.com', alias: 'Black-Friday' })).json().code).toBe('black-friday');
    expect((await visit('BLACK-friday')).statusCode).toBe(302);
    const taken = await shorten({ url: 'https://other.com', alias: 'black-friday' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toContain('taken');
  });

  it('refuses what would be dangerous or loop', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', `${BASE}/abc`, 'not a link', '']) {
      expect((await shorten({ url })).statusCode, url).toBe(400);
    }
    for (const alias of ['api', 'ab', 'has space', '-start', 'x'.repeat(33)]) {
      expect((await shorten({ url: 'https://example.com', alias })).statusCode, alias).toBe(400);
    }
  });

  it('one IP can only make so many links in a row', async () => {
    const strict = buildApp({ pool: db.pool, baseUrl: BASE, clickFlushMs: 0, linksPer10Min: 3 });
    const make = (ip: string) => strict.inject({ method: 'POST', url: '/api/links', payload: { url: 'https://example.com' }, remoteAddress: ip });
    for (let i = 0; i < 3; i++) expect((await make('10.0.0.1')).statusCode).toBe(201);
    const blocked = await make('10.0.0.1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toContain('Try again in 10 minutes');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(590);
    expect((await make('10.0.0.2')).statusCode).toBe(201);
    await strict.close();
  });

  it('gives a QR code of the short link', async () => {
    const { code } = (await shorten({ url: 'https://example.com', alias: 'menu' })).json();
    const qr = await app.inject({ method: 'GET', url: `/api/links/${code}/qr.svg` });
    expect(qr.statusCode).toBe(200);
    expect(qr.headers['content-type']).toContain('image/svg+xml');
    expect(qr.body).toMatch(/^<svg[\s\S]*<path/);
    expect((await app.inject({ method: 'GET', url: '/api/links/nope123/qr.svg' })).statusCode).toBe(404);
  });

  it('unknown codes get a 404 page', async () => {
    const res = await visit('nothere');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("doesn't exist");
  });
});

describe('counting clicks', () => {
  it('counts people, not link previews, and groups the stats', async () => {
    const { code } = (await shorten({ url: 'https://example.com' })).json();
    await visit(code, { 'user-agent': CHROME_PHONE, referer: 'https://www.instagram.com/p/123' });
    await visit(code, { 'user-agent': CHROME_PHONE, referer: 'https://www.instagram.com/' });
    await visit(code, { 'user-agent': FIREFOX_PC });
    // WhatsApp drawing the card, and a script
    await visit(code, { 'user-agent': 'WhatsApp/2.24.1 A' });
    await visit(code, { 'user-agent': 'curl/8.4.0' });

    const res = await app.inject({ method: 'GET', url: `/api/links/${code}` });
    const { clicks, stats } = res.json();
    expect(clicks).toBe(3);
    expect(stats.total).toBe(3);
    expect(stats.days).toHaveLength(30);
    expect(stats.days.at(-1).clicks).toBe(3);
    expect(stats.days.slice(0, -1).every((d: { clicks: number }) => d.clicks === 0)).toBe(true);
    expect(stats.referrers).toEqual([{ name: 'instagram.com', clicks: 2 }, { name: 'direct', clicks: 1 }]);
    expect(stats.devices).toEqual([{ name: 'phone', clicks: 2 }, { name: 'computer', clicks: 1 }]);
    expect(stats.browsers).toEqual([{ name: 'Chrome', clicks: 2 }, { name: 'Firefox', clicks: 1 }]);
  });

  it('a batch of clicks across links lands in one go', async () => {
    const a = (await shorten({ url: 'https://a.com' })).json().code;
    const b = (await shorten({ url: 'https://b.com' })).json().code;
    for (let i = 0; i < 25; i++) await visit(i % 5 === 0 ? b : a);
    await app.clicks.flush();
    const { rows } = await db.pool.query('SELECT url, clicks FROM links ORDER BY url');
    expect(rows.map((r) => [r.url, Number(r.clicks)])).toEqual([['https://a.com/', 20], ['https://b.com/', 5]]);
    expect((await db.pool.query('SELECT count(*) FROM clicks')).rows[0].count).toBe('25');
  });

  it('stats of a link that does not exist is a 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/links/nope123' })).statusCode).toBe(404);
  });
});

describe('small pieces', () => {
  it('random codes avoid look-alike characters', () => {
    const codes = Array.from({ length: 500 }, randomCode);
    expect(codes.join('')).not.toMatch(/[01lo]/);
    expect(new Set(codes).size).toBe(500);
  });

  it('reads the browser, device and referrer', () => {
    expect(browserOf('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge');
    expect(browserOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0) Safari')).toBe('tablet');
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(referrerOf('not a url')).toBeNull();
    expect(referrerOf('https://www.google.com/search?q=x')).toBe('google.com');
  });

  it('the limit counts per key and frees up as time passes', () => {
    let now = 0;
    const limit = new RateLimit(2, 1000, () => now);
    expect(limit.take('a')).toBe(0);
    expect(limit.take('a')).toBe(0);
    expect(limit.take('a')).toBe(1000);
    expect(limit.take('b')).toBe(0);
    now = 1001;
    expect(limit.take('a')).toBe(0);
  });

  it('checks links and names without a database', () => {
    expect(checkUrl('HTTPS://Example.com', 'sho.rt')).toEqual({ ok: true, value: 'https://example.com/' });
    expect(checkUrl('localhost:3000/x', 'sho.rt').ok).toBe(true);
    expect(checkAlias(' Promo ')).toEqual({ ok: true, value: 'promo' });
  });
});

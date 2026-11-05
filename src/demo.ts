import type pg from 'pg';

// a few links with a month of clicks, so the stats have something to show. Used by
// `npm run demo` and by the public demo (DEMO_SEED=true)
export const DEMO_LINKS = [
  { code: 'black-friday', url: 'https://www.example-store.com.br/promocoes/black-friday-2026?utm_source=instagram&utm_medium=bio', perDay: 40 },
  { code: 'cardapio', url: 'https://docs.example.com/cardapio-novembro-2026.pdf', perDay: 12 },
  { code: 'k7m2xqa', url: 'https://github.com/ViniciuscLemos/booking-system', perDay: 4 },
];
const REFERRERS = [['instagram.com', 5], ['google.com', 2], [null, 3], ['linkedin.com', 1], ['t.co', 1]] as const;
const SETUPS = [['phone', 'Chrome', 5], ['phone', 'Safari', 3], ['computer', 'Chrome', 3], ['computer', 'Edge', 1], ['tablet', 'Safari', 1]] as const;

/** Adds the demo links once; a database that already has them is left alone. */
export async function seedDemo(pool: pg.Pool): Promise<boolean> {
  const { rows: existing } = await pool.query('SELECT 1 FROM links WHERE code = $1', [DEMO_LINKS[0]!.code]);
  if (existing.length) return false;

  // the same "random" numbers every run, so screenshots don't change for no reason
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T extends readonly unknown[]>(options: readonly T[]): T => {
    const total = options.reduce((sum, o) => sum + (o.at(-1) as number), 0);
    let r = random() * total;
    for (const o of options) if ((r -= o.at(-1) as number) < 0) return o;
    return options[0]!;
  };

  for (const link of DEMO_LINKS) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO links (code, url, created_at) VALUES ($1, $2, now() - interval '30 days') RETURNING id`,
      [link.code, link.url],
    );
    const id = Number(rows[0]!.id);
    const clicks: [number, Date, string | null, string, string][] = [];
    for (let day = 29; day >= 0; day--) {
      // weekends and a spike in the middle, so the chart looks like a real month
      const date = new Date(Date.now() - day * 86_400_000);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const spike = day >= 12 && day <= 14 ? 3 : 1;
      const count = Math.round(link.perDay * spike * (weekend ? 0.6 : 1) * (0.5 + random()));
      for (let i = 0; i < count; i++) {
        const at = new Date(date.getTime() - random() * 12 * 3_600_000);
        const [referrer] = pick(REFERRERS);
        const [device, browser] = pick(SETUPS);
        clicks.push([id, at, referrer, device, browser]);
      }
    }
    await pool.query(
      `INSERT INTO clicks (link_id, clicked_at, referrer, device, browser)
       SELECT * FROM unnest($1::bigint[], $2::timestamptz[], $3::text[], $4::text[], $5::text[])`,
      [clicks.map((c) => c[0]), clicks.map((c) => c[1]), clicks.map((c) => c[2]), clicks.map((c) => c[3]), clicks.map((c) => c[4])],
    );
    await pool.query('UPDATE links SET clicks = $1 WHERE id = $2', [clicks.length, id]);
  }
  return true;
}

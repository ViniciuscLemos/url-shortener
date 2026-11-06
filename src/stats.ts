import type pg from 'pg';

export interface Stats {
  total: number;
  days: { day: string; clicks: number }[];
  referrers: { name: string; clicks: number }[];
  devices: { name: string; clicks: number }[];
  browsers: { name: string; clicks: number }[];
}

/**
 * Clicks of one link over the last `days` days, by day in the given timezone (a click at
 * 23:30 in São Paulo is already "tomorrow" in UTC). The days come from the daily summary;
 * the breakdowns go through the (link_id, clicked_at) index and only touch that link's
 * rows in the window.
 */
export async function linkStats(pool: pg.Pool, linkId: number, total: number, days = 30, tz = 'America/Sao_Paulo'): Promise<Stats> {
  const since = `now() - make_interval(days => $2)`;
  const [perDay, referrers, devices, browsers] = await Promise.all([
    // one row per day from link_days (kept by each batch of clicks), and generate_series
    // fills the days without clicks with 0, so the chart has no holes
    pool.query<{ day: string; clicks: string }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(s.clicks, 0) AS clicks
       FROM generate_series((now() AT TIME ZONE $3)::date - ($2 - 1), (now() AT TIME ZONE $3)::date, interval '1 day') AS d(day)
       LEFT JOIN link_days s ON s.link_id = $1 AND s.day = d.day::date
       ORDER BY d.day`,
      [linkId, days, tz],
    ),
    top(pool, `COALESCE(referrer, 'direct')`, linkId, days, since),
    top(pool, 'device', linkId, days, since),
    top(pool, 'browser', linkId, days, since),
  ]);
  return {
    total,
    days: perDay.rows.map((r) => ({ day: r.day, clicks: Number(r.clicks) })),
    referrers: referrers,
    devices,
    browsers,
  };
}

// column is one of the fixed expressions above, never something that came from a request
async function top(pool: pg.Pool, column: string, linkId: number, days: number, since: string) {
  const { rows } = await pool.query<{ name: string; clicks: string }>(
    `SELECT ${column} AS name, count(*) AS clicks
     FROM clicks WHERE link_id = $1 AND clicked_at > ${since}
     GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`,
    [linkId, days],
  );
  return rows.map((r) => ({ name: r.name, clicks: Number(r.clicks) }));
}

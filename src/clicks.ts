import type pg from 'pg';

export interface Click {
  linkId: number;
  at: Date;
  referrer: string | null;
  device: string;
  browser: string;
}

// link previews (WhatsApp, Slack, Telegram...) open the link to draw the card. That isn't
// a person clicking, so it doesn't count
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|python-requests|headless/i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || BOTS.test(userAgent);
}

export function deviceOf(ua: string): string {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'phone';
  return 'computer';
}

// the order matters: Edge and Opera also say "Chrome", Chrome also says "Safari"
export function browserOf(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}

/** Just the site that sent the visitor ("instagram.com"), or null when it came straight. */
export function referrerOf(header: string | undefined): string | null {
  if (!header) return null;
  try {
    return new URL(header).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * The redirect shouldn't wait for an INSERT. Clicks wait here and go to the database in
 * batches: one INSERT for many rows and one UPDATE per link for the totals, every
 * `everyMs` or as soon as `maxBatch` are waiting.
 */
export class ClickQueue {
  private waiting: Click[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(private pool: pg.Pool, private everyMs = 2000, private maxBatch = 200, private tz = 'America/Sao_Paulo') {}

  add(click: Click): void {
    this.waiting.push(click);
    if (this.waiting.length >= this.maxBatch) void this.flush();
    else if (!this.timer && this.everyMs > 0) this.timer = setTimeout(() => void this.flush(), this.everyMs);
  }

  /** Writes what is waiting. Calls in a row wait for each other, so batches never overlap. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.waiting;
    this.waiting = [];
    this.flushing = this.flushing.then(() => (batch.length ? this.write(batch) : undefined));
    return this.flushing;
  }

  private async write(batch: Click[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // unnest turns the arrays back into rows: the whole batch in a single statement
      await client.query(
        // a link deleted while its clicks waited here is skipped, instead of failing the whole batch
        `INSERT INTO clicks (link_id, clicked_at, referrer, device, browser)
         SELECT c.* FROM unnest($1::bigint[], $2::timestamptz[], $3::text[], $4::text[], $5::text[]) AS c(link_id, at, r, d, b)
         WHERE EXISTS (SELECT 1 FROM links l WHERE l.id = c.link_id)`,
        [batch.map((c) => c.linkId), batch.map((c) => c.at), batch.map((c) => c.referrer),
          batch.map((c) => c.device), batch.map((c) => c.browser)],
      );
      const perLink = new Map<number, number>();
      for (const c of batch) perLink.set(c.linkId, (perLink.get(c.linkId) ?? 0) + 1);
      await client.query(
        `UPDATE links SET clicks = links.clicks + n.count
         FROM unnest($1::bigint[], $2::bigint[]) AS n(id, count) WHERE links.id = n.id`,
        [[...perLink.keys()], [...perLink.values()]],
      );
      // and the day's count, which is what the chart reads
      await client.query(
        `INSERT INTO link_days (link_id, day, clicks)
         SELECT link_id, (at AT TIME ZONE $3)::date, count(*)
         FROM unnest($1::bigint[], $2::timestamptz[]) AS c(link_id, at)
         WHERE EXISTS (SELECT 1 FROM links l WHERE l.id = c.link_id) GROUP BY 1, 2
         ON CONFLICT (link_id, day) DO UPDATE SET clicks = link_days.clicks + EXCLUDED.clicks`,
        [batch.map((c) => c.linkId), batch.map((c) => c.at), this.tz],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // losing a few clicks is better than taking the redirects down with it
      console.error(`Lost ${batch.length} click(s):`, err);
    } finally {
      client.release();
    }
  }
}

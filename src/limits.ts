/**
 * At most `max` actions per key (an IP) in the last `windowMs`. Kept in memory, which is
 * fine for one server; with more than one it would move to Redis or the database.
 */
export class RateLimit {
  private hits = new Map<string, number[]>();

  constructor(private max: number, private windowMs: number, private now = () => Date.now()) {}

  /** Records the action and returns 0, or returns how many ms to wait when over the limit. */
  take(key: string): number {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return recent[0]! + this.windowMs - now;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // a big map of IPs that came once and left would only grow, so it gets swept now and then
    if (this.hits.size > 10_000) this.sweep(now);
    return 0;
  }

  private sweep(now: number) {
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > now - this.windowMs)) this.hits.delete(key);
    }
  }
}

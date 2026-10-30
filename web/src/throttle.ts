/**
 * Visual flow control. A real UDM stream runs 10-100+ events/sec, so on-screen
 * effects must not be 1:1: the HUD log and meters see every event, while a
 * theme asks `allow(key, window)` before drawing and gets one yes per key per
 * window (e.g. one block effect per src|dst|port every 3s).
 */
const MAX_KEYS = 4000;
const RETENTION_MS = 120_000;
const CLEANUP_MS = 1000;

export class Throttle {
  private seen = new Map<string, number>();
  private nextCleanup = 0;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  allow(key: string, windowS: number): boolean {
    const now = this.clock();
    const last = this.seen.get(key);
    if (last !== undefined && now - last < windowS * 1000) return false;
    this.seen.set(key, now);
    if (this.seen.size > MAX_KEYS && now >= this.nextCleanup) {
      this.nextCleanup = now + CLEANUP_MS;
      for (const [k, t] of this.seen) if (now - t > RETENTION_MS) this.seen.delete(k);
    }
    return true;
  }
}

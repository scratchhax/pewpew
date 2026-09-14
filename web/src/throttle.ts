/**
 * Visual flow control. A real UDM stream runs 10-100+ events/sec, so on-screen
 * effects must not be 1:1: the HUD log and meters see every event, while a
 * theme asks `allow(key, window)` before drawing and gets one yes per key per
 * window (e.g. one block effect per src|dst|port every 3s).
 */
export class Throttle {
  private seen = new Map<string, number>();

  allow(key: string, windowS: number): boolean {
    const now = performance.now() / 1000;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < windowS) return false;
    this.seen.set(key, now);
    if (this.seen.size > 4000) {
      for (const [k, t] of this.seen) if (now - t > 120) this.seen.delete(k);
    }
    return true;
  }
}

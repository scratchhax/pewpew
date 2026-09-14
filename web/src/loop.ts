/**
 * The one frame loop, owned by the core so every theme (whatever renderer it
 * uses) gets the same FPS cap, auto-quality tuner and debug stats.
 *
 * The cap mirrors PixiJS's Ticker.maxFPS: a frame is skipped until at least
 * 1000/cap ms have passed, and the leftover phase is carried so a 60 cap on a
 * 60Hz display doesn't drop to 30.
 */
export class FrameLoop {
  private raf = 0;
  private last = 0;          // time of the last frame that ran
  private lastFrame = 0;     // phase anchor for the cap
  private minMs = 0;

  constructor(private onFrame: (now: number, elapsedMs: number) => void) {}

  set maxFps(fps: number) { this.minMs = fps > 0 ? 1000 / fps : 0; }

  start(): void {
    if (this.raf) return;
    this.last = this.lastFrame = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.minMs) {
        const delta = (now - this.lastFrame) | 0;
        if (delta < this.minMs) return;
        this.lastFrame = now - (delta % this.minMs);
      }
      const elapsed = now - this.last;
      this.last = now;
      this.onFrame(now, elapsed);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

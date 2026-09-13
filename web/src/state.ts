export type Weather = 'calm' | 'storm' | 'hurricane';

/** Global sim state: threat, energy, event-rate driven weather. */
export class State {
  threat = 0.15;          // 0..1
  energy = 0.3;           // 0..1
  heat = 0;               // transient, decays
  weather: Weather = 'calm';
  timeScale = 1;          // bullet-time multiplier (lerps back to 1)

  slowmo(scale = 0.25, hold = 0.7): void {
    this.timeScale = Math.min(this.timeScale, scale);
    this.slowmoHold = hold;
  }
  private slowmoHold = 0;

  private stamps: number[] = [];  // recent event timestamps (ms)
  private blockStamps: number[] = [];
  private threatStamps: number[] = [];

  get rate30s(): number {
    const cutoff = performance.now() - 30_000;
    while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
    return this.stamps.length;
  }

  private blocks30s(): number {
    const cutoff = performance.now() - 30_000;
    while (this.blockStamps.length && this.blockStamps[0] < cutoff) this.blockStamps.shift();
    return this.blockStamps.length;
  }

  private threats30s(): number {
    const cutoff = performance.now() - 30_000;
    while (this.threatStamps.length && this.threatStamps[0] < cutoff) this.threatStamps.shift();
    return this.threatStamps.length;
  }

  onEvent(kind: 'allow' | 'block' | 'net' | 'wifi-good' | 'wifi-bad' | 'system' | 'threat'): void {
    const now = performance.now();
    this.stamps.push(now);
    if (kind === 'block') {
      this.blockStamps.push(now);
      this.heat = Math.min(1, this.heat + 0.12);
    } else if (kind === 'threat') {
      this.threatStamps.push(now);
      this.heat = Math.min(1, this.heat + 0.06);
    } else if (kind === 'wifi-bad') {
      this.heat = Math.min(1, this.heat + 0.04);
    }
  }

  update(dtReal: number): void {
    if (this.slowmoHold > 0) {
      this.slowmoHold -= dtReal;
    } else {
      this.timeScale += (1 - this.timeScale) * Math.min(1, dtReal * 3);
    }

    // Real UDM streams run 10-100+ events/sec: meters follow sustained
    // 30s windows (fast attack, slow release) instead of per-event bumps.
    const dt = dtReal * this.timeScale;
    const blocks = this.blocks30s();
    // IDS/IPS detections are more alarming than routine denies, so they nudge
    // threat pressure up on their own (0.4 weight) without inflating deny stats.
    const threats = this.threats30s();
    const threatTarget = clamp01((blocks + threats * 0.4) / 450);
    const energyTarget = clamp01(0.2 + (this.rate30s - blocks) / 1500);
    const attack = threatTarget > this.threat ? 1.2 : 0.06;
    this.threat += (threatTarget - this.threat) * Math.min(1, dt * attack);
    this.energy += (energyTarget - this.energy) * Math.min(1, dt * 0.12);
    this.energy = Math.max(0.15, this.energy);
    this.heat = Math.max(0, this.heat - dt * 0.25);

    const r = this.rate30s;
    this.weather = r >= 1200 ? 'hurricane' : r >= 300 ? 'storm' : 'calm';
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** RFC1918 / loopback / CGNAT — anything "inside the perimeter" for visuals. */
export function isInternalIp(ip?: string | null): boolean {
  if (!ip) return false;
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('127.')) return true;
  if (ip.startsWith('100.64.')) return true;   // CGNAT / WireGuard peers
  return /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** Deterministic hash → [0, 1). Cheap FNV-ish string hash. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function ipAngle(ip: string): number {
  return hash01(ip) * Math.PI * 2;
}

/**
 * A point just OUTSIDE the visible viewport along a bearing from (cx,cy).
 * Spawning inbound actors here (rather than at a fixed large radius) keeps
 * them on screen for essentially their whole flight on any aspect ratio —
 * the old max(w,h)*0.55 approach dropped them far off-screen on wide displays.
 */
export function edgePoint(cx: number, cy: number, w: number, h: number,
                          angle: number, pad = 1.06): { x: number; y: number } {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const ray = (d: number, pos: number, neg: number) =>
    d > 1e-4 ? pos / d : d < -1e-4 ? neg / -d : Infinity;
  const t = Math.min(ray(dx, w - cx, cx), ray(dy, h - cy, cy));
  const r = (isFinite(t) ? t : Math.max(w, h)) * pad;
  return { x: cx + dx * r, y: cy + dy * r };
}

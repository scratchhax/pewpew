import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { hash01 } from '../state';
import type { Fx } from './fx';

interface Ripple { r: number; color: number; }

interface ApCore {
  host: string;
  root: Container;
  body: Sprite;
  label: Text;
  ringG: Graphics;
  ripples: Ripple[];      // active ripple radii, colored by event type
  activity: number;       // 0..1, decays
  lastEvent: number;      // ms since last event at this core
  fade: number;           // 0..1 opacity (idles out after ~1 min)
  driftPhase: number;
  baseX: number; baseY: number;
  clientCount: number;
}

const HEX_COLOR_GREEN = 0x45ff9b;
const HEX_COLOR_YELLOW = 0xffd24a;
const HEX_COLOR_RED = 0xff5a5a;

const LABEL_STYLE = new TextStyle({
  fill: 0x9fdcff, fontFamily: 'monospace', fontSize: 12,
});

/** Floating access-point cores: one per syslog hostname, pulsing on activity. */
export class ApCores {
  private cores = new Map<string, ApCore>();

  constructor(private layer: Container, private glow: Texture, private fx: Fx,
              private w: number, private h: number) {}

  private makeCore(host: string): ApCore {
    const h = hash01(host);
    const angle = h * Math.PI * 2;
    const dist = Math.min(this.w, this.h) * (0.3 + hash01(host + 'r') * 0.15);
    const baseX = this.w / 2 + Math.cos(angle) * dist;
    const baseY = this.h / 2 + Math.sin(angle) * dist * 0.7;

    const root = new Container();
    root.x = baseX; root.y = baseY;

    const halo = new Sprite(this.glow);
    halo.anchor.set(0.5);
    halo.scale.set(1.1);
    halo.tint = HEX_COLOR_GREEN;
    halo.alpha = 0.35;

    const body = new Sprite(this.glow);
    body.anchor.set(0.5);
    body.scale.set(0.38);
    body.tint = HEX_COLOR_GREEN;

    const ringG = new Graphics();
    ringG.poly(hexPoints(22)).stroke({ width: 2, color: HEX_COLOR_GREEN, alpha: 0.9 });

    const label = new Text({ text: host, style: LABEL_STYLE });
    label.anchor.set(0.5, 0);
    label.y = 26;

    root.addChild(halo, ringG, body, label);
    this.layer.addChild(root);

    return {
      host, root, body, label, ringG,
      ripples: [], activity: 0, driftPhase: h * 10,
      baseX, baseY, clientCount: 0,
      lastEvent: performance.now(), fade: 1,
    };
  }

  event(host: string, kind: 'good' | 'bad' | 'info', color?: number): void {
    let core = this.cores.get(host);
    if (!core) {
      core = this.makeCore(host);
      this.cores.set(host, core);
    }
    core.activity = Math.min(1, core.activity + (kind === 'bad' ? 0.5 : 0.25));
    core.lastEvent = performance.now();
    const c = color ?? (kind === 'bad' ? HEX_COLOR_RED : HEX_COLOR_GREEN);
    core.ripples.push({ r: 1, color: c });
    this.fx.emit(core.root.x, core.root.y, c, kind === 'bad' ? 8 : 5,
      kind === 'bad' ? 60 : 40, 0.18, 0.55);
  }

  clients(host: string, delta: number): void {
    const c = this.cores.get(host);
    if (c) c.clientCount = Math.max(0, c.clientCount + delta);
  }

  /** Screen position of a host core (for crystals travelling to it). */
  positionOf(host: string): { x: number; y: number } | null {
    const c = this.cores.get(host);
    return c ? { x: c.root.x, y: c.root.y } : null;
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  update(dt: number): void {
    for (const c of this.cores.values()) {
      // idle cores fade out after ~60s of silence, back on with any event
      const idle = (performance.now() - c.lastEvent) / 1000;
      const target = idle > 60 ? 0 : 1;
      c.fade += (target - c.fade) * Math.min(1, dt * 0.35);
      c.root.alpha = c.fade;
      c.root.visible = c.fade > 0.01;

      c.activity = Math.max(0, c.activity - dt * 0.15);
      c.driftPhase += dt * 0.4;
      c.root.x = c.baseX + Math.cos(c.driftPhase) * 10;
      c.root.y = c.baseY + Math.sin(c.driftPhase * 0.8) * 7;

      const col = c.activity > 0.66 ? HEX_COLOR_RED
        : c.activity > 0.33 ? HEX_COLOR_YELLOW : HEX_COLOR_GREEN;
      c.body.tint = col;
      c.body.scale.set(0.38 + c.activity * 0.25);

      // redraw ring + ripples
      c.ringG.clear();
      c.ringG.poly(hexPoints(22)).stroke({ width: 2, color: col, alpha: 0.6 + c.activity * 0.4 });
      for (let i = c.ripples.length - 1; i >= 0; i--) {
        const rp = c.ripples[i];
        rp.r += dt * 46;
        const alpha = Math.max(0, 1 - rp.r / 60);
        if (alpha <= 0) { c.ripples.splice(i, 1); continue; }
        c.ringG.circle(0, 0, 22 + rp.r)
          .stroke({ width: 1.5, color: rp.color, alpha });
      }
    }
  }
}

function hexPoints(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}

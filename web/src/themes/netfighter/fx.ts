import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * The juice: comic-book hit popups, damage numbers, spark bursts and the
 * big banners between rounds. Everything is world-space (it rides the
 * camera) except the banners, which sit on the screen.
 */

const POWS = ['POW!', 'BAM!', 'ZAP!', 'WHAM!', 'CRACK!', 'BOOM!'];

export interface FxOpts {
  color?: number;
  size?: number;
  rise?: number;
  spin?: number;
  life?: number;
}

export class Fx {
  readonly world = new Container();
  readonly screen = new Container();
  private items: { node: Container | Text; life: number; max: number; rise: number; spin: number; pop: number; banner?: boolean }[] = [];

  pop(x: number, y: number, text: string, o: FxOpts = {}): void {
    const style = new TextStyle({
      fontFamily: '"Courier New", monospace',
      fontSize: o.size ?? 34,
      fontWeight: '900',
      fill: o.color ?? 0xffe14d,
      stroke: { color: 0x14100a, width: (o.size ?? 34) / 5 },
    });
    const t = new Text({ text, style });
    t.anchor.set(0.5, 1);
    t.x = x;
    t.y = y;
    this.world.addChild(t);
    this.items.push({ node: t, life: o.life ?? 0.8, max: o.life ?? 0.8, rise: o.rise ?? 70, spin: o.spin ?? 0.5, pop: 1 });
  }

  pow(x: number, y: number, big = false): void {
    this.pop(x, y, POWS[(Math.random() * POWS.length) | 0], {
      color: big ? 0xff5a3c : 0xffe14d,
      size: big ? 56 : 38,
      spin: (Math.random() - 0.5) * 1.2,
      life: 0.7,
    });
  }

  damage(x: number, y: number, dmg: number): void {
    this.pop(x, y, `-${dmg}`, { color: 0xffffff, size: 24, rise: 90, spin: 0, life: 0.6 });
  }

  spark(x: number, y: number, color = 0xfff2a8, big = false): void {
    const g = new Graphics();
    const n = big ? 10 : 6;
    const r = big ? 46 : 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      g.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25).lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke({ width: big ? 5 : 3, color });
    g.x = x;
    g.y = y;
    this.world.addChild(g);
    this.items.push({ node: g, life: 0.22, max: 0.22, rise: 0, spin: 2, pop: 0.4 });
  }

  banner(text: string, color = 0xffe14d, hold = 1.1): void {
    const style = new TextStyle({
      fontFamily: '"Courier New", monospace',
      fontSize: 92,
      fontWeight: '900',
      fill: color,
      stroke: { color: 0x14100a, width: 14 },
    });
    const t = new Text({ text, style });
    t.anchor.set(0.5);
    this.screen.addChild(t);
    this.items.push({ node: t, life: hold, max: hold, rise: 0, spin: 0, pop: 2, banner: true });
  }

  update(dt: number, sw: number, sh: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      const node = it.node as Text;
      const banner = it.banner;
      if (banner) {
        node.x = sw / 2;
        node.y = sh * 0.4;
        const inK = Math.min(1, (it.max - it.life) * 8);
        const s = (0.3 + 0.7 * inK) * (k < 0.25 ? k / 0.25 : 1);
        node.scale.set(Math.max(0.001, s));
        node.alpha = 1;
      } else {
        node.y -= it.rise * dt;
        node.rotation += it.spin * dt;
        node.alpha = Math.min(1, k * 2);
        if (it.pop > 0) {
          const age = it.max - it.life;
          node.scale.set(1 + Math.max(0, 0.6 - age * 4));
        }
      }
      if (it.life <= 0) {
        it.node.destroy();
        this.items.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const it of this.items) it.node.destroy();
    this.items = [];
  }
}

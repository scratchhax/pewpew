import { Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';

interface Planet {
  root: Container;
  sphere: Sprite;
  label: Text;
  vx: number; vy: number;
  life: number; max: number;
}

const MAX_PLANETS = 18;
const BASE_SPEED = 24;

const LABEL_STYLE = new TextStyle({
  fill: 0xcfe3ff, fontFamily: 'monospace', fontSize: 11,
});

/**
 * DHCP leases as small shaded planets that drift across the screen with the
 * client hostname labelled underneath, fading in/out.
 */
export class Planets {
  private list: Planet[] = [];

  constructor(private layer: Container, private texs: Texture[],
              private w: number, private h: number) {}

  spawn(color: number, label: string): void {
    if (this.list.length >= MAX_PLANETS) {
      const oldest = this.list.shift();
      if (oldest) {
        this.layer.removeChild(oldest.root);
        oldest.root.destroy({ children: true });
      }
    }

    // travel vector: any direction; spawn off-screen on the inbound side
    const th = Math.random() * Math.PI * 2;
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.hypot(this.w, this.h) * 0.62;
    const off = (Math.random() - 0.5) * Math.min(this.w, this.h) * 0.9;
    const root = new Container();
    root.x = cx - Math.cos(th) * R - Math.sin(th) * off;
    root.y = cy - Math.sin(th) * R + Math.cos(th) * off;

    const sphere = new Sprite(this.texs[(Math.random() * this.texs.length) | 0]);
    sphere.anchor.set(0.5);
    sphere.tint = color;
    const sc = 0.65 + Math.random() * 0.5;
    sphere.scale.set(sc);

    const lab = new Text({ text: label, style: LABEL_STYLE });
    lab.anchor.set(0.5, 0);
    lab.y = sc * 26 + 8;

    root.addChild(sphere, lab);
    this.layer.addChild(root);

    const sp = BASE_SPEED * (0.6 + Math.random() * 1.0);
    const max = (2 * R + 140) / sp;    // seconds to cross
    this.list.push({
      root, sphere, label: lab,
      vx: Math.cos(th) * sp, vy: Math.sin(th) * sp,
      life: max, max,
    });
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.root.x += p.vx * dt;
      p.root.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.layer.removeChild(p.root);
        p.root.destroy({ children: true });
        this.list.splice(i, 1);
        continue;
      }
      const f = p.life / p.max;
      const alpha = Math.min(1, (1 - f) * 5) * (f < 0.35 ? f / 0.35 : 1);
      p.sphere.alpha = alpha;
      p.label.alpha = alpha * 0.85;
    }
  }
}

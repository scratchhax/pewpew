import { Container, Sprite, Texture } from 'pixi.js';

interface EvStar {
  root: Container;
  dot: Sprite;
  halo: Sprite;
  life: number; max: number;
  tw: number;
}

const MAX_STARS = 260;
const LIFE = 9;

/**
 * Faint colored stars that pop up at random map positions when AP events
 * happen — sized like constellation nodes, fading out over ~10 seconds.
 */
export class EventStars {
  private stars: EvStar[] = [];

  constructor(private layer: Container, private dot: Texture, private glow: Texture) {}

  spawn(x: number, y: number, color: number): void {
    if (this.stars.length >= MAX_STARS) {
      const oldest = this.stars.shift();
      if (oldest) {
        this.layer.removeChild(oldest.root);
        oldest.root.destroy({ children: true });
      }
    }

    const root = new Container();
    root.x = x; root.y = y;

    const halo = new Sprite(this.glow);
    halo.anchor.set(0.5);
    halo.tint = color;
    halo.alpha = 0.8;
    halo.scale.set(1.2);
    halo.blendMode = 'add';

    const dot = new Sprite(this.dot);
    dot.anchor.set(0.5);
    dot.tint = color;
    dot.scale.set(0.95 + Math.random() * 0.55);
    dot.blendMode = 'add';

    root.addChild(halo, dot);
    this.layer.addChild(root);

    const max = LIFE + Math.random() * 4;
    this.stars.push({ root, dot, halo, life: max, max, tw: Math.random() * Math.PI * 2 });
  }

  update(dt: number): void {
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.layer.removeChild(s.root);
        s.root.destroy({ children: true });
        this.stars.splice(i, 1);
        continue;
      }
      s.tw += dt * 3;
      const fade = Math.pow(s.life / s.max, 0.85) * (0.92 + 0.08 * Math.sin(s.tw));
      s.dot.alpha = fade;
      s.halo.alpha = fade * 0.75;
    }
  }
}

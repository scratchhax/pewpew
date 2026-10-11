import { Assets, Rectangle, Texture } from 'pixi.js';
import girlIdle from './assets/sheets/girl_idle.png';
import girlWalk from './assets/sheets/girl_walk.png';
import girlJab from './assets/sheets/girl_jab.png';
import girlPunch from './assets/sheets/girl_punch.png';
import girlKick from './assets/sheets/girl_kick.png';
import girlJump from './assets/sheets/girl_jump.png';
import girlJumpkick from './assets/sheets/girl_jumpkick.png';
import girlDivekick from './assets/sheets/girl_divekick.png';
import girlHurt from './assets/sheets/girl_hurt.png';
import punkIdle from './assets/sheets/punk_idle.png';
import punkWalk from './assets/sheets/punk_walk.png';
import punkPunch from './assets/sheets/punk_punch.png';
import punkHurt from './assets/sheets/punk_hurt.png';
import stageBack from './assets/stage/back.png';
import stageFore from './assets/stage/fore.png';
import stageTileset from './assets/stage/tileset.png';

/**
 * The Net Fighter's sprites: Luis Zuno's "Streets of Fight" pack (CC0),
 * horizontal strips of 96x63 frames. Every animation is one PNG; we slice
 * them into Texture arrays once at startup. Both fighters are drawn facing
 * right - the one on the left wears a negative scale.
 */

export const FW = 96;
export const FH = 63;

const SHEETS = {
  girl_idle: [girlIdle, 4],
  girl_walk: [girlWalk, 10],
  girl_jab: [girlJab, 3],
  girl_punch: [girlPunch, 3],
  girl_kick: [girlKick, 5],
  girl_jump: [girlJump, 4],
  girl_jumpkick: [girlJumpkick, 3],
  girl_divekick: [girlDivekick, 5],
  girl_hurt: [girlHurt, 2],
  punk_idle: [punkIdle, 4],
  punk_walk: [punkWalk, 4],
  punk_punch: [punkPunch, 3],
  punk_hurt: [punkHurt, 4],
} as const;

export type SheetName = keyof typeof SHEETS;
export type FighterName = 'girl' | 'punk';

export interface FightTextures {
  anim(fighter: FighterName, anim: string): Texture[];
  back: Texture;
  fore: Texture;
  tileset: Texture;
}

export async function loadFightTextures(): Promise<FightTextures> {
  const urls: Record<string, string> = { back: stageBack, fore: stageFore, tileset: stageTileset };
  for (const [name, [url]] of Object.entries(SHEETS)) urls[name] = url as string;
  const list = [...new Set(Object.values(urls))];
  const loaded = await Assets.load<string>(list) as unknown as Record<string, Texture>;
  const byUrl = new Map<string, Texture>(Object.entries(loaded));
  const cache = new Map<string, Texture[]>();
  return {
    anim(fighter, anim) {
      const key = `${fighter}_${anim}`;
      let frames = cache.get(key);
      if (!frames) {
        const [url, n] = SHEETS[key as SheetName];
        const base = byUrl.get(url as string)!;
        frames = [];
        for (let i = 0; i < n; i++) {
          frames.push(new Texture({ source: base.source, frame: new Rectangle(i * FW, 0, FW, FH) }));
        }
        cache.set(key, frames);
      }
      return frames;
    },
    back: byUrl.get(stageBack)!,
    fore: byUrl.get(stageFore)!,
    tileset: byUrl.get(stageTileset)!,
  };
}

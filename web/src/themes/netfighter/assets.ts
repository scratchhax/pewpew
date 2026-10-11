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
import renIdle from './assets/sheets/ren_idle.png';
import renWalk from './assets/sheets/ren_walk.png';
import renPunch1 from './assets/sheets/ren_punch1.png';
import renPunch2 from './assets/sheets/ren_punch2.png';
import renKick1 from './assets/sheets/ren_kick1.png';
import renKick2 from './assets/sheets/ren_kick2.png';
import renHeadbutt from './assets/sheets/ren_headbutt.png';
import renHurt from './assets/sheets/ren_hurt.png';
import solIdle from './assets/sheets/sol_idle.png';
import solWalk from './assets/sheets/sol_walk.png';
import solPunch1 from './assets/sheets/sol_punch1.png';
import solPunch2 from './assets/sheets/sol_punch2.png';
import solKick1 from './assets/sheets/sol_kick1.png';
import solKick2 from './assets/sheets/sol_kick2.png';
import solJumpkick from './assets/sheets/sol_jumpkick.png';
import solCombo from './assets/sheets/sol_combo.png';
import solHurt from './assets/sheets/sol_hurt.png';
import stageBack from './assets/stage/back.png';
import stageFore from './assets/stage/fore.png';
import stageTileset from './assets/stage/tileset.png';

/**
 * The Net Fighter's sprites. The headliners are Luis Zuno's "Streets of
 * Fight" pack (CC0): horizontal strips of 96x63 frames. The guest
 * challengers are Chasersgaming's "Renegade" and "Soldier" brawler assets
 * (also CC0): 16x32 NES sprites, so they are drawn at 6x instead of 3.5x
 * and their frames are foot-aligned into one common box. Every animation
 * is one PNG sliced into Texture arrays once at startup; challengers are
 * the same sheets through a hue rotation.
 */

export type CharName = 'girl' | 'punk' | 'ren' | 'sol';

interface Src { url: string; n: number; }
type AnimDef = Src[];

const SHEET_W: Record<CharName, number> = { girl: 96, punk: 96, ren: 24, sol: 24 };
const SHEET_H: Record<CharName, number> = { girl: 63, punk: 63, ren: 32, sol: 32 };
export const CHAR_SCALE: Record<CharName, number> = { girl: 3.5, punk: 3.5, ren: 6, sol: 6 };
/** +1 when the sheets face right, -1 when they face left. */
export const CHAR_DIR: Record<CharName, 1 | -1> = { girl: 1, punk: -1, ren: 1, sol: 1 };

const ANIMS: Record<CharName, Record<string, AnimDef>> = {
  girl: {
    idle: [{ url: girlIdle, n: 4 }], walk: [{ url: girlWalk, n: 10 }],
    jab: [{ url: girlJab, n: 3 }], punch: [{ url: girlPunch, n: 3 }],
    kick: [{ url: girlKick, n: 5 }], jump: [{ url: girlJump, n: 4 }],
    jumpkick: [{ url: girlJumpkick, n: 3 }], divekick: [{ url: girlDivekick, n: 5 }],
    super: [{ url: girlDivekick, n: 5 }],
    hurt: [{ url: girlHurt, n: 2 }],
  },
  punk: {
    idle: [{ url: punkIdle, n: 4 }], walk: [{ url: punkWalk, n: 4 }],
    punch: [{ url: punkPunch, n: 3 }], super: [{ url: punkPunch, n: 3 }],
    hurt: [{ url: punkHurt, n: 4 }],
  },
  ren: {
    idle: [{ url: renIdle, n: 4 }], walk: [{ url: renWalk, n: 4 }],
    jab: [{ url: renPunch1, n: 1 }, { url: renPunch2, n: 1 }],
    punch: [{ url: renPunch1, n: 1 }, { url: renPunch2, n: 1 }],
    punch2: [{ url: renPunch1, n: 1 }, { url: renPunch2, n: 1 }],
    punch3: [{ url: renKick1, n: 1 }, { url: renKick2, n: 1 }],
    kick: [{ url: renKick1, n: 1 }, { url: renKick2, n: 1 }],
    jumpkick: [{ url: renKick2, n: 1 }],
    divekick: [{ url: renKick1, n: 1 }, { url: renKick2, n: 1 }],
    super: [{ url: renHeadbutt, n: 2 }],
    hurt: [{ url: renHurt, n: 1 }],
  },
  sol: {
    idle: [{ url: solIdle, n: 4 }], walk: [{ url: solWalk, n: 4 }],
    jab: [{ url: solPunch1, n: 1 }, { url: solPunch2, n: 1 }],
    punch: [{ url: solPunch1, n: 1 }, { url: solPunch2, n: 1 }],
    punch2: [{ url: solPunch1, n: 1 }, { url: solPunch2, n: 1 }],
    punch3: [{ url: solKick1, n: 1 }, { url: solKick2, n: 1 }],
    kick: [{ url: solKick1, n: 1 }, { url: solKick2, n: 1 }],
    jumpkick: [{ url: solJumpkick, n: 4 }],
    divekick: [{ url: solJumpkick, n: 4 }],
    super: [{ url: solCombo, n: 6 }],
    hurt: [{ url: solHurt, n: 1 }],
  },
};

export interface FightTextures {
  /** All animations of a character, hue-rotated (0 = original palette). */
  anims(char: CharName, hue: number): Record<string, Texture[]>;
  back: Texture;
  fore: Texture;
  tileset: Texture;
}

export async function loadFightTextures(): Promise<FightTextures> {
  const urls: string[] = [stageBack, stageFore, stageTileset];
  for (const defs of Object.values(ANIMS))
    for (const anim of Object.values(defs))
      for (const s of anim) if (!urls.includes(s.url)) urls.push(s.url);
  const loaded = await Assets.load<string>(urls) as unknown as Record<string, Texture>;
  const byUrl = new Map<string, Texture>(Object.entries(loaded));
  const cache = new Map<string, Record<string, Texture[]>>();

  const frameCanvasInner = (char: CharName, url: string, i: number): HTMLCanvasElement => {
    const base = byUrl.get(url)!;
    const img = base.source.resource as HTMLImageElement;
    const n = srcCount(url, char);
    const sw = img.width / n;
    const sh = img.height;
    const c = document.createElement('canvas');
    c.width = SHEET_W[char]; c.height = SHEET_H[char];
    const ctx = c.getContext('2d')!;
    if (char === 'girl' || char === 'punk') {
      ctx.drawImage(img, i * sw, 0, sw, sh, 0, 0, sw, sh);
      return c;
    }
    // NES guests: measure the frame's ink and drop it feet-centred in the box
    const m = document.createElement('canvas');
    m.width = sw; m.height = sh;
    const mc = m.getContext('2d')!;
    mc.drawImage(img, i * sw, 0, sw, sh, 0, 0, sw, sh);
    const d = mc.getImageData(0, 0, sw, sh).data;
    let x0 = sw, x1 = -1, y1 = -1;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++)
        if (d[(y * sw + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          y1 = y;
        }
    if (x1 < 0) return c;
    const cx = (x0 + x1) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(m, 0, 0, sw, sh, Math.round(SHEET_W[char] / 2 - cx), Math.round(SHEET_H[char] - 1 - (y1 + 1)), sw, sh);
    return c;
  };

  const srcCount = (url: string, char: CharName): number => {
    for (const anim of Object.values(ANIMS[char]))
      for (const s of anim) if (s.url === url) return s.n;
    return 1;
  };

  return {
    anims(char, hue) {
      const key = `${char}@${hue}`;
      let set = cache.get(key);
      if (!set) {
        set = {};
        for (const [anim, defs] of Object.entries(ANIMS[char])) {
          const frames: Texture[] = [];
          for (const s of defs) {
            for (let i = 0; i < s.n; i++) {
              const c = frameCanvasInner(char, s.url, i);
              if (hue === 0) {
                frames.push(Texture.from(c));
              } else {
                const h = document.createElement('canvas');
                h.width = c.width; h.height = c.height;
                const hc = h.getContext('2d')!;
                hc.filter = `hue-rotate(${hue}deg) saturate(1.15)`;
                hc.drawImage(c, 0, 0);
                frames.push(Texture.from(h));
              }
            }
          }
          set[anim] = frames;
        }
        cache.set(key, set);
      }
      return set;
    },
    back: byUrl.get(stageBack)!,
    fore: byUrl.get(stageFore)!,
    tileset: byUrl.get(stageTileset)!,
  };
}

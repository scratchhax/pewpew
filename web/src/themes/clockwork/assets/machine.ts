/**
 * Clockwork hero parts: LLM-generated stickers (see PROMPTS.md), chroma-keyed,
 * palette-quantised and packed by scripts/bake-clockwork.mjs.
 * frames[name] = [x, y, w, h] into machine.png, trimmed, at world scale.
 */
export const MACHINE_SIZE = [1024, 414] as const;
export const MACHINE_FRAMES: Record<string, number[]> = {"boiler":[0,0,368,328],"furnace":[370,0,168,156],"gauge":[540,0,106,122],"stamp":[648,0,90,104],"cart":[740,0,76,68],"whistle":[818,0,50,84],"lamp":[870,0,50,64],"clamp":[922,0,56,48],"bell":[0,330,48,56],"hopper":[50,330,68,84]};

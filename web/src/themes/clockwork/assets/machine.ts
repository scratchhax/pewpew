/**
 * Clockwork hero parts: LLM-generated stickers (see PROMPTS.md), chroma-keyed,
 * palette-quantised and packed by scripts/bake-clockwork.mjs.
 * frames[name] = [x, y, w, h] into machine.png, trimmed, at world scale.
 */
export const MACHINE_SIZE = [1024, 146] as const;
export const MACHINE_FRAMES: Record<string, number[]> = {"boiler":[0,0,164,146],"furnace":[166,0,84,78],"gauge":[252,0,44,54],"stamp":[298,0,33,38],"cart":[333,0,24,22],"whistle":[359,0,18,30],"lamp":[379,0,20,26],"clamp":[401,0,19,15],"bell":[422,0,16,18],"hopper":[440,0,31,38]};

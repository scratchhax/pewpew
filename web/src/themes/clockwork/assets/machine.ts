/**
 * Clockwork hero parts: LLM-generated stickers (see PROMPTS.md), chroma-keyed,
 * palette-quantised and packed by scripts/bake-clockwork.mjs.
 * frames[name] = [x, y, w, h] into machine.png, trimmed, at world scale.
 */
export const MACHINE_SIZE = [1024, 414] as const;
export const MACHINE_FRAMES: Record<string, number[]> = {"boiler":[0,0,367,327],"furnace":[369,0,168,154],"gauge":[539,0,104,122],"stamp":[645,0,90,104],"cart":[737,0,78,66],"whistle":[817,0,50,85],"lamp":[869,0,50,64],"clamp":[921,0,58,49],"bell":[0,329,48,54],"hopper":[50,329,68,85]};

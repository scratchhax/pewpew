/**
 * Clockwork hero parts: LLM-generated stickers (see PROMPTS.md), chroma-keyed,
 * palette-quantised and packed by scripts/bake-clockwork.mjs.
 * frames[name] = [x, y, w, h] into machine.png, trimmed, at world scale.
 */
export const MACHINE_SIZE = [1024, 310] as const;
export const MACHINE_FRAMES: Record<string, number[]> = {"boiler":[0,0,349,310],"furnace":[351,0,160,146],"gauge":[513,0,96,112],"stamp":[611,0,82,95],"cart":[695,0,62,53],"whistle":[759,0,44,76],"lamp":[805,0,44,60],"clamp":[851,0,54,45],"bell":[907,0,41,46],"hopper":[950,0,68,85]};

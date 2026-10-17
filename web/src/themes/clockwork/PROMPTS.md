# Clockwork hero art — generation prompts

Ten decorative hero pieces for the Clockwork scene. The machine's working
parts (gears, balls, rails, pipes, plates, steam) are drawn in code; these
are the big pretty set-pieces the code parts hang off.

## How to generate

- One **object per image**, nothing else in frame.
- Ask for a **solid magenta `#ff00ff` background** (the bake script keys it out).
- Square-ish output is fine (1024×1024); the bake script scales to the target
  size and quantises to the scene palette.
- Save each result into `web/src/themes/clockwork/assets/raw/` with the exact
  file name below (PNG).
- Then run: `node scripts/bake-clockwork.mjs`

## Style prefix (paste before every prompt)

> 16-bit pixel art game sprite sticker of a single OBJECT, steampunk brass
> and wrought iron, chunky visible pixels, 2px dark outline, flat lighting
> from the top-left, limited palette of brass, copper, dark iron and oak,
> isolated on a solid pure magenta (#ff00ff) background, no text, no shadow,
> no background elements, object fills the frame.

## The ten pieces

| file | OBJECT |
|---|---|
| `boiler.png` | a large riveted brass steam boiler, horizontal drum, domed top, two banded hoops with rivets, iron legs |
| `furnace.png` | an iron furnace mouth, brick arch surround, dark opening with iron fire bars |
| `gauge.png` | a round brass pressure gauge, bone-white face, tick marks, glass bezel (no needle) |
| `stamp.png` | a heavy stamp press head: iron piston rod with a wide brass press block at the bottom, seen from the side |
| `cart.png` | a small iron coal cart on two spoked wheels, a lump of glowing coal inside |
| `whistle.png` | a brass steam whistle, flared base, narrow chimney top |
| `lamp.png` | a warning lamp: iron hood over an amber glass dome on a small base |
| `clamp.png` | a pipe coupling clamp: two brass jaws on an oak lever arm, seen from the side, jaws open |
| `bell.png` | a small brass service bell, dome shape, clapper below, mounting bracket on top |
| `hopper.png` | an iron mail hopper: a wall box with a slot on top and a round pneumatic tube outlet at the bottom |

## Notes

- If a generation comes back with a checkered/transparent background instead
  of magenta, that's fine too — the bake script keeps existing alpha.
- If a piece has a stray object or text in it, regenerate; the bake script
  can't fix composition.
- The bake script prints what it baked and the final atlas size.

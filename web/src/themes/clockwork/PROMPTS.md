# Clockwork hero art — generation prompts

Twelve pieces. **Eleven of them move.** That is the difference from the first
attempt at this scene, whose prompt file said the opposite:

> The machine's working parts (gears, balls, rails, pipes, plates, steam) are
> drawn in code; these are the big pretty set-pieces the code parts hang off.

Ten hero pieces were spent on things that stand still, every moving part was a
flat procedural shape, and the scene was deleted. In a Rube Goldberg machine
the moving parts are the subject, so that is where the art goes.

**You generate one still image per part. The bake script derives the motion
frames from it** by rotating, tilting and stepping the single source, with
nearest-neighbour at atlas resolution and a palette re-quantise per frame. So
there is no need to ask for an animation, a sprite sheet, or the same object
at several angles — that is the thing diffusion models are worst at, and it is
not needed. One clean still per part is the whole job.

## How to generate

- **One object per image, nothing else in frame.**
- Ask for a **solid magenta `#ff00ff` background** (the bake script keys it out).
- 1024x1024 is fine; the bake script scales to the target size, quantises to
  the scene palette, trims and packs the atlas.
- **Draw every part in its REST pose, facing the direction in the table.** The
  code tilts and spins them from there; a part drawn mid-swing cannot be
  un-swung.
- Save into `web/src/themes/clockwork/assets/raw/` with the exact file name.
- Then: `node scripts/bake-clockwork.mjs`

## Style prefix (paste before every prompt)

> 16-bit pixel art game sprite sticker of a single OBJECT, steampunk brass and
> wrought iron, chunky visible pixels, 2px dark outline, flat lighting from the
> top-left, limited palette of brass, copper, dark iron and oak, isolated on a
> solid pure magenta (#ff00ff) background, no text, no shadow, no background
> elements, object fills the frame.

## The parts

Sizes are the drawn height in world units. One bearing is 8 units, and
everything is measured against it, so a 76-unit boiler is nine and a half
bearings tall. The scene is 640x360 world units in total.

### The movers (the code animates these)

| file | h | rest pose the code needs | OBJECT |
|---|---|---|---|
| `bearing.png` | 8 | centred, the code spins it | a polished brass ball bearing, a single bright specular highlight at the top left, dark contact shadow at the bottom |
| `domino.png` | 18 | standing upright, pivot at its bottom edge | an upright domino tile of dark oak with two brass pips and a brass rim |
| `seesaw.png` | 6 | perfectly level, pivot at its centre | a long flat oak plank with brass end caps and a brass centre band, seen from the side |
| `cart.png` | 20 | level, wheels down | a small iron coal cart on two spoked wheels, open top, a lump of glowing coal inside |
| `gear.png` | 60 | any rotation, the code spins it | a single brass gear wheel with chunky teeth, four spokes and a dark iron hub |
| `flywheel.png` | 56 | any rotation, the code spins it | a heavy iron flywheel, wide smooth rim, six straight spokes, a brass hub |
| `lever.png` | 22 | hanging straight down, pivot at its top | an iron lever arm with a brass counterweight ball at its lower end |
| `gate.png` | 28 | fully raised | a guillotine safety gate: an iron plate with diagonal hazard stripes in a narrow brass frame |
| `bell.png` | 14 | hanging still | a small brass service bell, dome shape, clapper visible below, mounting bracket on top |
| `whistle.png` | 16 | upright | a brass steam whistle, flared base, narrow chimney top |
| `plate.png` | 9 | flat, face on | a small blank brass nameplate with four corner rivets, like a luggage tag |

### The furniture (static, but it is the destination)

| file | h | OBJECT |
|---|---|---|
| `boiler.png` | 76 | a large riveted brass steam boiler, horizontal drum, domed top, two banded hoops with rivets, iron legs, a round inspection hatch on the near end |
| `firebox.png` | 46 | an iron furnace mouth, brick arch surround, dark opening with iron fire bars across it |
| `hopper.png` | 14 | an iron intake hopper: a wide funnel mouth on a short square neck, riveted |
| `funnel.png` | 16 | a brass funnel, wide cone mouth narrowing to a short spout, seen from the side |
| `rack.png` | 86 | an oak noticeboard rack with four horizontal brass rails across it for hanging nameplates on, empty |

## Notes

- A checkered/transparent background instead of magenta is fine; the bake
  script keeps existing alpha.
- Stray objects or text mean regenerate. The bake script can key a background
  and quantise a palette; it cannot fix composition.
- **Rest pose matters more than beauty.** A gorgeous domino drawn already
  falling is useless, because the code needs to fall it.
- The bake script prints what it baked, the frames it derived and the final
  atlas size.

# Slipstream — Mode 7 kart racer (theme `slipstream`)

Locked decisions: grid of exactly 8 karts (hosts, never events); ghost karts fill
empty seats; hero cam = busiest host with leader-cam toggle; full chaos mapping;
3 hand-authored circuits + hostname-hash auto.

## Architecture (house patterns, fragnet is the model)

Canvas-2D theme, own chunk via `themes/*/index.ts` glob (registry.ts:9).
Software rasterizer writing a `Uint32Array` — same class of renderer as
fragnet's `SoftRenderer`; **cheaper than the raycaster** (no per-column DDA,
no wall math — one multiply chain per pixel).

### Files

`web/src/themes/slipstream/`

1. **settings.ts** — `SLIP_DEFAULTS` (k-prefixed keys, written already — see
   the drafted content in this plan's appendix below), `SLIP_BUDGETS`
   (low 160 / med 220 / high 270 / ultra 400 rows; 8 racers all tiers —
   the grid is fixed by law, budgets only touch pixel rows),
   `SLIP_CONTROLS` (circuit select, cam select, one toggle per event rule,
   chevrons, wobble, minimap, pace range; audio: music style/rotate/sfx/engine),
   `SLIP_HUD` label overrides (THE GRID, TEAM RADIO, FRONT RUNNERS…).

2. **track.ts** — Track model + baker:
   - Control points (hand-authored, in 1024² texture/world units),
     closed Catmull-Rom → ~600 samples `{x, y, tangent, arcLen}` + total lap length.
   - Three circuits: `bowl` (ellipse rx380 ry300 + slight kinks, road w 120),
     `twisty` (r(θ)=300+90·sin3θ rosette, road w 70), `long` (big loop with a
     hairpin U + long straight, road w 90). All provably non-self-crossing.
   - Bake: tileable grass (checker + seeded tufts + dirt blobs) → road as
     layered strokes (brown shoulder w+26, red curb w+14, white dashed same
     width = red/white rumble, asphalt w, dashed centre line) → start-line
     checker at s=0 → cyan boost-pad chevrons at `pads[]` (list of s, ~3/lap)
     → keep `Uint32Array` pixels (from `getImageData`) for the rasterizer.
   - `nearest(x,y)`: 48×48 bucket grid → sample index.
   - Auto select: `hash01(hostname)` → circuit; board/pole positions baked.

3. **mode7.ts** — the rasterizer:
   - `resize(winW, winH, rows)`: fragnet `setPixRes` whole-pixel scale
     (`scale=max(1,round(winH/rows))`, buffer = window/scale) so it fills any
     aspect without pillarboxing; upscale with `imageSmoothingEnabled=false`.
   - `render(cam, tex, sky, opts)` per row y below horizon `hy = H*0.40 + bob`:
     `d = camH·f/(y−hy)`; per x: `lat=(x−W/2)·d/f`;
     texel `cam + F·d + R·lat` (F/R from heading, wrap mod 1024); fog = row-cost
     lookup lerp toward mist; write RGBA32. Wobble: heading += sin(t·1.4)·0.05·speedFrac.
   - Sky: pre-baked 2048×96 tileable gradient+two mountain ridges, sampled
     with heading scroll (drawImage slice, smoothing off).
   - `project(x, y, cam)` → `{sx, baseY, scale, depth}` for sprites (null if behind).
   - Ground drawn into offscreen ImageData; sprites composited on the offscreen
     ctx (affine drawImage, smoothing off, `globalAlpha` for ghosts, elliptical
     shadows); `present(canvas)` blits the buffer upscaled.
   - Perf note for README: ~270×480 texel writes ≈ what fragnet does per frame
     in columns; low tier 160 rows is trivial on Pi hardware.

4. **sprites.ts** — procedural pixel art (offscreen canvases, smoothing off,
   seeded, fragnet `art.ts` idiom): kart rear view (body/twin wheels/spoiler/
   helmet, per-seat hue), side view (for karts you pass), front view (oncoming),
   red shell (20×18 with flames), oil slick, sponsor board (`boardSprite(text)`
   — latest DNS domain), ghost kart = desaturated + alpha.

5. **race.ts** — the sim:
   - `Racer { seat, ip, name, hue, s, lateral, speed, surge, spin, glow,
     ghost, lastSeen }` ×8. ip→seat map; new host: empty seat, else evict the
     least-recently-active non-hero (one kart flashes out, one in).
   - Host quiet >3 min → ghost (grey, slow, seat kept); reappears → colour flash.
   - Pace: base ×(0.8+rate30s norm·0.6)×kPace; per-racer rubber-band
     (leader ×0.94, last ×1.12 scaled by rank gap); surge decay; spin = speed×0.15
     + spin animation. Positions = sort by total distance; lap counter.
   - Effects (all gated by settings): allow→surge(+playLead), dns→burst+board,
     dhcp→seat takeover / renew nudge, block→oil at racer, threat→shell object
     from `leader.s−30u` closing at 2.5× homing laterally (hit→leader spin),
     wifi joined→light a pad 6 s (racer over lit pad surges; bad join→sputter),
     system→caution 8 s (all ×0.55).
   - Hero: busiest host by 60 s event count, switch with ×1.5 hysteresis +
     5 s dwell; camera cut hidden by a 0.6 s white flash.
   - Rubber-band keeps all 8 within ~½ lap → always on the minimap, mostly visible.

6. **score.ts** — `SlipConductor extends Conductor` (sound/conductor.ts) with
   two `Style`s: `green` (168 bpm chip four-on-floor: kick/hat/16th chip
   bassline via `s.chip`, lead = chip melody) and `sunset` (140 bpm organ+tom
   cruising). `SLIP_MUSIC` options export. `sfx(name)`: `count`, `go`, `boost`
   (rising chip slide), `spin` (falling tone+noiseHit), `shell` (bandpass
   noise sweep, panned via opts.pan like undergrowth pass-bys), `lap` (bell
   arpeggio). Engine purr: throttled short `s.tone` calls, pitch ∝ hero speed,
   level from `kEngine`. `cue()`: allow→playLead, dns→chip, block→snare tick,
   threat→siren wail pair, dhcp→pluck, wifi→blip, system→low tom.

7. **hud.css** — `body[data-theme="slipstream"]` scoped (side-effect import in
   index.ts): countdown lights (3-2-1-GO, centred, chunky), `P3/8` position +
   `LAP 12` top-centre, `DRIVING: <hostname>` chip, minimap canvas 140px
   bottom-right (track path + hue dots + hero ring, redrawn every 3rd frame),
   pit-flash overlay.

8. **index.ts** — the Theme: `create()` builds canvas + Mode7 + track bake
   (auto by `hash01(location.hostname)` unless kTrack set) + race + HUD DOM +
   3-2-1 countdown before green flag; `event()` maps per the table (each
   toggle-gated, sfx through `throttle.allow(key, s)` + `audio.sfx`, music via
   `audio.cueSong`); `frame()`: race.step(dt) → cam (behind hero/leader by 9u,
   heading = tangent + lag blend, wanderX/Y folded in) → ground → sprites
   (depth-sorted, horizon-clipped, board sprite at boardS, shell) → chevrons
   overlay when traffic floods → present → minimap; `stats()` (pos, lap, hero,
   art), `diag()` (race+cam). Theme meta: accentHue 52 (helmet yellow).

### Wiring & docs (after visual check)

- `registry.ts`: SCENES entry — title **Slipstream**, blurb: "An 8-kart Mode 7
  grand prix on your network: hosts race, DHCP promotes new drivers, blocks
  leave oil, threats fire red shells at the leader, and Wi-Fi joins light the
  boost pads.", accent `#ffd23f`.
- README: gallery rows, `### Slipstream` section, scene-id lists at lines
  304/349/1445, settings-tab line 404, sound table (~1296), Contents line 69.
- docs/slipstream.png + .gif via the headless puppeteer rig (`/tmp/opencode`,
  `?demo=1&diag=1`, gifenc screencast pipeline).

## Verification

1. `npm run build` + `npm test` (4/4) in web/.
2. Headless puppeteer: `/slipstream/?demo=1&diag=1` — no console errors,
   `diag()` shows racers/positions/laps; sprite counts ≤ 9 sprites + 1 shell;
   frame time logged at 270 and 160 rows; screenshots scored by luminance
   stats (can't view images this session).
3. Perf sanity: assert ground loop < ~6 ms at 480×270 under SwiftShader.

## Appendix — settings.ts content drafted (ready to write)

Already composed in full (see conversation): SLIP_DEFAULTS with kTrack/kCam/
kDraft/kBoard/kPit/kOil/kShell/kPads/kCaution/kChevrons/kWobble/kMinimap/kPace/
kMusicStyle/kMusicRotate/kSfx/kEngine/kRows; budgets 160/220/270/400; controls
as described; SLIP_HUD overrides as described.

## Build order

settings.ts → track.ts → mode7.ts → sprites.ts → race.ts → score.ts →
hud.css → index.ts → registry.ts → build/headless-check → README+media → commit.

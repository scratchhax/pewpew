# pewpew

**Your UniFi network as a living scene, with a soundtrack it plays itself.**
pewpew turns UniFi gateway and AP syslog into a real-time visualizer in the
browser. Every firewall hit, DNS lookup, DHCP lease and Wi-Fi join becomes
something on screen, and everything you hear is synthesized live from your own
traffic. Pick a look per screen: **Orbital Command**, a space station
defending your network, or **Last Outpost**, a walled compound holding out
against the internet's zombies. No database, no cloud and no recordings. It
only reads syslog and never touches the network itself.

| Orbital Command (sci-fi, default) | Last Outpost (zombie) |
|---|---|
| ![orbital command](docs/hero.png) | ![last outpost](docs/zombie.png) |

![last outpost in motion](docs/zombie.gif)

**[Try the browser demo](https://scratchhax.github.io/pewpew/)** (synthetic
traffic, no hardware) ·
[Last Outpost demo](https://scratchhax.github.io/pewpew/?theme=zombie) ·
sci-fi showreel: [gif](docs/demo.gif), [mp4 with sound](docs/demo.mp4)

## Contents

- [Highlights](#highlights)
- [Try it](#try-it)
- [Run it on your network](#run-it-on-your-network)
- [Themes](#themes): [Orbital Command](#orbital-command) · [Last Outpost](#last-outpost) · [Choosing a theme](#choosing-a-theme)
- [Sound](#sound)
- [Settings (F1)](#settings-f1)
- [Performance and quality](#performance-and-quality)
- [URL parameters](#url-parameters)
- [Deploying on a Raspberry Pi](#deploying-on-a-raspberry-pi)
- [How it works](#how-it-works)
- [Health, privacy, troubleshooting](#health-and-diagnostics)
- [Credits](#credits)

## Highlights

- **Two themes, one relay.** Orbital Command and Last Outpost draw the same
  traffic. Every screen picks its own theme, so the kiosk in the hall and the
  laptop on your desk can show different worlds at the same time.
- **A readable picture.** One fixed colour per event type (block is red,
  allow green, DNS blue, DHCP yellow, Wi-Fi purple, threats amber) in both
  themes and in the scrolling log, so you can tell what's happening at a glance.
- **Generative soundtracks.** Each theme has six styles in rotation (synthwave,
  a pipe organ, chiptune and more in space; horror synth, dead west and more in
  the compound), and the scene's own sounds play along on the beat and in key:
  lasers and explosions, gunfire and groans. No audio files anywhere.
- **The scene moves with the music.** The station's core breathes on the beat;
  zombies shamble in time, guards sweep with the bars, and during a horde the
  lights follow the heartbeat.
- **Runs on anything.** Quality presets with an Auto mode size the scene to
  the device looking at it, from a gaming PC down to a Raspberry Pi 5 kiosk.
- **Zero footprint.** Syslog is parsed in RAM and fanned out over WebSocket.
  Nothing is written to disk and there are no accounts or telemetry.

## Try it

**In the browser:** the [GitHub Pages demo](https://scratchhax.github.io/pewpew/)
runs on synthetic traffic. Click once to start the sound (browser autoplay
rules) and press **F1** for settings. Add `?theme=zombie` for Last Outpost,
`?showreel=1` for a looping calm → storm → cooldown story, or
`?rate=40&block=65` to turn up the traffic.

**Locally:**

```bash
cd web
npm install
npm run dev
```

Then open `http://localhost:5173/?demo=1` (or `/zombie/?demo=1`). `?demo=1`
generates fake IPs, MACs and hostnames, so it's safe to screenshot and share.

The Pages site is rebuilt by `.github/workflows/pages.yml` whenever `web/`
changes on `main`, or from **Actions → Deploy demo to GitHub Pages**. That
build (`npm run build:demo`) always uses synthetic traffic and needs no relay.
On a fork, set **Settings → Pages → Build and deployment** to **GitHub
Actions** first.

## Run it on your network

1. **Start the relay** (Python 3.10+):

   ```bash
   cd relay
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/python pewpew_relay.py
   ```

2. **Build the viewer** (Node 18+, on any machine): `cd web && npm ci && npm run build`.
   The relay serves `web/dist/` with no-cache headers, so a refresh always gets
   the current build.

3. **Point UniFi at it.** In your UniFi OS console, go to **Settings →
   Advanced → Remote Syslog** and set the host to the relay machine and the
   port to **5514**. Enable logging on the firewall rules and zones you want
   to see.

4. **Open** `http://<relay-host>:8080/`.

### `relay/relay.yaml`

| Key | Default | What it does |
|-----|---------|--------------|
| `syslog_bind`, `syslog_port` | `0.0.0.0`, `5514` | where syslog (UDP) is received |
| `http_host`, `http_port` | `0.0.0.0`, `8080` | the viewer, WebSocket and health endpoints |
| `default_theme` | `scifi` | theme served at `/` (every theme is also at `/<theme>/`) |
| `buffer_size` | `500` | recent events replayed to each newly opened browser |
| `wan_interfaces` | `[ppp0]` | which gateway interfaces count as WAN, for inbound/outbound. Look at the `IN=`/`OUT=` fields of your firewall log lines; `eth8`–`eth10` are common on UDM/UDR |
| `drop_log_types` | `[]` | log types to hide, e.g. `[system]` |
| `drop_patterns` | UDM/AP chatter | regexes matched against raw lines and dropped before parsing (see `/drops`) |

The relay understands both the classic iptables-style firewall logs and the
CEF security events from gateways on the CyberSecure/Enhanced tier (IDS/IPS
threats included). `python3 relay/test_cef.py` self-checks the CEF parser.
`pewpew_relay.py --demo` generates fake events on the server side too.

## Themes

### Orbital Command

![orbital command storm](docs/storm.png)

Your network is an orbital station. Hosts drift in as stars and grow into
constellations, blocked traffic comes in as asteroids the station shoots down,
and the whole thing rides a parallax nebula.

| Event | Colour | On screen |
|-------|--------|-----------|
| allow | green | crystals between the core and a device, star-to-star links, the inner ring |
| block | red | an inbound asteroid intercepted by the station's laser, with a shake and flash |
| dns | blue | a blue laser from the client to the station, the second ring |
| dhcp | yellow | a planet labelled with the client's hostname drifts across; the logging AP core ripples |
| wifi | purple | joins send a crystal from the AP core to the station; leaves and failures fire a laser back |
| system | grey | a grey shockwave from the station |
| threat | amber | an IDS/IPS attack rocket weaves in on an evasive path, is shot down near the station, and turns the core red while any rocket is alive |

Traffic volume sets the weather: **STORM** at 300 events per 30 seconds and
**HURRICANE** at 1200. The readout turns amber or red, the station flares and
the field fills with debris and intercept fire. Busy IPs grow into
constellations, and blocked destinations rank on the **MOST WANTED** board.

### Last Outpost

![last outpost horde night](docs/zombie-night.png)

The same traffic as a walled compound seen from above: your network is inside
the walls, the internet is everything outside. The HUD is relabelled to match
(RADIO, COMPOUND, SURVIVAL LOG, HOT ZONES, RADIO LOG…).

| Event | On screen |
|-------|-----------|
| block | a zombie shambles in from a bearing fixed by the remote IP. The nearest tower guard turns and fires; rounds fly to it and it topples when they land. The odd one reaches the fence (a breach nudges the camera) |
| threat | a horde: a brute leading a weaving pack. The nearest towers open fire with bursts, the scene takes on a steady red cast and the floodlights turn red while the brute lives |
| allow (border) | supply runs: outbound, a scavenger runs from the camp through a gate and off the map; inbound, a survivor carries a crate in. Survivors step around zombies, and the towers shoot any zombie that gets close to one |
| allow (LAN↔LAN) | a courier strolls between two tents |
| dns | a dashed radio call from the client's tent to the mast, whose blue light warms with traffic |
| dhcp | a new survivor walks in through a gate and pitches a tent labelled with the device's hostname. Renewals ring the tent; names fade when a device goes quiet |
| wifi | AP and gateway hosts are buildings: joins walk in the door, leaves and failures hurry out, and the building's lamp warms toward its recent activity |
| system | the generator browns out: every light dims smoothly and recovers |

**Dead country.** The ground and trees are drained to grey-brown, with old
bloodstains outside the walls. That happens once when the scene is built, so
it costs nothing per frame. Traffic weather is the time of day: CALM is an
overcast day, STORM is dusk with rain, HURRICANE is horde night with heavy
rain and thick fog. A cold gloom always deepens toward the screen edges.

**No flashing.** Every light and colour change in this theme eases over about
a second. Nothing strobes or blinks, and routine kills don't shake the screen.

**Move with the music** (on by default). Zombies shamble and bob in time with
the soundtrack, guards sweep their watch once every eight bars, the
floodlights breathe slowly with the music's loudness, the mast light swells on
each bar, and during a horde the red wash follows the heartbeat. The scene
keeps its own clock and eases toward the music's beat (never more than ±50%
speed), so a new song never makes anything jump. With the sound off it keeps a
steady walking tempo.

Sprites are from Kenney's CC0 [Top-down Shooter](https://kenney.nl/assets/top-down-shooter) pack.

### Choosing a theme

One relay serves every theme, so different screens can show different themes
at once:

| URL | Theme |
|-----|-------|
| `http://<relay-host>:8080/` | the relay's `default_theme` |
| `http://<relay-host>:8080/scifi/`, `/zombie/` | that theme (unknown names are a 404) |
| any URL + `?theme=zombie` | that theme (handy on the Pages demo) |

The viewer checks the URL path, then `?theme=`, then the relay's
`/config.json`, and falls back to `scifi`. Each theme is its own bundle, so a
screen only downloads the theme it shows.

## Sound

All sound is synthesized in the browser with the WebAudio API. Browsers only
allow audio after a click or keypress, so click once to start it.

### Orbital Command's soundtrack

Six styles take turns, every 6 minutes by default:

| Style | Sound |
|-------|-------|
| Neon cruise | synthwave: four-on-the-floor, octave bass (Am–F–C–G), gated snare, a saw hook, arps when it's busy |
| Blade cosmos | slow brassy swells over a sub (Dm–B♭–C–Am, dorian), cold bell arpeggios with long echoes, taiko at night |
| Stellar organ | a pipe-organ ostinato climbing through the chord (Am–F–C–Em) over a ticking clock, a choir when it's busy |
| Arcade | a chiptune shooter at 138 bpm: square bass, noise drums, arpeggios and a pentatonic riff |
| Deep drift | a drone gliding between chords in E lydian, slow swells, pulsar pings in three-over-four |
| Fleet battle | a string ostinato, brass stabs and taiko drums (Dm–B♭–C–A) |

**Classic band** in the Music menu brings back the original generative band:
a set list of four melodies with song form (intro, verse, chorus, bridge,
outro), per-device voices, and a low drone while a threat rocket is alive.

The station's sounds play along, on the beat and in key:

| Event | Sound |
|-------|-------|
| asteroid intercepted | a defense laser diving onto a chord tone, then an explosion with a ring in key |
| threat | a rocket launch; its interception is a bigger blast. While rockets are alive, a shield thump every two beats and a red-alert tone every four bars |
| impact on the core | a big blast and a boom |
| block | a low sonar ping as the asteroid appears |
| allow | traffic plays the melody on the style's lead (saw, bell, organ, chip or glass) |
| dns | a soft high ping |
| dhcp | a warp-in whoosh onto a note as the planet arrives |
| wifi | rising pings for a join, a falling zap for a leave or failure |
| system | a shockwave: a low tone sweeping a filter open and shut |

The station hums and space hisses underneath, with radio crackle in storms.
**Move with the music** (Scene tab) makes the core breathe on the beat and the
stars and dust drift faster when the music is loud.

### Last Outpost's soundtrack

Six styles take turns, every 6 minutes by default, crossfading between them:

| Style | Sound |
|-------|-------|
| Horror synth | a pulsing minor ostinato (Am–F–Dm–E) over a saw drone, cold bells, a choir at night |
| Lonely survivor | fingerpicked guitar and a slightly detuned piano (Dm–B♭–F–C) over the wind, a cello at night |
| 80s slasher | driving octave bass (Em–C–Am–B), drum machine with a big gated snare, a brassy saw hook |
| Dark ambient | a breathing drone gliding between chords, distant swells, scraping metal |
| Dead west | banjo rolls, a bowed fiddle drone, boot stomps and a slide guitar (E dorian) |
| Broken lullaby | a music box on warped tape in 3/4 (Cm–A♭–Fm–G), glass harmonics, whispers at night |

The compound's sounds are part of the band. Each is snapped to the beat and
pitched to the chord that's playing:

| Event | Sound |
|-------|-------|
| guards fire | a punchy rifle shot with a ring in key; a brute's burst lands as a roll |
| block | a zombie groan on the chord root |
| threat | a horde roar and a boom; during the attack, a heartbeat and swells into every fourth bar |
| allow | traffic plays the melody on the style's lead instrument |
| dns | a radio chirp |
| wifi | a door creaking open (join) or shut |
| dhcp | a strummed music-box chord |
| system | the generator sputtering |
| breach | a boom and a metal clang |

Night thickens the arrangement (sixteenths instead of eighths, drums, choir
or cello). Wind is always there and rain comes in with the weather. Effects go
through their own limiter, so a busy night stays punchy without clipping.

### Mixing

The **Audio** tab is shared by both themes:

- **Melody** and **Devices** are layers that add together: the music, and the
  sounds triggered by events.
- Every event type has a **volume** (how loud) and a **gate** (how often it
  sounds, from 0 = never to 1 = every time). Gates thin a busy stream without
  changing its level.
- **Noise (chaos)** fires a short sound on a fraction of *raw* events, straight
  from the feed. 0 is off, 1 is every event.
- **Reverb**, **echo** and **Music bed** (music against event sounds).

Each theme adds **Music** (Rotate, or pin one style; sci-fi also has Classic
band), **Rotate every (min)**, and two volumes of its own: **Lasers &
blasts** and **Station hum** for Orbital Command, **Gunfire** and **Wind &
rain** for Last Outpost. Each theme keeps its own choices.

![last outpost audio settings](docs/panel-audio.png)

## Settings (F1)

Press **F1** for the settings panel. Changes apply live and are saved in the
browser. The two renderer options, antialias and GPU power, apply after the
panel's *Apply & reload*.

| Tab | What's in it |
|-----|--------------|
| **Scene** | the theme's toggles. Sci-fi: starfield, nebula, dust, ambient ships, DHCP planets, event stars, asteroids, attack rockets, crystals, IP constellations, ring objects, AP cores, screen shake, move with the music. Last Outpost: zombies, hordes, supply runs, couriers, DNS radio, DHCP arrivals, AP buildings, day/night, rain, blood, screen shake, move with the music |
| **HUD** | each HUD panel on or off (names follow the theme), plus scanlines |
| **Audio** | see [Mixing](#mixing) |
| **Colour** | global hue shift and intensity for the HUD accent; sci-fi also recolours its host mesh (spectrum, event law, mono, warm, cool). Event colours never change |
| **System** | quality preset, render scale, FPS cap, the theme's scene budgets, antialias and GPU power, simulation speed, reset to defaults |

![settings panel](docs/panel.png)

## Performance and quality

The relay never renders anything: each browser draws the scene on its own GPU.
How smooth it runs depends on the device *viewing* it, and a quality tier
bundles every setting that trades looks for frame time.

![system tab](docs/perf.png)

| Renderer | Low | Medium | **High** | Ultra |
|----------|-----|--------|----------|-------|
| Render scale | 0.6 | 0.8 | 1.0 | device pixel ratio (≤2) |
| FPS cap | 30 | 60 | none | none |
| Antialias | off | off | off | on |
| GPU power | low-power | browser default | low-power | high-performance |

| Orbital Command budgets | Low | Medium | **High** | Ultra |
|-------------------------|-----|--------|----------|-------|
| Particles | 800 | 2000 | 4000 | 8000 |
| Star density | 0.4 | 0.7 | 1.0 | 1.5 |
| Nebula clouds | 3 | 5 | 7 | 9 |
| Dust motes | 20 | 45 | 70 | 140 |
| Effect detail | 0.5 | 0.75 | 1.0 | 1.0 |
| IP stars / event stars | 60 / 100 | 100 / 180 | 140 / 260 | 200 / 400 |

| Last Outpost budgets | Low | Medium | **High** | Ultra |
|----------------------|-----|--------|----------|-------|
| Particles | 600 | 1500 | 3000 | 6000 |
| Zombies at once | 8 | 10 | 12 | 18 |
| Blood decals | 30 | 70 | 140 | 260 |
| Rain density | 0.3 | 0.6 | 1.0 | 1.5 |
| Tents | 16 | 22 | 28 | 36 |
| Fog + survivor flashlights | off | on | on | on |

- **Auto** (the default) guesses a tier at load, then watches the real frame
  rate. Software renderers, Pi and phone GPUs, and browsers without WebGL
  start at Low. Touch devices, machines with ≤4 cores or ≤4 GB of memory, and
  Intel HD/UHD graphics start at Medium. Everything else starts at High. If
  frames stay under 75% of the target for 5 seconds, Auto drops one tier. It
  never steps back up, so it can't flap, and the System tab says which tier
  it's running and why.
- Moving any single value switches the preset to **Custom** and keeps your
  numbers.
- **Render scale** trades sharpness for GPU work: 0.6 draws about a third of
  the pixels of 1.0. The HTML HUD isn't scaled, so on a small board driving a
  big display the browser's own compositing is often the limit.
- On a kiosk without a keyboard, pin values in the URL: `?quality=low`,
  `?scale=0.6`, `?fps=30`. These apply to that load only and aren't saved.

**Measured on a Raspberry Pi Compute Module 5** (Chromium kiosk at
2560×1440, Auto → Low, demo traffic):

| Scene | FPS |
|-------|-----|
| Orbital Command, normal traffic | about 24–26 |
| Orbital Command, heavy traffic (`rate=40&block=65`) | 23.6 |
| Last Outpost, calm day | 25.5 |
| Last Outpost, heavy traffic at night | 20.3 |

With the soundtrack playing, expect 2–3 fps less (sci-fi's band cost 2.0,
Last Outpost's 2.9 in the same test). Chromium painting a 1440p page is the
real ceiling on that board: running the display at 1080p helps more than any
setting.

## URL parameters

| Parameter | Effect |
|-----------|--------|
| `/<theme>/` (path) or `?theme=` | pick the theme: `scifi` or `zombie` |
| `?demo=1` | synthetic traffic, no relay needed |
| `?showreel=1` | with the demo: a looping 60-second calm → build → hurricane → cooldown arc |
| `?rate=40` | with the demo: about 40 events per second |
| `?block=65` | with the demo: 65% of firewall hits blocked |
| `?hosts=Router,Kitchen-AP` | with the demo: hostnames to use |
| `?quality=low` | pin the quality tier (`auto`, `low`, `medium`, `high`, `ultra`) |
| `?scale=0.6` | pin the render scale (0.25–2) |
| `?fps=30` | pin the FPS cap (`0` = uncapped) |
| `?debug=1` | overlay with FPS, worst frame, quality tier, render scale, scene nodes, events per second and audio stats |
| `?diag=1` | developer hook: exposes the scene objects on `window.__diag` |

![debug overlay](docs/debug.png)

## Deploying on a Raspberry Pi

```bash
sudo cp deploy/pewpew-relay.service /etc/systemd/system/   # adjust paths and user
sudo systemctl enable --now pewpew-relay
cp deploy/pewpew-kiosk.desktop ~/.config/autostart/        # fullscreen Chromium
```

A Pi doesn't need Node. Build the viewer on another machine and copy it into
the relay's checkout:

```bash
cd web && npm ci && npm run build
rsync -a --delete dist/ pi@<relay-host>:pewpew-ui/web/dist/
```

Static files update without a restart. Restart `pewpew-relay` only when
`relay/` changes; UniFi devices then take 1–3 minutes to resume logging.

The kiosk entry opens `http://localhost:8080/?quality=low`, a good start for a
Pi 5. Edit the URL to point at a relay on another host
(`http://192.168.1.5:8080/?quality=low`) or to pin a theme
(`http://192.168.1.5:8080/zombie/?quality=low`). The kiosk's browser still
needs one tap or keypress before it can play sound.

## How it works

```
UDM / UDR / APs ──syslog UDP :5514──► relay (Python) ──JSON over WebSocket──► browsers
                                        │                                       :8080
                                        └── also serves the built viewer:
                                            the default theme at /, every theme at /<theme>/
```

- **`relay/`**: an aiohttp server. It parses syslog with parsers vendored from
  [UniFi-Insights-Plus](https://github.com/jmasarweh/UniFi-Insights-Plus)
  (database and policy dependencies removed), drops known log spam, keeps a
  ring buffer of recent events, and broadcasts every event to every browser.
- **`web/`**: Vite, TypeScript and [PixiJS v8](https://pixijs.com/). The
  audio and the sci-fi graphics are generated in code; Last Outpost adds one
  small sprite atlas.
- **`deploy/`**: the systemd unit and the kiosk autostart entry.

### Viewer: core and themes

| Core (`web/src/`) | Theme (`web/src/themes/<id>/`) |
|-------------------|--------------------------------|
| relay feed and demo generator (`ws.ts`) | its renderer and scene |
| event classification (`events.ts`): allow, block, threat, dns, dhcp, wifi, system, plus direction and Wi-Fi outcome | what each event becomes on screen, and which repeats are worth drawing |
| sim state and weather (`state.ts`), per-flow throttle (`throttle.ts`) | Scene tab toggles, colour options, HUD names and accent colour |
| HUD, log, F1 panel, audio engine and the classic band (`audio.ts`), shared score machinery (`sound/`: synth, conductor, groove) | optionally its own `score`: music and sound design, with Audio tab controls |
| quality presets, auto tuner, frame loop (`perf.ts`, `loop.ts`) | scene budgets per quality tier |
| boot and event pipeline (`app.ts`), theme registry | a `Theme` object as the default export (`theme.ts` is the contract) |

For each event the core logs it to the HUD, feeds the noise gate and the sim
state, then hands the theme a classified event. Each frame the core advances
time (sim speed, slow motion, FPS cap), computes a slow anti-burn-in drift, and
calls the theme's `frame()`. All settings live in one saved object, so HUD and
audio preferences carry across themes.

**Adding a theme:** create `web/src/themes/<id>/index.ts` with a default
export of a `Theme` (defaults, per-tier budgets, panel controls, `create()`).
The registry finds it, the build writes `dist/<id>/index.html` and the relay
serves it at `/<id>/`. To give it its own music, set `score` to a function
that receives the shared `AudioEngine` (context, output, reverb and echo sends,
settings) and returns a `Score`. The easy way is to extend `Conductor` from
`sound/conductor.ts`: it handles the clock, style rotation, snapping sounds to
the beat, chord lookup and the pulse, so a theme only writes its styles and
what each event sounds like. Both themes' `score.ts` files are worked
examples, and `sound/groove.ts` shows how visuals can follow `audio.pulse()`.

## Health and diagnostics

- `GET /healthz`: syslog lines per host, WebSocket clients, event counters
- `GET /drops`: which drop patterns are catching what
- `GET /config.json`: the default theme and the themes in the build
- After a relay restart, APs and gateways stop logging for 1–3 minutes. That's
  UniFi's log forwarder backing off; it reconnects on its own.

## Privacy

- Everything runs on your LAN: no outbound connections, telemetry, analytics
  or accounts.
- Syslog is parsed in memory and sent over WebSocket; nothing is written to
  disk. Settings live in your browser's local storage.
- Demo mode uses fake IPs, MACs and hostnames.

## Troubleshooting

- **No sound:** click or press a key once; browsers block audio until you do.
- **Blank or stale after an update:** hard refresh (Ctrl+Shift+R).
- **Inbound and outbound look swapped:** set `wan_interfaces` in `relay.yaml`.
- **Choppy:** Auto should settle within about 30 seconds. If not, choose
  **Low** in F1 → System or add `?quality=low`, then lower **Render scale**.
  `?debug=1` shows the FPS you're getting. On a Pi driving a 1440p or 4K
  screen, a 1080p display mode helps most.
- **Soft or blurry:** you're on a lower tier or render scale; F1 → System
  shows which. Choose **High** (or **Ultra** on a high-DPI screen).

## Credits

- Syslog parsing vendored from
  [UniFi-Insights-Plus](https://github.com/jmasarweh/UniFi-Insights-Plus) (MIT).
- [PixiJS v8](https://pixijs.com/) renders both themes.
- Every sound, melody and sci-fi texture is generated in code.
- Last Outpost sprites: [Top-down Shooter](https://kenney.nl/assets/top-down-shooter)
  by [Kenney](https://kenney.nl) (CC0), packed into
  `web/src/themes/zombie/assets/atlas.png` with its license beside it.
- IDS/IPS threat support (the attack rockets, the red core and the threat
  audio) grew out of the CEF security-event parser idea and first
  implementation by [natechit](https://github.com/natechit).

## License

[MIT](LICENSE)

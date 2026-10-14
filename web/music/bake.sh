#!/usr/bin/env bash
# Bake MIDI into a theme as bundled music tracks.
#
#   music/bake.sh song.mid slipstream my-song            # auto bpm/key
#   music/bake.sh song.mid slipstream my-song 152 5 false # explicit
#   music/bake.sh ~/midi-pile/ slipstream                # whole folder
#
# Renders with fluidsynth + the FluidR3 GM soundfont (the instruments any
# MIDI player would use), encodes to Opus, and drops the result into the
# theme's assets/ (git-excluded). Prints the bundledTracks entries to paste
# into the theme definition. bpm/key come from music/key.py unless given.
set -euo pipefail
SRC=${1:?usage: bake.sh song.mid|dir/ theme [name] [bpm] [root] [minor]}
THEME=${2:?theme id}
SF2=/usr/share/sounds/sf2/FluidR3_GM.sf2
OUT="$(cd "$(dirname "$0")" && pwd)/../src/themes/$THEME/assets"
KEY="$(dirname "$0")/key.py"
mkdir -p "$OUT"

bake_one() {  # $1 mid, $2 name, $3 bpm, $4 root, $5 minor
  local TMP; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' RETURN
  # online sequencers export timid velocities (capped ~50), which GM synths
  # render thin; scale them up so the bass growls like the source player
  python3 - "$1" "$TMP/prepped.mid" <<'PY'
import sys, mido
m = mido.MidiFile(sys.argv[1], clip=True)
for t in m.tracks:
    for msg in t:
        if msg.type in ('note_on', 'note_aftertouch') and msg.velocity > 0:
            msg.velocity = min(127, int(msg.velocity * 2.2))
m.save(sys.argv[2])
PY
  fluidsynth -ni "$SF2" "$TMP/prepped.mid" -F "$TMP/out.wav" -r 44100 >/dev/null
  # the source players are loud and glued; a plain render is not
  ffmpeg -y -loglevel error -i "$TMP/out.wav" -af "loudnorm=I=-14:TP=-1.5:LRA=9" -c:a libopus -b:a 128k "$OUT/$2.ogg"
  echo "  $2: web/src/themes/$THEME/assets/$2.ogg  (bpm $3, root $4, minor $5)"
  echo "  { name: '$2', url: ${2//-/_}Url, meta: { bpm: $3, offset: 0, root: $4, minor: $5 } },"
}

if [ -d "$SRC" ]; then
  for f in "$SRC"/*.mid "$SRC"/*.midi; do
    [ -e "$f" ] || continue
    name=$(basename "${f%.*}" | tr ' ' '-' | tr -cd 'a-zA-Z0-9.-')
    read -r bpm root minor < <(python3 "$KEY" "$f")
    bake_one "$f" "$name" "$bpm" "$root" "$minor"
  done
else
  NAME=${3:?track name}
  if [ $# -ge 4 ]; then BPM=$4; ROOT=${5:-0}; MINOR=${6:-false}
  else read -r BPM ROOT MINOR < <(python3 "$KEY" "$SRC"); fi
  bake_one "$SRC" "$NAME" "$BPM" "$ROOT" "$MINOR"
fi

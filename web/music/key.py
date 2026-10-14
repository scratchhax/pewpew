#!/usr/bin/env python3
"""Guess tempo and key from a MIDI file: prints `bpm root minor`.

bpm: autocorrelation of note onsets (doubles low guesses into a danceable
range). root: pitch-class histogram vs Krumhansl profiles. Tolerant of the
slightly malformed MIDIs that float around the internet.
"""
import sys, collections
import mido

def main(path):
    m = mido.MidiFile(path, clip=True)
    onsets, pcs, tempos = [], collections.Counter(), []
    for t in m.tracks:
        tt, tempo = 0.0, 500_000          # ticks, microseconds per quarter
        for msg in t:
            tt += msg.time
            if msg.type == 'set_tempo':
                tempo = msg.tempo
                tempos.append(60e6 / tempo)
            elif msg.type == 'note_on' and msg.velocity > 0 and msg.channel != 9:
                sec = mido.tick2second(tt, m.ticks_per_beat, tempo)
                if sec <= 3600:           # junk deltas in malformed files
                    onsets.append(sec)
                    pcs[msg.note % 12] += 1
    onsets.sort()
    # tempo: the file's own marking when plausible, else autocorrelation of
    # the onset pulse train over 60..200 bpm
    sr = 50
    n = int(onsets[-1] * sr) + 1 if onsets else 1
    grid = bytearray(n)
    for o in onsets:
        i = int(o * sr)
        if i < n:
            grid[i] = 1
    plausible = sorted(t for t in tempos if 50 <= t <= 220)
    if plausible:
        best = round(plausible[len(plausible) // 2])
    else:
        best, best_s = 120, -1.0
        for bpm in range(60, 201):
            lag = int(60 / bpm * sr)
            terms = max(1, n - lag)
            s = sum(grid[i] * grid[i + lag] for i in range(0, n - lag, 3)) / terms
            if s > best_s:
                best, best_s = bpm, s
    # key: Krumhansl profiles
    tot = sum(pcs.values()) or 1
    maj = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    mnr = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.33, 3.18]
    def corr(root, prof):
        v = [pcs[(root + i) % 12] / tot for i in range(12)]
        a = sum(x * y for x, y in zip(v, prof))
        b = sum(x * x for x in v) ** .5 * sum(y * y for y in prof) ** .5
        return a / b if b else 0
    c1 = max((corr(r, maj), 0, r) for r in range(12))
    c2 = max((corr(r, mnr), 1, r) for r in range(12))
    _, minor, root = max(c1, c2)
    print(f"{best} {root} {str(bool(minor)).lower()}")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else input('midi: '))

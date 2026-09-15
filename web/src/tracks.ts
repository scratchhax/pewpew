import type { TrackAnalysis } from './trackAnalysis.worker';

/**
 * Background tracks: audio files uploaded to the relay and shared by every
 * screen. This is the client for the relay's /api/tracks plus the one-time
 * analysis (tempo, beat phase, key) that lets a score lock its sound effects
 * to the track.
 */

export type { TrackAnalysis };

export interface TrackInfo {
  name: string;
  size: number;
  mtime: number;
  meta: (TrackAnalysis & { manual?: boolean }) | null;
}

export interface TrackListing {
  tracks: TrackInfo[];
  /** theme id → track name */
  assign: Record<string, string>;
  max_mb: number;
}

export const trackUrl = (name: string) => `/tracks/${encodeURIComponent(name)}`;

async function ok(r: Response): Promise<Response> {
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `${r.status} ${r.statusText}`);
  return r;
}

/** The relay's tracks and theme assignments, or null when there's no relay (demo / Pages build). */
export async function listTracks(): Promise<TrackListing | null> {
  if (__DEMO__) return null;
  try {
    const r = await fetch('/api/tracks', { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json() as TrackListing;
  } catch {
    return null;
  }
}

/** Upload with progress (0..1). Resolves to the stored file name. */
export function uploadTrack(file: File, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/tracks');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve((JSON.parse(xhr.responseText) as { name: string }).name);
      else reject(new Error(xhr.responseText || `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('upload failed (network)'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export async function deleteTrack(name: string): Promise<void> {
  await ok(await fetch(`/api/tracks/${encodeURIComponent(name)}`, { method: 'DELETE' }));
}

export async function assignTrack(theme: string, name: string | null): Promise<void> {
  await ok(await fetch('/api/tracks-assign', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme, name }),
  }));
}

export async function saveMeta(name: string, meta: TrackAnalysis & { manual?: boolean }): Promise<void> {
  await ok(await fetch(`/api/tracks/${encodeURIComponent(name)}/meta`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
  }));
}

/**
 * Decode a track and work out its tempo, beat phase and key. Decoding happens
 * here (it needs an audio context); the number crunching runs in a worker.
 * Analyses up to 90 s from 15% into the track, where the groove usually is.
 */
export async function analyseTrack(name: string): Promise<TrackAnalysis> {
  const data = await (await ok(await fetch(trackUrl(name)))).arrayBuffer();
  const rate = 22050;
  const decoder = new OfflineAudioContext(1, 1, rate);
  const audio = await decoder.decodeAudioData(data);
  const start = Math.floor(audio.length * 0.15);
  const len = Math.min(audio.length - start, rate * 90);
  const mono = new Float32Array(len);
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const d = audio.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += d[start + i] / audio.numberOfChannels;
  }
  const worker = new Worker(new URL('./trackAnalysis.worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise<TrackAnalysis>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: TrackAnalysis; error?: string }>) =>
        e.data.ok ? resolve(e.data.result!) : reject(new Error(e.data.error));
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ samples: mono, rate }, [mono.buffer]);
    });
    // the phase was measured from the analysis window; shift it back to the start of the file
    const beat = 60 / result.bpm;
    result.offset = (((start / rate + result.offset) % beat) + beat) % beat;
    return result;
  } finally {
    worker.terminate();
  }
}

export const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

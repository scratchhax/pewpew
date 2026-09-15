import {
  KEY_NAMES, analyseTrack, assignTrack, deleteTrack, saveMeta, uploadTrack, type TrackListing,
} from '../tracks';

export interface TrackUiHost {
  themeId: string;
  themeTitle: string;
  /** The latest listing from the relay (null = no relay). */
  listing(): TrackListing | null;
  /** Re-read the relay and apply the result (after any change here). */
  refresh(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * The Background track box on the Audio tab: upload, pick per theme, check
 * the detected tempo and key (and correct the tempo), delete.
 */
export function mountTrackUi(root: HTMLElement, host: TrackUiHost): void {
  const render = (status = '') => {
    const l = host.listing();
    if (!l) {
      root.innerHTML = `<p class="grp">Background track</p>
        <p class="hint">Background tracks are stored on the relay, so they need a relay (not the demo build).</p>`;
      return;
    }
    const current = l.assign[host.themeId] ?? '';
    const cur = l.tracks.find((t) => t.name === current);
    const meta = cur?.meta;
    root.innerHTML = `<p class="grp">Background track</p>
      <label class="row sld"><span class="lbl">${esc(host.themeTitle)}</span>
        <select data-track="pick">
          <option value="">None (theme soundtrack)</option>
          ${l.tracks.map((t) => `<option value="${esc(t.name)}"${t.name === current ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select></label>
      ${cur ? `<p class="hint">${meta
        ? `Locked to <b>${meta.bpm.toFixed(1)} bpm</b>${meta.manual ? ' (set by hand)' : ''}, key <b>${KEY_NAMES[meta.root]} ${meta.minor ? 'minor' : 'major'}</b>. Effects snap to its beat and play in its key.`
        : 'Analysing tempo and key…'}</p>
      <label class="row sld"><span class="lbl">Tempo (bpm)</span>
        <input type="number" data-track="bpm" min="40" max="240" step="0.5" value="${meta ? meta.bpm : ''}" style="width:5.5em"/>
        <button class="set-small" data-track="redetect">Re-detect</button></label>
      <button class="set-small set-danger" data-track="delete">Delete ${esc(cur.name)}</button>` : ''}
      <label class="row"><button class="set-small" data-track="upload">Upload track…</button>
        <input type="file" data-track="file" accept="audio/*,.mp3,.ogg,.m4a,.wav,.flac,.opus,.webm" hidden/>
        <span class="hint" data-track="status">${esc(status)}</span></label>
      <p class="hint">MP3, OGG, M4A, WAV or FLAC up to ${l.max_mb} MB. Stored on the relay and shared by every
        screen; each theme picks its own. While a track plays, the theme's music steps aside and its effects
        and ambience ride on top.</p>`;
  };

  const setStatus = (msg: string) => {
    const el = root.querySelector<HTMLElement>('[data-track="status"]');
    if (el) el.textContent = msg; else render(msg);
  };

  const analyseAndSave = async (name: string) => {
    setStatus('Analysing tempo and key…');
    const meta = await analyseTrack(name);
    await saveMeta(name, meta);
  };

  root.addEventListener('click', async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-track]');
    if (!el) return;
    const l = host.listing();
    const current = l?.assign[host.themeId];
    try {
      if (el.dataset.track === 'upload') {
        root.querySelector<HTMLInputElement>('[data-track="file"]')?.click();
      } else if (el.dataset.track === 'delete' && current) {
        if (!confirm(`Delete ${current} from the relay? Every screen using it goes back to its theme soundtrack.`)) return;
        await deleteTrack(current);
        await host.refresh();
        render('Deleted.');
      } else if (el.dataset.track === 'redetect' && current) {
        await analyseAndSave(current);
        await host.refresh();
        render('Re-detected.');
      }
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
  });

  root.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    try {
      if (el.dataset.track === 'pick') {
        await assignTrack(host.themeId, el.value || null);
        await host.refresh();
        render(el.value ? 'Playing on every screen showing this theme.' : 'Back to the theme soundtrack.');
      } else if (el.dataset.track === 'bpm') {
        const l = host.listing(), name = l?.assign[host.themeId], meta = l?.tracks.find((t) => t.name === name)?.meta;
        const bpm = parseFloat(el.value);
        if (!name || !meta || !(bpm >= 40 && bpm <= 240)) return;
        await saveMeta(name, { ...meta, bpm, manual: true });
        await host.refresh();
        render(`Tempo set to ${bpm} bpm.`);
      } else if (el.dataset.track === 'file') {
        const file = (el as HTMLInputElement).files?.[0];
        if (!file) return;
        const name = await uploadTrack(file, (p) => setStatus(`Uploading… ${Math.round(p * 100)}%`));
        await analyseAndSave(name);
        await assignTrack(host.themeId, name);
        await host.refresh();
        render(`Uploaded ${name}; now playing on ${host.themeTitle}.`);
      }
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
  });

  render();
}

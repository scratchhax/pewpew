import {
  KEY_NAMES, analyseTrack, assignTrack, deleteTrack, renameTrack, saveMeta, uploadTrack, type TrackListing,
} from '../tracks';

export interface TrackUiHost {
  themeId: string;
  themeTitle: string;
  /** The latest listing from the relay (null = no relay). */
  listing(): TrackListing | null;
  /** Re-read the relay and apply the result (after any change here). */
  refresh(): Promise<void>;
  /** Tracks baked into the theme, for the no-relay (demo) picker. */
  bundled?: { name: string }[];
  /** Which bundled track plays: 'shuffle', a name, or 'none'. */
  bundledPick(): string;
  setBundledPick(v: string): void;
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
      const bundled = host.bundled ?? [];
      if (!bundled.length) {
        root.innerHTML = `<p class="grp">Background track</p>
          <p class="hint">Background tracks are stored on the relay, so they need a relay (not the demo build).</p>`;
        return;
      }
      const pick = host.bundledPick();
      root.innerHTML = `<p class="grp">Background track</p>
        <label class="row sld"><span class="lbl">${esc(host.themeTitle)}</span>
          <select data-track="bundled">
            <option value="shuffle"${pick === 'shuffle' ? ' selected' : ''}>Shuffle (all ${bundled.length})</option>
            ${bundled.map((t) => `<option value="${esc(t.name)}"${pick === t.name ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
            <option value="none"${pick === 'none' ? ' selected' : ''}>None (theme soundtrack)</option>
          </select></label>
        <p class="hint" data-track="status">${esc(status) || 'These songs are baked into this scene. Shuffled songs play one after another; a relay-uploaded track would override them.'}</p>`;
      return;
    }
    const current = l.assign[host.themeId] ?? '';
    const cur = l.tracks.find((t) => t.name === current);
    const meta = cur?.meta;
    const shuf = current === '*shuffle' || current.startsWith('*shuffle:');
    const poolSet = current.startsWith('*shuffle:') ? new Set(current.slice('*shuffle:'.length).split(',')) : null;
    root.innerHTML = `<p class="grp">Background track</p>
      <label class="row sld"><span class="lbl">${esc(host.themeTitle)}</span>
        <select data-track="pick">
          <option value="">None (theme soundtrack)</option>
          ${l.tracks.length > 1 ? `<option value="*shuffle"${shuf ? ' selected' : ''}>Shuffle…</option>` : ''}
          ${l.tracks.map((t) => `<option value="${esc(t.name)}"${t.name === current ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select></label>
      ${shuf ? `<p class="hint">Shuffling ${poolSet ? `${poolSet.size} of ${l.tracks.length}` : `all ${l.tracks.length}`} tracks; a random one takes over each time a song ends.</p>
        <button class="set-small" data-track="pool">Choose songs…</button>` : ''}
      ${cur ? `<p class="hint">${meta
        ? `Locked to <b>${meta.bpm.toFixed(1)} bpm</b>${meta.manual ? ' (set by hand)' : ''}, key <b>${KEY_NAMES[meta.root]} ${meta.minor ? 'minor' : 'major'}</b>. Effects snap to its beat and play in its key.`
        : 'Analysing tempo and key…'}</p>
      <label class="row sld"><span class="lbl">Tempo (bpm)</span>
        <input type="number" data-track="bpm" min="40" max="240" step="0.5" value="${meta ? meta.bpm : ''}" style="width:5.5em"/>
        <button class="set-small" data-track="redetect">Re-detect</button></label>
      <button class="set-small" data-track="rename">Rename</button>
      <button class="set-small set-danger" data-track="delete">Delete ${esc(cur.name)}</button>` : ''}
      <label class="row"><button class="set-small" data-track="upload">Upload track…</button>
        <input type="file" data-track="file" accept="audio/*,.mp3,.ogg,.m4a,.wav,.flac,.opus,.webm,.mid,.midi" hidden/>
        <span class="hint" data-track="status">${esc(status)}</span></label>
      <p class="hint">MP3, OGG, M4A, WAV, FLAC — or a MIDI file, which the relay renders with a
        GM soundfont — up to ${l.max_mb} MB. Stored on the relay and shared by every
        screen; each theme picks its own. While a track plays, the theme's music steps aside and its effects
        and ambience ride on top.</p>`;
  };

  /** Popup with a tick-box per track: the songs this theme shuffles through. */
  const openPool = () => {
    const l = host.listing();
    if (!l) return;
    const current = l.assign[host.themeId] ?? '';
    const sel = new Set(current.startsWith('*shuffle:')
      ? current.slice('*shuffle:'.length).split(',') : l.tracks.map((t) => t.name));
    document.getElementById('pool-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'pool-modal';
    modal.className = 'pool-modal';
    modal.innerHTML = `<div class="pool-box">
      <p class="grp">Shuffle pool — ${esc(host.themeTitle)}</p>
      ${l.tracks.map((t) => `<label class="pool-row"><input type="checkbox" data-pool value="${esc(t.name)}"${sel.has(t.name) ? ' checked' : ''}/> ${esc(t.name)}</label>`).join('')}
      <p class="hint">Tick the songs this scene shuffles through; a random one takes over each time a song ends.
        Tick nothing to shuffle all ${l.tracks.length}.</p>
      <div class="pool-btns">
        <button class="set-small" data-pool="all">Select all</button>
        <button class="set-small" data-pool="save">Save</button>
        <button class="set-small" data-pool="cancel">Cancel</button>
      </div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', async (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pool]');
      try {
        if (!el) { if (e.target === modal) modal.remove(); return; }
        const what = el.dataset.pool;
        if (!what || el.tagName === 'INPUT') return;
        if (what === 'all') {
          modal.querySelectorAll<HTMLInputElement>('input[data-pool]').forEach((c) => { c.checked = true; });
        } else if (what === 'cancel') {
          modal.remove();
        } else if (what === 'save') {
          const on = [...modal.querySelectorAll<HTMLInputElement>('input[data-pool]:checked')].map((c) => c.value);
          const val = !on.length || on.length === l.tracks.length ? '*shuffle' : `*shuffle:${on.join(',')}`;
          await assignTrack(host.themeId, val);
          modal.remove();
          await host.refresh();
          render(on.length && on.length < l.tracks.length ? `Shuffling ${on.length} selected tracks.` : 'Shuffling all tracks.');
        }
      } catch (err) {
        modal.remove();
        render(`Failed: ${(err as Error).message}`);
      }
    });
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
      } else if (el.dataset.track === 'pool') {
        openPool();
      } else if (el.dataset.track === 'rename' && current) {
        const want = prompt('New name for this track:', current.replace(/\.[a-z0-9]+$/i, ''));
        if (!want?.trim() || want.trim() === current) return;
        await renameTrack(current, want.trim());
        await host.refresh();
        render(`Renamed to ${want.trim()}.`);
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
      if (el.dataset.track === 'bundled') {
        host.setBundledPick(el.value);
        await host.refresh();
        render(el.value === 'shuffle' ? 'Shuffling the bundled songs.'
          : el.value === 'none' ? 'Back to the theme soundtrack.' : `Playing ${el.value}.`);
        return;
      }
      if (el.dataset.track === 'pick') {
        await assignTrack(host.themeId, el.value || null);
        await host.refresh();
        render(el.value === '*shuffle' ? 'Shuffling every track on every screen showing this theme.'
          : el.value ? 'Playing on every screen showing this theme.' : 'Back to the theme soundtrack.');
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

import { SCENE_ORDER, sceneInfo, switchScene } from '../themes/registry';

/**
 * F2: a full-screen scene picker for screens where the URL can't be changed
 * (kiosks). Click a card, or use ←/→ (or 1–9 on the shown page) and Enter;
 * Esc or F2 closes. More than nine scenes pages over: 0 flips to the next
 * page. The pick is remembered on this screen.
 */
const PAGE = 9;

export class ScenePicker {
  private root: HTMLElement;
  private focus: number;
  private page = 0;
  private open = false;

  constructor(private current: string) {
    this.focus = Math.max(0, SCENE_ORDER.indexOf(current));
    this.root = document.createElement('div');
    this.root.id = 'scene-picker';
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-scene]');
      if (card) this.pick(card.dataset.scene!);
      else if (e.target === this.root) this.toggle(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); this.toggle(); return; }
      if (!this.open) return;
      if (e.key === 'Escape') { this.toggle(false); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { this.focus = (this.focus + 1) % SCENE_ORDER.length; this.page = Math.floor(this.focus / PAGE); this.render(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { this.focus = (this.focus + SCENE_ORDER.length - 1) % SCENE_ORDER.length; this.page = Math.floor(this.focus / PAGE); this.render(); }
      else if (e.key === 'Enter') { this.pick(SCENE_ORDER[this.focus]); }
      else if (e.key === '0') { if (this.pageCount() > 1) this.page = (this.page + 1) % this.pageCount(); else return; this.render(); }
      else if (/^[1-9]$/.test(e.key) && SCENE_ORDER[this.page * PAGE + +e.key - 1]) { this.pick(SCENE_ORDER[this.page * PAGE + +e.key - 1]); }
      else return;
      e.preventDefault();
    });
  }

  private pageCount(): number {
    return Math.max(1, Math.ceil(SCENE_ORDER.length / PAGE));
  }

  toggle(show = !this.open): void {
    this.open = show;
    if (show) { this.focus = Math.max(0, SCENE_ORDER.indexOf(this.current)); this.page = Math.floor(this.focus / PAGE); this.render(); }
    this.root.hidden = !show;
  }

  private render(): void {
    const start = this.page * PAGE;
    const cards = SCENE_ORDER.slice(start, start + PAGE);
    const pages = this.pageCount();
    this.root.innerHTML = `<div class="sp-panel">
      <div class="sp-head">CHOOSE A SCENE</div>
      <div class="sp-cards">${cards.map((id, i) => {
        const s = sceneInfo(id);
        return `<button class="sp-card${start + i === this.focus ? ' focus' : ''}" data-scene="${id}" style="--scene:${s.accent}">
          <span class="sp-num">${i + 1}</span>
          <span class="sp-title">${s.title}</span>
          <span class="sp-blurb">${s.blurb}</span>
          ${id === this.current ? '<span class="sp-now">NOW SHOWING</span>' : ''}
        </button>`;
      }).join('')}</div>
      <div class="sp-foot">← → and Enter, or 1–${cards.length}${pages > 1 ? ` · 0 flips pages (page ${this.page + 1} of ${pages})` : ''} · Esc to close · this screen remembers the pick</div>
    </div>`;
  }

  /** Fade out, then load the scene (staying put if it's the one already showing). */
  private pick(id: string): void {
    if (id === this.current) { this.toggle(false); return; }
    fadeThen(() => switchScene(id));
  }
}

/** A short fade to black before a scene change, so the swap never pops. */
export function fadeThen(go: () => void): void {
  const veil = document.createElement('div');
  veil.id = 'scene-veil';
  document.body.appendChild(veil);
  requestAnimationFrame(() => { veil.style.opacity = '1'; });
  setTimeout(go, 450);
}

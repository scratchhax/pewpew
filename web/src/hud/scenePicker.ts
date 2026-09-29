import { SCENE_ORDER, sceneInfo, switchScene } from '../themes/registry';

/**
 * F2: a full-screen scene picker for screens where the URL can't be changed
 * (kiosks). Click a card, or use ←/→ (or the number on the card) and Enter;
 * Esc or F2 closes. The pick is remembered on this screen.
 *
 * Past one page it pages over, and the paging has to be *visible*: the first
 * version said so only in a dim line of footer text and would only page on the
 * `0` key, which meant that on a kiosk driven by a mouse or a remote there was
 * no way to reach the later scenes at all, and no hint that they existed. The
 * pager below is a real control — arrows and dots you can click, a page count
 * that reads as a count — and the keys are still there for anyone using them.
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
      const el = e.target as HTMLElement;
      const step = el.closest<HTMLElement>('[data-step]');
      if (step) { this.turn(Number(step.dataset.step)); return; }
      const dot = el.closest<HTMLElement>('[data-page]');
      if (dot) { this.goto(Number(dot.dataset.page)); return; }
      const card = el.closest<HTMLElement>('[data-scene]');
      if (card) this.pick(card.dataset.scene!);
      else if (e.target === this.root) this.toggle(false);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); this.toggle(); return; }
      if (!this.open) return;
      if (e.key === 'Escape') { this.toggle(false); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { this.move(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { this.move(-1); }
      else if (e.key === 'Enter') { this.pick(SCENE_ORDER[this.focus]); }
      else if (e.key === 'PageDown' || e.key === '0') { if (this.pageCount() < 2) return; this.turn(1); }
      else if (e.key === 'PageUp') { if (this.pageCount() < 2) return; this.turn(-1); }
      else if (/^[1-9]$/.test(e.key) && SCENE_ORDER[this.page * PAGE + +e.key - 1]) {
        this.pick(SCENE_ORDER[this.page * PAGE + +e.key - 1]);
      } else return;
      e.preventDefault();
    });
  }

  private pageCount(): number {
    return Math.max(1, Math.ceil(SCENE_ORDER.length / PAGE));
  }

  /** Move the keyboard focus, following it onto whatever page it lands on. */
  private move(by: number): void {
    const n = SCENE_ORDER.length;
    this.focus = (this.focus + by + n) % n;
    this.page = Math.floor(this.focus / PAGE);
    this.render();
  }

  /** Turn the page, taking the focus to the same slot on the new one. */
  private turn(by: number): void {
    this.goto((this.page + by + this.pageCount()) % this.pageCount());
  }

  private goto(page: number): void {
    const pages = this.pageCount();
    if (page < 0 || page >= pages || page === this.page) return;
    const slot = this.focus - this.page * PAGE;
    this.page = page;
    this.focus = Math.min(SCENE_ORDER.length - 1, page * PAGE + Math.max(0, slot));
    this.render();
  }

  toggle(show = !this.open): void {
    this.open = show;
    if (show) {
      this.focus = Math.max(0, SCENE_ORDER.indexOf(this.current));
      this.page = Math.floor(this.focus / PAGE);
      this.render();
    }
    this.root.hidden = !show;
  }

  private render(): void {
    const start = this.page * PAGE;
    const cards = SCENE_ORDER.slice(start, start + PAGE);
    const pages = this.pageCount();

    const pager = pages < 2 ? '' : `<div class="sp-pager">
      <button class="sp-step" data-step="-1" aria-label="Previous page">‹</button>
      <div class="sp-dots">${Array.from({ length: pages }, (_, i) =>
        `<button class="sp-dot${i === this.page ? ' on' : ''}" data-page="${i}"
                 aria-label="Page ${i + 1} of ${pages}"></button>`).join('')}</div>
      <button class="sp-step" data-step="1" aria-label="Next page">›</button>
      <span class="sp-count">PAGE ${this.page + 1} / ${pages}</span>
    </div>`;

    this.root.innerHTML = `<div class="sp-panel">
      <div class="sp-head">
        <span>CHOOSE A SCENE</span>
        <span class="sp-total">${SCENE_ORDER.length} SCENES</span>
      </div>
      <div class="sp-cards">${cards.map((id, i) => {
        const s = sceneInfo(id);
        return `<button class="sp-card${start + i === this.focus ? ' focus' : ''}" data-scene="${id}" style="--scene:${s.accent}">
          <span class="sp-num">${i + 1}</span>
          <span class="sp-title">${s.title}</span>
          <span class="sp-blurb">${s.blurb}</span>
          ${id === this.current ? '<span class="sp-now">NOW SHOWING</span>' : ''}
        </button>`;
      }).join('')}</div>
      <div class="sp-foot">
        ${pager}
        <span class="sp-keys">← → and Enter, or 1–${cards.length}${pages > 1 ? ' · PgUp/PgDn' : ''} · Esc to close · this screen remembers the pick</span>
      </div>
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

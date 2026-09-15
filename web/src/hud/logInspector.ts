import { LogStore, eventClass, matches, summary, type LogFilter, type Pivot } from '../logStore';

const ROW = 36;
const SEARCH_DEBOUNCE = 150;
const emptyFilter = (): LogFilter => ({ search: '', type: '', action: '', host: '' });
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = cls;
  return node;
};

export class LogInspector {
  readonly store = new LogStore();
  beforeOpen: () => void = () => {};
  private root = document.createElement('dialog');
  private list!: HTMLDivElement;
  private space!: HTMLDivElement;
  private rows!: HTMLDivElement;
  private detail!: HTMLElement;
  private status!: HTMLElement;
  private chips!: HTMLElement;
  private liveButton!: HTMLButtonElement;
  private spark!: HTMLCanvasElement;
  private filter = emptyFilter();
  private back: LogFilter[] = [];
  private ids: number[] = [];
  private selected: number | undefined;
  private following = true;
  private pauseAt = 0;
  private version = -1;
  private dirty = true;
  private timer: number | undefined;
  private searchTimer: number | undefined;
  private previousFocus: HTMLElement | null = null;
  private renderedDetail: number | undefined;
  private expiredDetail = false;

  constructor(private onClear: () => void = () => {}) {
    this.root.id = 'log-inspector';
    this.root.setAttribute('aria-labelledby', 'log-title');
    this.root.innerHTML = `
      <header class="log-heading"><h2 id="log-title">◢ COMMS ARCHIVE</h2><span class="log-session">RECENT SESSION</span>
        <button type="button" data-command="close" aria-label="Close log inspector">Close · Esc</button></header>
      <div class="log-toolbar">
        <label>Search<input data-filter="search" type="search" maxlength="200" placeholder="Address, rule, DNS, raw text…"></label>
        <label>Type<select data-filter="type"><option value="">All types</option><option value="firewall">Firewall</option><option value="threat">Threat</option><option value="dns">DNS</option><option value="dhcp">DHCP</option><option value="wifi">Wi-Fi</option><option value="system">System</option></select></label>
        <label>Action<select data-filter="action"><option value="">All actions</option><option value="allow">Allow</option><option value="block">Block</option><option value="redirect">Redirect</option></select></label>
        <label>Host<input data-filter="host" maxlength="512" placeholder="Exact syslog host"></label>
        <button type="button" data-command="live">Pause</button>
        <button type="button" data-command="clear">Clear history</button>
      </div>
      <div class="log-chips"></div>
      <div class="log-meter"><span class="log-status" role="status"></span><canvas width="180" height="28" aria-label="Live traffic over the last 60 seconds" role="img"></canvas></div>
      <div class="log-workspace"><div class="log-list" role="listbox" aria-label="Recent events" tabindex="0"><div class="log-space"><div class="log-rows"></div></div></div>
        <section class="log-detail" aria-label="Event details"></section></div>
      <footer>Session only · oldest events expire at 5,000 events or 8 MiB of text · click an address to follow related events</footer>`;
    document.body.append(this.root);
    this.list = this.root.querySelector('.log-list')!;
    this.space = this.root.querySelector('.log-space')!;
    this.rows = this.root.querySelector('.log-rows')!;
    this.detail = this.root.querySelector('.log-detail')!;
    this.status = this.root.querySelector('.log-status')!;
    this.chips = this.root.querySelector('.log-chips')!;
    this.liveButton = this.root.querySelector('[data-command="live"]')!;
    this.spark = this.root.querySelector('canvas')!;
    this.root.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
    this.root.addEventListener('input', e => {
      const input = e.target as HTMLInputElement;
      const key = input.dataset.filter as 'search' | 'type' | 'action' | 'host' | undefined;
      if (!key) return;
      if (key === 'search') {
        // A keystroke would otherwise re-scan the whole retained history at
        // the next 100ms refresh; on a Pi that is felt while typing.
        const value = input.value;
        window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => this.applyFilter('search', value), SEARCH_DEBOUNCE);
        return;
      }
      this.applyFilter(key, input.value);
    });
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      const command = button.dataset.command;
      if (command === 'close') this.close();
      if (command === 'live') { this.following ? this.pause() : this.follow(); }
      if (command === 'clear') {
        this.store.clear(); this.onClear(); this.selected = undefined; this.ids = [];
        this.renderedDetail = undefined; this.detail.replaceChildren();
        this.pauseAt = this.store.lastId; this.dirty = true;
      }
      if (command === 'reset') { this.filter = emptyFilter(); this.back = []; this.syncFilters(); }
      if (command === 'back') { this.filter = this.back.pop() ?? emptyFilter(); this.syncFilters(); }
      if (command === 'unpivot') { this.filter = { ...this.filter, pivot: undefined }; this.syncFilters(); }
      if (button.dataset.pivot) this.pivot({ field: button.dataset.pivot as Pivot['field'], value: button.textContent! });
      if (command === 'copy') void this.copy(button);
    });
    this.rows.addEventListener('click', e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) this.select(Number(row.dataset.id));
    });
    this.list.addEventListener('wheel', () => this.pause(), { passive: true });
    this.list.addEventListener('touchstart', () => this.pause(), { passive: true });
    this.list.addEventListener('pointerdown', e => {
      if (e.target === this.list || e.target === this.space) this.pause();
    });
    this.list.addEventListener('scroll', () => { this.dirty = true; });
    this.list.addEventListener('keydown', e => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault(); this.pause();
      let index = this.selected == null ? 0 : Math.max(0, this.ids.indexOf(this.selected));
      if (e.key === 'ArrowDown') index++;
      if (e.key === 'ArrowUp') index--;
      if (e.key === 'Home') index = 0;
      if (e.key === 'End') index = this.ids.length - 1;
      if (e.key === 'PageDown') index += Math.floor(this.list.clientHeight / ROW);
      if (e.key === 'PageUp') index -= Math.floor(this.list.clientHeight / ROW);
      index = Math.max(0, Math.min(this.ids.length - 1, index));
      if (this.ids[index] != null) {
        this.select(this.ids[index]);
        if (index * ROW < this.list.scrollTop || (index + 1) * ROW > this.list.scrollTop + this.list.clientHeight)
          this.list.scrollTop = Math.max(0, index * ROW - this.list.clientHeight / 2);
      }
    });
  }

  get isOpen(): boolean { return this.root.open; }
  open(): void {
    if (this.isOpen) return;
    this.previousFocus = document.activeElement as HTMLElement;
    this.beforeOpen();
    this.root.showModal(); this.dirty = true;
    this.render();
    this.timer = window.setInterval(() => this.render(), 100);
    this.root.querySelector<HTMLInputElement>('input')!.focus();
  }
  close(): void {
    if (!this.isOpen) return;
    window.clearInterval(this.timer); this.timer = undefined;
    window.clearTimeout(this.searchTimer); this.searchTimer = undefined;
    this.root.close(); this.rows.replaceChildren(); this.detail.replaceChildren();
    this.ids = []; this.renderedDetail = undefined;
    this.previousFocus?.focus(); this.previousFocus = null;
  }
  private pause(): void {
    if (!this.following) return;
    this.following = false; this.pauseAt = this.store.lastId; this.dirty = true;
  }
  private follow(): void { this.following = true; this.dirty = true; }
  private select(id: number): void { this.pause(); this.selected = id; this.dirty = true; }
  private pivot(pivot: Pivot): void {
    this.back.push({ ...this.filter });
    if (this.back.length > 20) this.back.shift();
    // Start from all event types so a firewall selection can reveal DNS/DHCP too.
    this.filter = { ...emptyFilter(), pivot };
    this.syncFilters();
  }
  private applyFilter(key: 'search' | 'type' | 'action' | 'host', value: string): void {
    this.filter[key] = value;
    this.dirty = true;
    this.list.scrollTop = 0;
  }
  private syncFilters(): void {
    // A pending keystroke must not resurrect the old query after a pivot/reset.
    window.clearTimeout(this.searchTimer); this.searchTimer = undefined;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-filter]').forEach(input => {
      input.value = this.filter[input.dataset.filter as 'search' | 'type' | 'action' | 'host'];
    });
    this.list.scrollTop = 0; this.dirty = true;
  }
  private async copy(button: HTMLButtonElement): Promise<void> {
    const record = this.selected == null ? undefined : this.store.records.get(this.selected);
    if (!record) return;
    try {
      await navigator.clipboard.writeText(button.dataset.format === 'raw' ? record.event.raw_log ?? '' : JSON.stringify(record.event, null, 2));
      button.textContent = 'Copied';
    } catch { button.textContent = 'Copy unavailable — select text instead'; }
  }

  private render(): void {
    if (!this.isOpen) return;
    const changed = this.version !== this.store.version;
    const oldFirst = this.ids[Math.floor(this.list.scrollTop / ROW)];
    if (changed || this.dirty) {
      this.ids = [];
      for (const record of this.store.records.values()) {
        if ((!this.following && record.id > this.pauseAt) || !matches(record, this.filter)) continue;
        this.ids.push(record.id);
      }
      this.space.style.height = `${Math.max(this.ids.length * ROW, 1)}px`;
      if (this.following) this.list.scrollTop = this.list.scrollHeight;
      else if (changed && oldFirst != null) {
        const index = this.ids.indexOf(oldFirst);
        if (index >= 0) this.list.scrollTop = index * ROW + this.list.scrollTop % ROW;
      }
      const start = Math.max(0, Math.floor(this.list.scrollTop / ROW) - 4);
      const end = Math.min(this.ids.length, start + Math.ceil(this.list.clientHeight / ROW) + 9);
      this.rows.style.transform = `translateY(${start * ROW}px)`;
      const fragment = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        const record = this.store.records.get(this.ids[i])!;
        const ev = record.event;
        const row = element('div', '', `log-row ${eventClass(ev)}${record.id === this.selected ? ' selected' : ''}`);
        row.dataset.id = String(record.id); row.id = `log-event-${record.id}`;
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(record.id === this.selected));
        row.setAttribute('aria-posinset', String(i + 1)); row.setAttribute('aria-setsize', String(this.ids.length));
        row.append(element('time', ev.timestamp.slice(11, 19) || '—'),
          element('span', ev.threat ? 'THREAT' : (ev.rule_action || ev.log_type).toUpperCase(), 'log-badge'),
          element('span', summary(ev), 'log-summary'));
        fragment.append(row);
      }
      if (!this.ids.length) fragment.append(element('p', this.store.records.size ? 'No matching events in this view.' : 'Waiting for events…', 'log-empty'));
      this.rows.replaceChildren(fragment);
      this.rows.classList.toggle('arriving', changed && this.following);
      if (this.selected != null && this.rows.querySelector(`#log-event-${this.selected}`))
        this.list.setAttribute('aria-activedescendant', `log-event-${this.selected}`);
      else this.list.removeAttribute('aria-activedescendant');
      this.renderChips();
      this.version = this.store.version; this.dirty = false;
    }
    const pending = this.following ? 0 : this.store.lastId - this.pauseAt;
    this.liveButton.textContent = this.following ? 'Pause' : `Follow live · ${pending} new`;
    const status = `${this.following ? 'LIVE' : 'PAUSED'} · ${this.ids.length} matching / ${this.store.records.size} retained · ${(this.store.bytes / 1024 / 1024).toFixed(2)} MiB text`;
    if (this.status.textContent !== status) this.status.textContent = status;
    this.renderDetails(); this.drawSpark();
  }
  private renderChips(): void {
    // Do not replace focused controls on each incoming batch.
    const key = JSON.stringify([this.filter, this.back.length]);
    if (this.chips.dataset.key === key) return;
    this.chips.dataset.key = key; this.chips.replaceChildren();
    const button = (text: string, command: string) => {
      const b = element('button', text); b.type = 'button'; b.dataset.command = command; this.chips.append(b);
    };
    if (this.back.length) button('← Back', 'back');
    if (this.filter.pivot) button(`${this.filter.pivot.field}: ${this.filter.pivot.value} ×`, 'unpivot');
    if (Object.values(this.filter).some(Boolean)) button('Reset filters', 'reset');
  }
  private renderDetails(): void {
    const record = this.selected == null ? undefined : this.store.records.get(this.selected);
    const expired = this.selected != null && !record;
    if (this.detail.childNodes.length && this.renderedDetail === this.selected && this.expiredDetail === expired) return;
    this.renderedDetail = this.selected; this.expiredDetail = expired;
    this.detail.replaceChildren();
    if (!record) {
      this.detail.append(element('p', expired ? 'Event no longer retained.' : 'Select an event to inspect its fields and follow related traffic.', 'log-empty'));
      return;
    }
    const ev = record.event;
    this.detail.append(element('h3', ev.threat ? 'THREAT DETECTION' : ev.log_type.toUpperCase(), eventClass(ev)),
      element('p', ev.timestamp), element('div', `${ev.src_ip ?? ev.mac_address ?? 'Unknown source'} → ${ev.dst_ip ?? ev.dns_query ?? ev.syslog_host ?? 'Unknown destination'}`, 'log-endpoints'));
    if (record.truncated) this.detail.append(element('p', 'Truncated to fit retention limits. Copied data contains only retained text.', 'log-truncated'));
    const dl = element('dl');
    for (const [key, value] of Object.entries(ev)) {
      if (key === 'raw_log' || value == null || value === '') continue;
      dl.append(element('dt', key.replaceAll('_', ' ')));
      const dd = element('dd');
      const pivot = ['src_ip', 'dst_ip'].includes(key) ? 'ip' : key === 'mac_address' ? 'mac' : ['syslog_host', 'hostname'].includes(key) ? 'host' : undefined;
      if (pivot) { const b = element('button', String(value)); b.type = 'button'; b.dataset.pivot = pivot; b.title = `Follow ${pivot}`; dd.append(b); }
      else dd.textContent = String(value);
      dl.append(dd);
    }
    this.detail.append(dl);
    const copy = element('button', 'Copy event JSON'); copy.type = 'button'; copy.dataset.command = 'copy';
    this.detail.append(copy);
    const raw = element('details'); raw.append(element('summary', 'Raw syslog'));
    raw.append(element('pre', ev.raw_log || 'Raw syslog is not available for this event.'));
    if (ev.raw_log) {
      const b = element('button', 'Copy raw syslog'); b.type = 'button'; b.dataset.command = 'copy'; b.dataset.format = 'raw'; raw.append(b);
    }
    this.detail.append(raw);
  }
  private drawSpark(): void {
    const ctx = this.spark.getContext('2d'); if (!ctx) return;
    const now = Math.floor(Date.now() / 1000);
    const counts = Array.from({ length: 60 }, (_, i) => {
      const second = now - 59 + i; const b = this.store.buckets[((second % 60) + 60) % 60];
      return b.second === second ? b.count : 0;
    });
    const max = Math.max(1, ...counts);
    ctx.clearRect(0, 0, 180, 28); ctx.fillStyle = '#46f0d9';
    counts.forEach((count, i) => ctx.fillRect(i * 3, 28 - count / max * 26, 2, Math.max(1, count / max * 26)));
  }
}

import type { State, Weather } from '../state';
import { isInternalIp } from '../state';
import type { Settings } from '../settings';
import type { Audio } from '../audio';
import type { NetEvent } from '../types';


export class Hud {
  private root: HTMLElement;
  private threatFill!: HTMLElement;
  private energyFill!: HTMLElement;
  private weatherEl!: HTMLElement;
  private rateEl!: HTMLElement;
  private connEl!: HTMLElement;
  private terminal!: HTMLElement;
  private scope!: HTMLCanvasElement;
  private scopeCtx: CanvasRenderingContext2D;
  private radar!: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private sweep = 0;
  private blips: Array<{ a: number; r: number; age: number; color: string }> = [];
  private fluxPhase = 0;
  private scrollY = 0;
  private scrollSpeed = 8;
  private queue: Array<{ text: string; key: string; cls: string; count: number }> = [];
  private statAcc = 0;
  private readonly t0 = Date.now();
  private nTotal = 0;
  private nDenied = 0;
  private clientSet = new Set<string>();
  private hostSet = new Set<string>();
  private wanted = new Map<string, number>();
  private spec = new Array<number>(28).fill(0);
  private specView = new Array<number>(28).fill(0.08);
  private audio: Audio | null = null;
  private specBuf = new Uint8Array(64);
  private specT = 0;
  private specCtx: CanvasRenderingContext2D;
  private static readonly BANDS: Record<string, [number, number]> = {
    wifi: [0, 4], dhcp: [5, 8], dns: [9, 14], allow: [15, 19], block: [20, 27],
  };
  private static readonly BAND_COLOR = [
    '#c08cff', '#c08cff', '#c08cff', '#c08cff', '#c08cff',
    '#ffd84d', '#ffd84d', '#ffd84d', '#ffd84d',
    '#55b5ff', '#55b5ff', '#55b5ff', '#55b5ff', '#55b5ff', '#55b5ff',
    '#5ce6a4', '#5ce6a4', '#5ce6a4', '#5ce6a4', '#5ce6a4',
    '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b',
  ];

  constructor(settings: Settings) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="scanlines" style="display:none"></div>
      <div class="corner tl"></div><div class="corner tr"></div>
      <div class="corner bl"></div><div class="corner br"></div>
      <div id="hud-topleft" class="panel">
        <div class="panel-head">◢ UPLINK</div>
        <div id="conn"><span id="conn-dot"></span><span id="conn-text">LINK</span></div>
        <div id="weather">CALM</div>
      </div>
      <div id="hud-bars" class="panel">
        <div class="panel-head">◢ SHIP STATUS</div>
        <div class="bar-row"><span class="bar-label">THR<span id="threat-num">15</span></span>
          <div class="bar"><div id="threat-fill"></div></div></div>
        <div class="bar-row"><span class="bar-label">PWR<span id="energy-num">30</span></span>
          <div class="bar"><div id="energy-fill"></div></div></div>
      </div>
      <div id="hud-stats" class="panel">
        <div class="panel-head">◢ TELEMETRY</div>
        <div class="stat-row"><span>UPTIME</span><b id="stat-uptime">00:00:00</b></div>
        <div class="stat-row"><span>CONTACTS</span><b id="stat-clients">0</b></div>
        <div class="stat-row"><span>NODES</span><b id="stat-nodes">0</b></div>
        <div class="stat-row"><span>DENIED</span><b id="stat-denied">0</b></div>
        <div class="stat-row"><span>TRAFFIC</span><b id="stat-total">0</b></div>
      </div>
      <div id="hud-mw" class="panel">
        <div class="panel-head">◢ MOST WANTED</div>
        <div id="mw-body"><div class="mw-empty">— NO HOSTILES —</div></div>
      </div>
      <div id="hud-spec" class="panel">
        <div class="panel-head">◢ SUBSPACE SPECTRUM</div>
        <canvas id="spec" width="236" height="52"></canvas>
      </div>
      <div id="scope-wrap" class="panel">
        <div class="panel-head">◢ SENSOR FLUX</div>
        <canvas id="scope" width="220" height="48"></canvas>
        <div id="rate">0 ev/s</div>
      </div>
      <div id="radar-wrap" class="panel">
        <div class="panel-head">◢ SCAN</div>
        <canvas id="radar" width="110" height="110"></canvas>
      </div>
      <div id="terminal" class="panel">
        <div class="panel-head">◢ COMMS LOG<span class="cursor">▮</span></div>
        <div class="log-wrap"><div id="terminal-body"></div></div>
      </div>
      <div id="demo-badge" style="display:none">DEMO DATA</div>
      <div id="hint">F1 settings</div>`;
    document.body.appendChild(this.root);

    this.threatFill = q('threat-fill');
    this.energyFill = q('energy-fill');
    this.weatherEl = q('weather');
    this.rateEl = q('rate');
    this.connEl = q('conn-dot');
    this.terminal = q('terminal-body');
    this.scope = q('scope') as HTMLCanvasElement;
    this.scopeCtx = this.scope.getContext('2d')!;
    this.radar = q('radar') as HTMLCanvasElement;
    this.radarCtx = this.radar.getContext('2d')!;
    this.specCtx = (q('spec') as HTMLCanvasElement).getContext('2d')!;

    this.applySettings(settings);
  }

  applySettings(s: Settings): void {
    q('scanlines').style.display = s.scanlines ? '' : 'none';
    q('terminal').style.display = s.terminal ? '' : 'none';
    q('scope-wrap').style.display = s.oscilloscope ? '' : 'none';
    q('hud-bars').style.display = s.threatBar ? '' : 'none';
    q('hud-stats').style.display = s.telemetry ? '' : 'none';
    q('hud-mw').style.display = s.mostWanted ? '' : 'none';
    q('hud-spec').style.display = s.spectrum ? '' : 'none';
    q('radar-wrap').style.display = s.radar ? '' : 'none';
    q('hud-topleft').style.display = s.uplink ? '' : 'none';
  }

  setConnected(on: boolean): void {
    this.connEl.style.background = on ? '#45ff9b' : '#ff5a5a';
    this.connEl.style.boxShadow = `0 0 8px ${on ? '#45ff9b' : '#ff5a5a'}`;
  }

  showDemo(on: boolean): void {
    q('demo-badge').style.display = on ? '' : 'none';
  }

  private names = new Map<string, string>();   // MAC → hostname learned from DHCP

  log(ev: NetEvent): void {
    if (ev.mac_address && ev.hostname) this.names.set(ev.mac_address.toLowerCase(), ev.hostname);
    const t = (ev.timestamp || '').slice(11, 19);
    const who = ev.mac_address
      ? (this.names.get(ev.mac_address.toLowerCase()) ?? `:${ev.mac_address.slice(-5)}`)
      : '';
    let msg = '';
    switch (ev.log_type) {
      case 'firewall': {
        const dir = isInternalIp(ev.src_ip) && isInternalIp(ev.dst_ip)
          ? 'internal' : (ev.direction ?? '-');
        msg = `${(ev.rule_action ?? '?').toUpperCase()} ${ev.src_ip} → ${ev.dst_ip}` +
              ` ${ev.service_name ?? ev.dst_port ?? ''} [${dir}]` +
              (ev.rule_name ? ` (${ev.rule_name})` : '');
        break;
      }
      case 'dns':
        msg = `DNS ${ev.src_ip ? ev.src_ip + ' → ' : ''}${ev.dns_query ?? ''}` +
              (ev.dns_answer ? ` → ${ev.dns_answer}` : '');
        break;
      case 'dhcp':
        msg = `DHCP ${ev.dhcp_event ?? ''} ${ev.hostname || who} ${ev.src_ip ?? ''}` +
              (ev.syslog_host ? ` @ ${ev.syslog_host}` : '');
        break;
      case 'wifi':
        msg = `WIFI ${ev.wifi_event ?? '?'} ${who}` +
              (ev.wifi_reason ? ` (${ev.wifi_reason})` : '') +
              (ev.syslog_host ? ` @ ${ev.syslog_host}` : '');
        break;
      default: msg = `SYS ${syslogMsg(ev.raw_log)}`;
    }
    const key = msg.replace(/\s+/g, ' ').trim();
    const tail = this.queue[this.queue.length - 1];
    if (tail && tail.key === key) {
      tail.count++;
      tail.text = `${t}  ${key}`;          // keep newest timestamp
    } else {
      const cls = `log-${ev.log_type}${ev.rule_action === 'block' ? ' log-block' : ''}`;
      this.queue.push({ text: `${t}  ${key}`, key, cls, count: 1 });
      if (this.queue.length > 1200) this.queue.shift();
    }
    this.addBlip(ev);

    this.nTotal++;
    if (ev.log_type === 'firewall' && ev.rule_action === 'block') {
      this.nDenied++;
      if (ev.dst_ip) this.wanted.set(ev.dst_ip, (this.wanted.get(ev.dst_ip) ?? 0) + 1);
      this.bumpBand('block');
    } else if (ev.log_type === 'firewall') {
      this.bumpBand('allow');
    } else {
      this.bumpBand(ev.log_type);
    }
    if (ev.mac_address) this.clientSet.add(ev.mac_address.toLowerCase());
    if (ev.syslog_host) this.hostSet.add(ev.syslog_host);
  }

  private feedTick(dt: number): void {
    const LINE = 16, VIS = 13;
    // pace comes from queue pressure: whatever is waiting must be shown
    // within ~1.2s, so the feed always keeps up with incoming traffic
    const target = LINE * Math.min(30, Math.max(0.5, this.queue.length / 1.2));
    const ease = target > this.scrollSpeed ? 4 : 0.8;
    this.scrollSpeed += (target - this.scrollSpeed) * Math.min(1, dt * ease);

    while (this.terminal.children.length < VIS && this.queue.length) {
      this.appendLine(this.queue.shift()!);
    }
    if (this.terminal.children.length < VIS) {
      this.terminal.style.transform = 'none';
      return;
    }

    if (this.queue.length) {
      this.scrollY += this.scrollSpeed * dt;
    } else {
      // nothing waiting: settle back to the rest position instead of
      // accumulating offset that would scroll the window into emptiness
      this.scrollY += (0 - this.scrollY) * Math.min(1, dt * 3);
    }
    while (this.scrollY >= LINE) {
      const next = this.queue.shift();
      if (!next) { this.scrollY = LINE - 0.01; break; }
      this.terminal.removeChild(this.terminal.firstChild!);
      this.appendLine(next);
      this.scrollY -= LINE;
    }
    this.terminal.style.transform = `translateY(${-this.scrollY}px)`;
  }

  private appendLine(item: { text: string; cls: string; count: number }): void {
    const div = document.createElement('div');
    div.className = item.cls;
    div.textContent = item.count > 1 ? `${item.text}  \u00d7${item.count}` : item.text;
    this.terminal.appendChild(div);
  }

  private bumpBand(type: string): void {
    const band = Hud.BANDS[type] ?? Hud.BANDS.allow;
    const i = band[0] + Math.floor(Math.random() * (band[1] - band[0] + 1));
    this.spec[i] = Math.min(1, this.spec[i] + 0.25 + Math.random() * 0.2);
  }

  attachAudio(a: Audio): void { this.audio = a; }

  private drawSpectrum(dt: number): void {
    const c = this.specCtx;
    const w = 236, h = 52, n = this.spec.length;
    const bw = w / n - 2;
    const decay = Math.exp(-dt * 1.6);
    this.specT += dt;
    const t = this.specT;
    const live = this.audio ? this.audio.spectrumLevels(this.specBuf) : false;
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      this.spec[i] *= decay;
      let target: number;
      if (live) {
        // actual mix FFT, log-ish spread across the band
        const bin = 1 + Math.floor(Math.pow(i / (n - 1), 1.35) * 40);
        const raw = Math.max(0, this.specBuf[Math.min(bin, 63)] / 255 - 0.09);
        target = 0.04 + Math.min(1, raw * 1.9);
      } else {
        // no audio yet: idle carrier so the instrument still breathes
        const wave = 0.5
          + 0.32 * Math.sin(t * 2.3 + i * 0.9)
          + 0.18 * Math.sin(t * 5.1 + i * 1.7)
          + 0.14 * Math.sin(t * 0.7 - i * 0.5);
        target = 0.07 + Math.min(1, this.spec[i]) * 0.55
          + wave * (0.08 + Math.min(1, this.spec[i]) * 0.4);
      }
      this.specView[i] += (target - this.specView[i]) * Math.min(1, dt * (live ? 14 : 6));
      const v = Math.min(1, this.specView[i]);
      const bh = v * (h - 6);
      c.fillStyle = Hud.BAND_COLOR[i];
      c.globalAlpha = 0.35 + v * 0.6;
      c.fillRect(i * (bw + 2), h - bh, bw, bh);
      c.globalAlpha = 0.9;
      c.fillRect(i * (bw + 2), h - bh, bw, 2);
    }
    c.globalAlpha = 1;
  }

  private drawMostWanted(): void {
    const el = q('mw-body');
    const top = [...this.wanted.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) {
      el.innerHTML = '<div class="mw-empty">— NO HOSTILES —</div>';
      return;
    }
    const max = top[0][1];
    el.innerHTML = top.map(([ip, n], i) => `
      <div class="mw-row">
        <span class="mw-rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="mw-ip">${ip}</span>
        <div class="mw-bar"><i style="width:${(n / max * 100).toFixed(0)}%"></i></div>
        <span class="mw-n">${fmt(n)}</span>
      </div>`).join('');
  }

  private updateStats(): void {
    const up = Math.floor((Date.now() - this.t0) / 1000);
    const hh = String(Math.floor(up / 3600)).padStart(2, '0');
    const mm = String(Math.floor(up / 60) % 60).padStart(2, '0');
    const ss = String(up % 60).padStart(2, '0');
    q('stat-uptime').textContent = `${hh}:${mm}:${ss}`;
    q('stat-clients').textContent = String(this.clientSet.size);
    q('stat-nodes').textContent = String(this.hostSet.size);
    q('stat-denied').textContent = fmt(this.nDenied);
    q('stat-total').textContent = fmt(this.nTotal);
  }

  private tick = 0;

  update(dt: number, state: State, settings: Settings): void {
    if (settings.threatBar) {
      this.threatFill.style.width = `${(state.threat * 100).toFixed(1)}%`;
      this.energyFill.style.width = `${(state.energy * 100).toFixed(1)}%`;
      q('threat-num').textContent = ` ${(state.threat * 100).toFixed(0)}`;
      q('energy-num').textContent = ` ${(state.energy * 100).toFixed(0)}`;
    }
    if (settings.radar) this.drawRadar(dt);
    const wLabel: Record<Weather, string> = { calm: 'CALM', storm: 'STORM', hurricane: 'HURRICANE' };
    this.weatherEl.textContent = wLabel[state.weather];
    this.weatherEl.style.color = state.weather === 'hurricane' ? '#ff5a5a'
      : state.weather === 'storm' ? '#ffd24a' : '#45ff9b';

    // sensor flux: sine whose frequency IS the event rate (1 ev/s = 1 cycle/s)
    const eps = state.rate30s / 30;

    if (settings.terminal) this.feedTick(dt);
    if (settings.spectrum) this.drawSpectrum(dt);
    this.fluxPhase = (this.fluxPhase + dt * eps) % 1;
    if (settings.oscilloscope) this.drawFlux(eps, state.heat);

    this.tick += dt;
    if (this.tick >= 0.2) {
      this.tick = 0;
      this.rateEl.textContent = `${eps.toFixed(1)} ev/s`;
    }
    this.statAcc += dt;
    if (this.statAcc >= 0.5) {
      this.statAcc = 0;
      if (settings.telemetry) this.updateStats();
      if (settings.mostWanted) this.drawMostWanted();
    }
  }

  private addBlip(ev: NetEvent): void {
    if (this.blips.length > 60) this.blips.shift();
    const key = ev.mac_address ?? ev.src_ip ?? ev.syslog_host ?? 'x';
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const u = (h >>> 0) / 4294967296;
    const colors: Record<string, string> = {
      firewall: ev.rule_action === 'block' ? '#ff6b6b' : '#5ce6a4',
      dns: '#55b5ff', dhcp: '#ffd84d', wifi: '#c08cff', system: '#7d99b3',
    };
    this.blips.push({
      a: u * Math.PI * 2,
      r: 0.25 + ((h >>> 8) % 100) / 100 * 0.62,
      age: 0,
      color: colors[ev.log_type] ?? '#7d99b3',
    });
  }

  private drawRadar(dt: number): void {
    const c = this.radarCtx;
    const S = this.radar.width, R = S / 2, mid = S / 2;
    this.sweep = (this.sweep + dt * 1.6) % (Math.PI * 2);
    c.clearRect(0, 0, S, S);
    c.strokeStyle = 'rgba(70,240,217,0.35)';
    c.lineWidth = 1;
    for (const rr of [0.32, 0.62, 0.95]) {
      c.beginPath(); c.arc(mid, mid, R * rr, 0, Math.PI * 2); c.stroke();
    }
    c.beginPath();
    c.moveTo(mid - R, mid); c.lineTo(mid + R, mid);
    c.moveTo(mid, mid - R); c.lineTo(mid, mid + R);
    c.stroke();
    // sweep wedge
    const grad = c.createConicGradient(this.sweep, mid, mid);
    grad.addColorStop(0, 'rgba(70,240,217,0.30)');
    grad.addColorStop(0.12, 'rgba(70,240,217,0)');
    grad.addColorStop(1, 'rgba(70,240,217,0)');
    c.fillStyle = grad;
    c.beginPath(); c.arc(mid, mid, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(70,240,217,0.8)';
    c.beginPath();
    c.moveTo(mid, mid);
    c.lineTo(mid + Math.cos(this.sweep) * R, mid + Math.sin(this.sweep) * R);
    c.stroke();
    // blips light up as the sweep passes over them, then decay
    for (let i = this.blips.length - 1; i >= 0; i--) {
      const b = this.blips[i];
      b.age += dt;
      if (b.age > 6) { this.blips.splice(i, 1); continue; }
      let d = Math.abs(((this.sweep - b.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      d = Math.PI - d;
      const lit = d < 0.18 ? 1 : 0;
      const base = Math.max(0, 1 - b.age / 6);
      const alpha = Math.max(lit, base * 0.25 + (lit ? base : 0));
      c.fillStyle = b.color;
      c.globalAlpha = Math.min(1, alpha * (lit ? 1 : base));
      c.beginPath();
      c.arc(mid + Math.cos(b.a) * R * b.r, mid + Math.sin(b.a) * R * b.r, lit ? 2.4 : 1.6, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  private drawFlux(eps: number, heat: number): void {
    const c = this.scopeCtx;
    const w = this.scope.width, h = this.scope.height;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(70,240,217,0.12)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();

    const f = Math.min(8, Math.max(0.12, eps));
    const cycles = Math.min(6, Math.max(0.35, f * 1.4));
    const amp = Math.min(1, 0.14 + eps / 12 + heat * 0.4) * (h / 2 - 4);
    c.strokeStyle = 'rgba(70,240,217,0.95)';
    c.lineWidth = 1.3;
    c.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = h / 2 + Math.sin((x / w) * cycles * Math.PI * 2
        + this.fluxPhase * Math.PI * 2) * amp;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }
}

function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function q(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function syslogMsg(raw?: string): string {
  if (!raw) return '';
  let s = raw.replace(/^<\d+>/, '').trim();
  const parts = s.split(/\s+/);
  // BSD syslog header: Mon DD HH:MM:SS host <message...>
  if (parts.length > 4) s = parts.slice(4).join(' ');
  return s.length > 72 ? s.slice(0, 69) + '…' : s;
}

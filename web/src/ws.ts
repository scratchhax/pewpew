import type { NetEvent, ServerMessage, StreamMeta } from './types';

export type EventHandler = (ev: NetEvent, meta?: StreamMeta) => void;
export type SnapshotHandler = (evs: NetEvent[], meta?: StreamMeta) => void;

// Neutral demo identities — no invented personal names.
// Override with ?hosts=Router,Kitchen-AP,Den-AP to preview your real topology.
const DEMO_HOSTS =
  new URLSearchParams(location.search).get('hosts')?.split(',').map(s => s.trim()).filter(Boolean)
  ?? ['GATEWAY', 'AP-1', 'AP-2', 'AP-3'];
const GW = DEMO_HOSTS[0];
const devName = (mac: string) => `dev-${mac.replace(/:/g, '').slice(-4)}`;
const DEMO_LAN = Array.from({ length: 30 }, (_, i) => `192.168.1.${10 + i}`);
const DEMO_WAN = Array.from({ length: 40 }, (_, i) => `${10 + (i % 200)}.${(i * 7) % 256}.${(i * 31) % 256}.${(i * 53) % 254 + 1}`);
const DEMO_DOMAINS = ['github.com', 'discord.com', 'netflix.com', 'apple.com', 'googleapis.com', 'plex.tv', 'espn.com'];
const DEMO_SERVICES: Array<[number, string, string]> = [
  [443, 'https', 'tcp'], [80, 'http', 'tcp'], [53, 'dns', 'udp'],
  [8443, 'https-alt', 'tcp'], [22, 'ssh', 'tcp'], [51820, 'wireguard', 'udp'],
];

const rnd = Math.random;
const pick = <T,>(a: T[]): T => a[(rnd() * a.length) | 0];
const rndMac = () =>
  Array.from({ length: 6 }, () => (rnd() * 256 | 0).toString(16).padStart(2, '0')).join(':');

function isoNow(): string { return new Date().toISOString(); }

function demoEvent(blockBias = 0.18): NetEvent {
  const roll = rnd();
  if (roll < 0.6) {
    const [port, service, proto] = pick(DEMO_SERVICES);
    const blocked = rnd() < blockBias;
    const inbound = rnd() < 0.3;
    const lan = pick(DEMO_LAN), wan = pick(DEMO_WAN);
    return {
      log_type: 'firewall', timestamp: isoNow(),
      rule_name: blocked ? pick(['Block LAN to WAN', 'Drop Invalid', 'Block RDP'])
                         : pick(['Allow LAN to WAN', 'Allow Established', 'Guest Net Allow']),
      rule_action: blocked ? 'block' : 'allow',
      direction: inbound ? 'inbound' : 'outbound',
      interface_in: inbound ? 'WAN' : 'LAN',
      interface_out: inbound ? 'LAN' : 'WAN',
      src_ip: inbound ? wan : lan,
      dst_ip: inbound ? lan : wan,
      src_port: 1024 + ((rnd() * 64000) | 0),
      dst_port: port, protocol: proto, service_name: service,
      mac_address: rndMac(), syslog_host: GW,
    };
  }
  if (roll < 0.78) {
    return { log_type: 'dns', timestamp: isoNow(), dns_type: 'A',
             dns_query: pick(DEMO_DOMAINS), src_ip: pick(DEMO_LAN), syslog_host: GW };
  }
  if (roll < 0.87) {
    const mac = rndMac();
    return { log_type: 'dhcp', timestamp: isoNow(), dhcp_event: 'DHCPACK',
             src_ip: pick(DEMO_LAN), mac_address: mac,
             hostname: devName(mac), syslog_host: GW };
  }
  if (roll < 0.97) {
    return { log_type: 'wifi', timestamp: isoNow(),
              wifi_event: pick(['associated', 'disassociated', 'authenticated']),
              mac_address: rndMac(), syslog_host: pick(DEMO_HOSTS) };
  }
  return { log_type: 'system', timestamp: isoNow(), syslog_host: pick(DEMO_HOSTS) };
}

/**
 * Connects to the relay WS; auto-reconnects.
 * If `?demo=1` in the URL (or connect fails and demoFallback), runs the
 * built-in generator instead.
 */
export class Feed {
  private ws: WebSocket | null = null;
  private demoTimer = 0;
  private retries = 0;
  readonly demoMode: boolean;

  constructor(private onEvent: EventHandler, private onSnapshot: SnapshotHandler) {
    const params = new URLSearchParams(location.search);
    this.demoMode = params.has('demo');
    if (this.demoMode) this.startDemo(); else this.connect();
  }

  private startDemo(): void {
    const params = new URLSearchParams(location.search);
    // seed a snapshot so the screen isn't empty at load
    const seed: NetEvent[] = [];
    for (let i = 0; i < 24; i++) seed.push(demoEvent());
    this.onSnapshot(seed, { demo: true });

    const emit = (n: number, bias: number) => {
      for (let i = 0; i < n; i++) this.onEvent(demoEvent(bias), { demo: true });
    };

    if (params.has('showreel')) {
      // 60s story arc, looping: cruise → build → hurricane → cooldown
      const phases = [
        { t: 0, rate: 3, bias: 0.18 },
        { t: 15, rate: 15, bias: 0.3 },
        { t: 30, rate: 70, bias: 0.65 },
        { t: 45, rate: 2, bias: 0.15 },
      ];
      let t0 = performance.now();
      const tick = () => {
        let el = (performance.now() - t0) / 1000;
        if (el >= 60) { t0 = performance.now(); el = 0; }
        let p = phases[0];
        for (const c of phases) if (el >= c.t) p = c;
        emit(1, p.bias);
        if (rnd() < 0.08) emit((rnd() * p.rate / 12) | 0, p.bias);
        this.demoTimer = window.setTimeout(tick, (1000 / p.rate) * (0.6 + rnd() * 0.8));
      };
      tick();
      return;
    }

    const rate = parseFloat(params.get('rate') ?? '');
    const bias = parseFloat(params.get('block') ?? '') / 100 || 0.18;
    if (rate > 0) {
      const tick = () => {
        emit(1, bias);
        if (rnd() < 0.08) emit(2 + ((rnd() * 5) | 0), bias);
        this.demoTimer = window.setTimeout(tick, (1000 / rate) * (0.5 + rnd()));
      };
      tick();
      return;
    }

    const tick = () => {
      const burst = rnd() < 0.08 ? 2 + ((rnd() * 5) | 0) : 1;
      emit(burst, 0.18);
      this.demoTimer = window.setTimeout(tick, 300 + rnd() * 1900);
    };
    tick();
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onmessage = (m) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'snapshot') this.onSnapshot(msg.events, msg.meta);
      else if (msg.type === 'event') this.onEvent(msg.event, msg.meta);
    };
    ws.onopen = () => { this.retries = 0; };
    ws.onclose = () => {
      this.retries++;
      const delay = Math.min(10_000, 500 * 2 ** Math.min(this.retries, 5));
      setTimeout(() => this.connect(), delay);
    };
  }
}

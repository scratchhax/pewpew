import type { NetEvent } from './types';

export const MAX_EVENTS = 5000;
export const MAX_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_EVENT_BYTES = 16 * 1024;
const fields = ['log_type', 'timestamp', 'syslog_host', 'rule_name', 'rule_desc',
  'rule_action', 'direction', 'interface_in', 'interface_out', 'src_ip', 'dst_ip',
  'src_port', 'dst_port', 'protocol', 'service_name', 'mac_address', 'threat',
  'dns_type', 'dns_query', 'dns_answer', 'dhcp_event', 'hostname', 'wifi_event',
  'wifi_reason', 'raw_log'] as const;

export interface LogRecord {
  id: number;
  event: NetEvent;
  bytes: number;
  truncated: boolean;
  /**
   * Lowercased text of every retained field, built on the first search that
   * reaches this record and kept until it is evicted. Re-lowercasing 5,000
   * records ten times a second is what makes filtering hurt on a Pi.
   */
  haystack?: string;
}
export interface Pivot { field: 'ip' | 'mac' | 'host'; value: string }
export interface LogFilter { search: string; type: string; action: string; host: string; pivot?: Pivot }

export function matches(record: LogRecord, filter: LogFilter): boolean {
  const e = record.event;
  if (filter.type === 'threat' ? !e.threat : filter.type && e.log_type !== filter.type) return false;
  if (filter.action && e.rule_action !== filter.action) return false;
  if (filter.host && e.syslog_host !== filter.host) return false;
  const p = filter.pivot;
  if (p) {
    const values = p.field === 'ip' ? [e.src_ip, e.dst_ip]
      : p.field === 'mac' ? [e.mac_address] : [e.syslog_host, e.hostname];
    if (!values.some(v => v != null && (p.field === 'mac'
      ? v.toLowerCase() === p.value.toLowerCase() : v === p.value))) return false;
  }
  const query = filter.search.trim().toLowerCase();
  if (!query) return true;
  // NUL between fields so a query cannot match across a field boundary.
  record.haystack ??= Object.values(e).map(v => v == null ? '' : String(v)).join('\0').toLowerCase();
  return record.haystack.includes(query);
}

export function eventClass(e: NetEvent): string {
  return e.threat ? 'log-threat' : e.rule_action === 'block' ? 'log-block' :
    ['firewall', 'dns', 'dhcp', 'wifi', 'system'].includes(e.log_type) ? `log-${e.log_type}` : 'log-system';
}

export function summary(e: NetEvent): string {
  switch (e.log_type) {
    case 'firewall': return `${e.src_ip ?? '?'} → ${e.dst_ip ?? '?'} · ${e.service_name ?? e.dst_port ?? '—'} · ${e.rule_desc || e.rule_name || e.direction || 'firewall'}`;
    case 'dns': return `${e.src_ip ?? '?'} → ${e.dns_query ?? '?'}${e.dns_answer ? ` → ${e.dns_answer}` : ''}`;
    case 'dhcp': return `${e.dhcp_event ?? 'DHCP'} · ${e.hostname || e.mac_address || '?'} · ${e.src_ip ?? '—'}`;
    case 'wifi': return `${e.wifi_event ?? 'Wi-Fi'} · ${e.mac_address ?? '?'} · ${e.wifi_reason ?? e.syslog_host ?? ''}`;
    default: return e.raw_log || 'System event';
  }
}

/** One owner for retained payloads; views keep IDs, never copies. */
export class LogStore {
  readonly records = new Map<number, LogRecord>();
  readonly buckets = Array.from({ length: 60 }, () => ({ second: -1, count: 0 }));
  bytes = 0;
  version = 0;
  lastId = 0;
  private seeded = false;

  add(input: NetEvent, live = true): LogRecord {
    let remaining = MAX_EVENT_BYTES;
    let truncated = false;
    const data: Record<string, unknown> = {};
    for (const key of fields) {
      const value = input[key];
      if (typeof value === 'string') {
        // Reserve room for later structured fields; raw text gets the remainder.
        const limit = key === 'raw_log' ? remaining : Math.min(remaining, 1024);
        const slice = value.slice(0, Math.floor(limit / 2));
        // V8 substrings can retain their original backing string. Materialize
        // shortened values so a tiny retained preview cannot pin a huge payload.
        const kept = slice.length < value.length ? slice.split('').join('') : slice;
        data[key] = kept;
        remaining -= kept.length * 2;
        if (kept.length !== value.length) truncated = true;
      } else if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        data[key] = value;
      }
    }
    const record = { id: ++this.lastId, event: data as unknown as NetEvent,
      bytes: MAX_EVENT_BYTES - remaining, truncated };
    this.records.set(record.id, record);
    this.bytes += record.bytes;
    while (this.records.size > MAX_EVENTS || this.bytes > MAX_TEXT_BYTES) {
      const oldest = this.records.keys().next().value!;
      this.bytes -= this.records.get(oldest)!.bytes;
      this.records.delete(oldest);
    }
    if (live) {
      const second = Math.floor(Date.now() / 1000);
      const b = this.buckets[second % 60];
      if (b.second !== second) { b.second = second; b.count = 0; }
      b.count++;
    }
    this.version++;
    return record;
  }

  seed(events: NetEvent[]): void {
    if (this.seeded) return;
    this.seeded = true;
    for (const event of events.slice(-MAX_EVENTS)) this.add(event, false);
  }

  clear(): void {
    this.records.clear();
    this.bytes = 0;
    this.buckets.forEach(b => { b.second = -1; b.count = 0; });
    this.version++;
  }
}

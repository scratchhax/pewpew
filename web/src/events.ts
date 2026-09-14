import type { NetEvent } from './types';
import { isInternalIp } from './state';

/** What an event IS, independent of how any theme draws it. */
export type EventKind = 'allow' | 'block' | 'threat' | 'dns' | 'dhcp' | 'wifi' | 'system';

/** Traffic direction; `internal` = RFC1918 on both ends (no border semantics). */
export type Scope = 'internal' | 'inbound' | 'outbound' | 'local' | 'vpn' | 'inter_vlan' | 'nat';

/** Wi-Fi outcome: a client joining, leaving/failing, or anything else. */
export type WifiOutcome = 'joined' | 'bad' | 'other';

/** A relay event plus the classification every theme needs. */
export interface SceneEvent {
  ev: NetEvent;
  kind: EventKind;
  scope: Scope;
  /** Only for kind === 'wifi'. */
  wifi?: WifiOutcome;
}

const WIFI_BAD = /deauth|disassoc|left|leave|fail|kick|reject|disallow|status [1-9]/;
// matched against the event name alone: the reason is often empty
const WIFI_JOINED = /^(associated|authenticated|joined)$/i;

/** null for a log type the core doesn't know (the HUD still logs it). */
export function classify(ev: NetEvent): SceneEvent | null {
  const scope: Scope = isInternalIp(ev.src_ip) && isInternalIp(ev.dst_ip)
    ? 'internal' : (ev.direction ?? 'local');
  switch (ev.log_type) {
    case 'firewall':
      // IDS/IPS threats are always malicious, whatever the rule action says
      return { ev, scope, kind: ev.threat ? 'threat' : ev.rule_action === 'block' ? 'block' : 'allow' };
    case 'wifi': {
      const e = `${ev.wifi_event ?? ''} ${ev.wifi_reason ?? ''}`.toLowerCase();
      const wifi: WifiOutcome = WIFI_BAD.test(e) ? 'bad'
        : WIFI_JOINED.test((ev.wifi_event ?? '').trim()) ? 'joined' : 'other';
      return { ev, scope, kind: 'wifi', wifi };
    }
    case 'dns':
    case 'dhcp':
    case 'system':
      return { ev, scope, kind: ev.log_type };
    default:
      return null;
  }
}

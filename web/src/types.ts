export type LogType = 'firewall' | 'dns' | 'dhcp' | 'wifi' | 'system';
export type Direction = 'inbound' | 'outbound' | 'local' | 'vpn' | 'inter_vlan' | 'nat';
export type RuleAction = 'allow' | 'block' | 'redirect';

export interface NetEvent {
  log_type: LogType;
  timestamp: string;
  syslog_host?: string;
  raw_log?: string;

  // firewall
  rule_name?: string | null;
  rule_desc?: string | null;
  rule_action?: RuleAction;
  direction?: Direction;
  interface_in?: string | null;
  interface_out?: string | null;
  src_ip?: string | null;
  dst_ip?: string | null;
  src_port?: number | null;
  dst_port?: number | null;
  protocol?: string | null;
  service_name?: string | null;
  mac_address?: string | null;

  // dns
  dns_type?: string;
  dns_query?: string;
  dns_answer?: string;

  // dhcp
  dhcp_event?: string;
  hostname?: string | null;

  // wifi
  wifi_event?: string;
  wifi_reason?: string | null;
}

export interface StreamMeta {
  demo?: boolean;
}

export interface SnapshotMessage {
  type: 'snapshot';
  events: NetEvent[];
  stats?: Record<string, number>;
  meta?: StreamMeta;
}

export interface EventMessage {
  type: 'event';
  event: NetEvent;
  meta?: StreamMeta;
}

export type ServerMessage = SnapshotMessage | EventMessage;

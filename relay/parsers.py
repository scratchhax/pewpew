"""
Syslog parsers — vendored from UniFi-Insights-Plus receiver/parsers.py
(https://github.com/jmasarweh/UniFi-Insights-Plus) with dependencies stripped:

  * services.get_service_name   -> local relay/services.py (trimmed port map)
  * firewall_policy_matcher     -> simplified regex derive_action() below
  * reload_config_from_db       -> configure() with a plain dict (relay.yaml)

Log types: firewall, dns, dhcp, wifi, system
Keep function names/structure close to upstream so future updates can be diffed.
"""

import os
import re
import ipaddress
import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from services import get_service_name

logger = logging.getLogger(__name__)

# ── WAN IP auto-detection ────────────────────────────────────────────────────
_wan_ip = None
WAN_IPS = set()

# ── Syslog header ──────────────────────────────────────────────────────────────
SYSLOG_HEADER = re.compile(
    r'^(?P<month>\w+)\s+(?P<day>\d+)\s+(?P<time>\d+:\d+:\d+)\s+(?P<host>\S+)\s+(?P<body>.+)$'
)

# ── Firewall (iptables/netfilter) ──────────────────────────────────────────────
# PATCH(ewpew): FW_RULE extended to also match modern UDM rule_name="..." (upstream
# only matched legacy [Name]); FW_MAC extended to uppercase hex (kernel logs MAC
# uppercase); FW_IN/FW_OUT made case-insensitive for in=/out= style lines.
FW_RULE     = re.compile(r'rule_name="([^"]*)"')
FW_RULE_LEGACY = re.compile(r'\[([^\]]+)\]')
FW_DESC     = re.compile(r'DESCR="([^"]*)"')
FW_IN       = re.compile(r'\bIN=(\S*)', re.IGNORECASE)
FW_OUT      = re.compile(r'\bOUT=(\S*)', re.IGNORECASE)
FW_SRC      = re.compile(r'SRC=([0-9a-fA-F:.]+)')
FW_DST      = re.compile(r'DST=([0-9a-fA-F:.]+)')
FW_PROTO    = re.compile(r'PROTO=([A-Z]+)')
FW_SPT      = re.compile(r'SPT=(\d+)')
FW_DPT      = re.compile(r'DPT=(\d+)')
FW_MAC      = re.compile(r'MAC=([0-9A-Fa-f:]+)')

# ── DNS (dnsmasq) ─────────────────────────────────────────────────────────────
DNS_QUERY   = re.compile(r'query\[([A-Z]+)\]\s+(\S+)\s+from\s+([0-9a-fA-F:.]+)')
DNS_REPLY   = re.compile(r'reply\s+(\S+)\s+is\s+(.+)')
DNS_FORWARD = re.compile(r'forwarded\s+(\S+)\s+to\s+([0-9a-fA-F:.]+)')
DNS_CACHED  = re.compile(r'cached\s+(\S+)\s+is\s+(.+)')

# ── DHCP (dnsmasq-dhcp) ───────────────────────────────────────────────────────
MAC_PATTERN = r'[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}'
MAC_RE      = re.compile(MAC_PATTERN)
DHCP_ACK    = re.compile(rf'DHCPACK\((\S+)\)\s+([0-9a-fA-F:.]+)\s+({MAC_PATTERN})\s*(\S*)')
DHCP_DISC   = re.compile(rf'DHCPDISCOVER\((\S+)\)\s+(?:([0-9a-fA-F:.]+)\s+)?({MAC_PATTERN})')
DHCP_OFFER  = re.compile(rf'DHCPOFFER\((\S+)\)\s+([0-9a-fA-F:.]+)\s+({MAC_PATTERN})')
DHCP_REQ    = re.compile(rf'DHCPREQUEST\((\S+)\)\s+([0-9a-fA-F:.]+)\s+({MAC_PATTERN})')

# ── WiFi (stamgr / hostapd) ───────────────────────────────────────────────────
WIFI_EVENT  = re.compile(r'(\w+):\s+STA\s+([0-9a-f:]+)')
WIFI_ASSOC  = re.compile(r'STA\s+([0-9a-f:]+)\s+.*?(associated|disassociated|deauthenticated|authenticated)')

# Module-level config (set via configure())
WAN_INTERFACES = {'ppp0'}
WAN_LOCAL_RULE_MARKERS = ('WAN_LOCAL',)

# VPN interface prefix → badge (mirrors upstream)
VPN_PREFIX_BADGES = {
    'wgsrv': 'WGD SRV',
    'wgclt': 'WGD CLT',
    'wgsts': 'S MAGIC',
    'tlprt': 'TELEPORT',
    'vti':   'S2S IPSEC',
    'tunovpnc': 'OVPN CLT',
    'tun':   'OVPN TUN',
    'vtun':  'OVPN VTN',
    'l2tp':  'L2TP SRV',
}
VPN_INTERFACE_PREFIXES = ('wgsrv', 'wgclt', 'wgsts', 'tlprt', 'vti', 'tunovpnc', 'tun', 'vtun', 'l2tp')
VPN_PREFIX_DESCRIPTIONS = {
    'wgsrv': 'WireGuard Server',
    'wgclt': 'WireGuard Client',
    'wgsts': 'Site Magic',
    'tlprt': 'Teleport',
    'vti':   'Site-to-Site IPsec',
    'tunovpnc': 'OpenVPN Client',
    'tun':   'OpenVPN / Tunnel 1',
    'vtun':  'OpenVPN / Tunnel 2',
    'l2tp':  'L2TP Server',
}

VPN_CIDRS = []  # built by configure(): [(network_obj, gateway_ip, badge, type_name)]

# Simplified action keywords found in UniFi rule names / descriptions
_BLOCK_WORDS = re.compile(r'\b(block|deny|drop|reject|ban|quarantine)\b', re.I)
_ALLOW_WORDS = re.compile(r'\b(allow|accept|pass|trust)\b', re.I)
_REDIRECT_WORDS = re.compile(r'\b(redirect|dnat|port.?forward|nat)\b', re.I)


def configure(cfg: dict):
    """Load relay config. Replaces upstream reload_config_from_db().

    cfg keys:
      wan_interfaces: list[str]
      wan_ips:        list[str]  (optional)
      vpn_networks:   {iface: {cidr: str, badge: str}}  (optional)
    """
    global WAN_INTERFACES, WAN_IPS, _wan_ip, VPN_CIDRS
    WAN_INTERFACES = set(cfg.get('wan_interfaces') or ['ppp0'])
    WAN_IPS = set(cfg.get('wan_ips') or [])
    VPN_CIDRS = build_vpn_cidr_map(cfg.get('vpn_networks') or {})
    logger.info("Configured: WAN=%s WAN_IPS=%s VPN_CIDRS=%d",
                WAN_INTERFACES, WAN_IPS, len(VPN_CIDRS))


def get_wan_ip():
    return _wan_ip


def _is_broadcast_or_multicast(ip: str) -> bool:
    if not ip:
        return False
    if ip == '255.255.255.255':
        return True
    try:
        return ipaddress.ip_address(ip).is_multicast
    except ValueError:
        return False


def build_vpn_cidr_map(vpn_networks):
    result = []
    for iface, cfg in vpn_networks.items():
        cidr, badge = cfg.get('cidr', ''), cfg.get('badge', '')
        if cidr and badge:
            try:
                net = ipaddress.ip_network(cidr, strict=False)
                gw_ip = net.network_address + 1
                type_name = next(
                    (d for p, d in VPN_PREFIX_DESCRIPTIONS.items() if iface.startswith(p)),
                    badge
                )
                result.append((net, gw_ip, badge, type_name))
            except ValueError:
                pass
    return result


def match_vpn_ip(ip_str, vpn_cidrs=None, exclude_ips=None):
    if not vpn_cidrs:
        vpn_cidrs = VPN_CIDRS
    if not vpn_cidrs or not ip_str:
        return None
    if exclude_ips and ip_str in exclude_ips:
        return None
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        for net, gw_ip, badge, type_name in vpn_cidrs:
            if ip_obj in net:
                if ip_obj == gw_ip:
                    return (badge, 'Gateway')
                return (badge, type_name)
    except ValueError:
        pass
    return None


MONTHS = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
}


def _get_syslog_tz():
    tz_name = os.environ.get('TZ', 'UTC')
    try:
        return ZoneInfo(tz_name)
    except Exception:
        logger.warning("Invalid TZ=%r, falling back to UTC for syslog timestamps", tz_name)
        return timezone.utc


def parse_syslog_timestamp(month: str, day: str, time_str: str) -> datetime:
    """Parse RFC3164 syslog timestamp (no year/tz) into an aware UTC datetime."""
    local_tz = _get_syslog_tz()
    now = datetime.now(local_tz)
    month_num = MONTHS.get(month, 1)
    h, m, s = time_str.split(':')
    year = now.year
    if month_num - now.month > 6:
        year -= 1
    ts = datetime(year, month_num, int(day), int(h), int(m), int(s), tzinfo=local_tz)
    return ts.astimezone(timezone.utc)


def derive_direction(iface_in: str, iface_out: str, rule_name: str,
                     src_ip: str = None, dst_ip: str = None) -> str:
    """Derive traffic direction from interfaces, rule name, and IPs."""
    global _wan_ip

    if not iface_in and not iface_out:
        return None

    # Auto-learn WAN IP from WAN_LOCAL rules when not configured
    if (not WAN_IPS and iface_in in WAN_INTERFACES
            and any(mk in (rule_name or '') for mk in WAN_LOCAL_RULE_MARKERS) and dst_ip):
        try:
            ip = ipaddress.ip_address(dst_ip)
            if ip.is_global and not ip.is_multicast:
                ip_str = str(ip)
                if ip_str != _wan_ip:
                    _wan_ip = ip_str
                    WAN_IPS.add(ip_str)
                    logger.info("Auto-detected WAN IP: %s", _wan_ip)
        except ValueError:
            pass

    if _is_broadcast_or_multicast(dst_ip):
        return 'local'

    if src_ip and src_ip in WAN_IPS and iface_out not in WAN_INTERFACES:
        return 'local'

    if 'DNAT' in (rule_name or '') or 'PREROUTING' in (rule_name or ''):
        return 'nat'

    is_wan_in = iface_in in WAN_INTERFACES

    if not iface_out:
        return 'inbound' if is_wan_in else 'local'

    is_wan_out = iface_out in WAN_INTERFACES

    if is_wan_in and not is_wan_out:
        return 'inbound'
    if not is_wan_in and is_wan_out:
        return 'outbound'
    if not is_wan_in and not is_wan_out and iface_in != iface_out:
        is_vpn = any(
            (iface_in or '').startswith(p) or (iface_out or '').startswith(p)
            for p in VPN_INTERFACE_PREFIXES
        )
        return 'vpn' if is_vpn else 'inter_vlan'

    return 'local'


def derive_action(rule_name: str, rule_desc: str = None) -> str:
    """Simplified stand-in for upstream firewall_policy_matcher.

    Infers allow/block/redirect from keywords in the rule name or description.
    Unrecognized → 'allow'.
    """
    if not rule_name and not rule_desc:
        return None
    for text in (rule_name, rule_desc):
        if not text:
            continue
        if _BLOCK_WORDS.search(text):
            return 'block'
        if _REDIRECT_WORDS.search(text):
            return 'redirect'
        if _ALLOW_WORDS.search(text):
            return 'allow'
    return 'allow'


def extract_mac(mac_raw: str) -> str:
    """Extract the source MAC from the iptables 12-byte MAC field (bytes 7-12)."""
    if not mac_raw:
        return None
    parts = mac_raw.split(':')
    if len(parts) >= 12:
        return ':'.join(parts[6:12])
    return mac_raw


def parse_firewall(body: str) -> dict:
    """Parse a firewall (iptables/netfilter) log line."""
    result = {'log_type': 'firewall'}

    m = FW_RULE.search(body) or FW_RULE_LEGACY.search(body)  # PATCH(ewpew): legacy fallback
    result['rule_name'] = m.group(1) if m else None

    m = FW_DESC.search(body)
    result['rule_desc'] = m.group(1) if m else None

    m = FW_IN.search(body)
    result['interface_in'] = m.group(1) if m and m.group(1) else None

    m = FW_OUT.search(body)
    result['interface_out'] = m.group(1) if m and m.group(1) else None

    m = FW_SRC.search(body)
    result['src_ip'] = m.group(1) if m else None

    m = FW_DST.search(body)
    result['dst_ip'] = m.group(1) if m else None

    m = FW_PROTO.search(body)
    result['protocol'] = m.group(1).lower() if m else None

    m = FW_SPT.search(body)
    result['src_port'] = int(m.group(1)) if m else None

    m = FW_DPT.search(body)
    result['dst_port'] = int(m.group(1)) if m else None

    result['service_name'] = get_service_name(result.get('dst_port'), result.get('protocol'))

    m = FW_MAC.search(body)
    result['mac_address'] = extract_mac(m.group(1)) if m else None

    result['rule_action'] = derive_action(result['rule_name'], result.get('rule_desc'))
    result['direction'] = derive_direction(
        result['interface_in'], result['interface_out'], result['rule_name'],
        result.get('src_ip'), result.get('dst_ip')
    )

    return result


def parse_dns(body: str) -> dict:
    """Parse a DNS (dnsmasq) log line."""
    result = {'log_type': 'dns'}

    m = DNS_QUERY.search(body)
    if m:
        result['dns_type'] = m.group(1)
        result['dns_query'] = m.group(2)
        result['src_ip'] = m.group(3)
        return result

    m = DNS_REPLY.search(body)
    if m:
        result['dns_query'] = m.group(1)
        result['dns_answer'] = m.group(2)
        return result

    m = DNS_FORWARD.search(body)
    if m:
        result['dns_query'] = m.group(1)
        result['dst_ip'] = m.group(2)
        return result

    m = DNS_CACHED.search(body)
    if m:
        result['dns_query'] = m.group(1)
        result['dns_answer'] = m.group(2)
        return result

    return result


def parse_dhcp(body: str) -> dict:
    """Parse a DHCP (dnsmasq-dhcp) log line."""
    result = {'log_type': 'dhcp'}

    m = DHCP_ACK.search(body)
    if m:
        result['interface_in'] = m.group(1)
        result['src_ip'] = m.group(2)
        result['mac_address'] = m.group(3)
        result['hostname'] = m.group(4) if m.group(4) else None
        result['dhcp_event'] = 'DHCPACK'
        return result

    m = DHCP_REQ.search(body)
    if m:
        result['interface_in'] = m.group(1)
        result['src_ip'] = m.group(2)
        result['mac_address'] = m.group(3)
        result['dhcp_event'] = 'DHCPREQUEST'
        return result

    m = DHCP_OFFER.search(body)
    if m:
        result['interface_in'] = m.group(1)
        result['src_ip'] = m.group(2)
        result['mac_address'] = m.group(3)
        result['dhcp_event'] = 'DHCPOFFER'
        return result

    m = DHCP_DISC.search(body)
    if m:
        result['interface_in'] = m.group(1)
        if m.group(2):
            result['src_ip'] = m.group(2)
        result['mac_address'] = m.group(3)
        result['dhcp_event'] = 'DHCPDISCOVER'
        return result

    return result


def parse_wifi(body: str) -> dict:
    """Parse a WiFi (stamgr/hostapd/stahtd) log line."""
    result = {'log_type': 'wifi'}

    # PATCH(ewpew): some firmware logs the auth/assoc lifecycle ONLY as kernel
    # lines: "wifi0ap1: [mac] recv auth frame ...", "client[mac] rejected,
    # reason:37", "auth: disallowed by Lock-to-AP", "station associated at aid 2"
    if 'kernel:' in body:
        low = body.lower()
        m = re.search(r'(?:client\[|\[)([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})', body)
        if m:
            result['mac_address'] = m.group(1)
        if 'recv auth' in low:
            result['wifi_event'] = 'recv auth'
        elif 'disallowed' in low:
            result['wifi_event'] = 'auth disallowed'
            if 'lock-to-ap' in low:
                result['wifi_reason'] = 'Lock-to-AP'
        elif 'rejected' in low:
            result['wifi_event'] = 'rejected'
            m2 = re.search(r'reason[:=](\d+)', low)
            if m2:
                result['wifi_reason'] = f'reason {m2.group(1)}'
        elif 'station associated' in low:
            result['wifi_event'] = 'associated'
        elif 'deauth' in low:
            result['wifi_event'] = 'deauthenticated'
        else:
            result['wifi_event'] = 'kernel-wifi'
        return result

    if 'stahtd' in body and '{' in body:
        json_start = body.index('{')
        try:
            import json
            data = json.loads(body[json_start:])
            result['mac_address'] = data.get('mac')
            ev = data.get('event_type', data.get('message_type', 'stahtd'))
            # PATCH(ewpew): normalize tracker verbs + surface assoc failures
            ev = {'sta_leave': 'left', 'sta_join': 'joined',
                  'sta_associate': 'associated'}.get(ev, ev)
            status = str(data.get('assoc_status', ''))
            if status and status not in ('0', 'None'):
                result['wifi_reason'] = f'assoc status {status}'
            result['wifi_event'] = ev
            return result
        except (json.JSONDecodeError, ValueError):
            result['wifi_event'] = 'stahtd'
            return result

    m = WIFI_ASSOC.search(body)
    if m:
        result['mac_address'] = m.group(1)
        result['wifi_event'] = m.group(2)
        return result

    # PATCH(ewpew): hostapd vap lines "wifi0ap1: STA <ap_mac> DRIVER: Send AUTH
    # addr=<client_mac> status_code=0" — the auth/assoc lifecycle. The client is
    # addr=, NOT the STA field (that's the AP's own vap MAC).
    m = re.search(
        r'DRIVER:\s*(Send|Receive|Event)?\s*([A-Z]+)(?:\s+[a-z_]+)?\s+addr=([0-9A-Fa-f:]{17})'
        r'(?:\s+status_code=(\d+))?', body)
    if m:
        dirn = (m.group(1) or 'evt').lower()
        result['wifi_event'] = f'{dirn} {m.group(2).lower()}'
        result['mac_address'] = m.group(3)
        if m.group(4) and m.group(4) != '0':
            result['wifi_reason'] = f'status {m.group(4)}'
        return result

    # PATCH(ewpew): EAPOL handshake lines "wifi0ap1: STA <mac> WPA: sending 1/4 msg"
    m = re.search(r'STA\s+([0-9A-Fa-f:]{17})\s+WPA:?\s*sending\s*(\d)/4', body)
    if m:
        result['mac_address'] = m.group(1)
        result['wifi_event'] = f'wpa handshake {m.group(2)}/4'
        return result

    m = WIFI_EVENT.search(body)
    # PATCH(ewpew): reject interface names captured as the event (hostapd vap lines)
    if m and not re.fullmatch(r'(?:wifi|ath|vap|wlan)\w*\d+', m.group(1)):
        result['wifi_event'] = m.group(1)
        result['mac_address'] = m.group(2)
        return result

    # PATCH(ewpew): UniFi AP "wevent: EVENT_STA_LEAVE wifi0ap1: aa:bb:cc:dd:ee:ff / 2"
    m = re.search(r'EVENT_STA_(\w+)\s+\S*:\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})?', body)
    if m:
        verb = m.group(1).lower()
        result['wifi_event'] = {'leave': 'left', 'join': 'joined'}.get(verb, verb)
        result['mac_address'] = m.group(2)
        return result

    # PATCH(ewpew): UniFi AP "stamgr: kick-sta-on <mac> <vap> (reason:Low RSSI rssi:7)"
    # and similar stamgr/stahtd/hostapd verbs the legacy regexes miss. Interface
    # names (wifi0ap1) and repeated daemon tags are skipped to find the real verb.
    if not result.get('wifi_event'):
        m = re.search(r'(?:stamgr|stahtd|hostapd)[,:]?\s*:\s*(.*)', body)
        if m:
            for tok in re.split(r'[,:]\s*|\s+', m.group(1)):
                if not tok:
                    continue
                if re.fullmatch(r'(?:wifi|ath|br|eth|vap|vtun)[\w/]*', tok) or \
                        tok.startswith(('stamgr', 'stahtd', 'hostapd')):
                    continue
                result['wifi_event'] = tok
                break
    if not result.get('mac_address'):
        m = re.search(r'([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})', body)
        if m:
            result['mac_address'] = m.group(1)
    m = re.search(r'\(reason:?\s*([^)]*?)[)]', body)
    if m:
        result['wifi_reason'] = m.group(1).strip()

    return result


def parse_system(body: str) -> dict:
    """Parse a system log line. Stores raw log only."""
    return {'log_type': 'system'}


def detect_log_type(body: str) -> str:
    """Detect log type from the syslog message body."""
    if 'SRC=' in body and 'DST=' in body and 'PROTO=' in body:
        return 'firewall'
    if body.startswith('[') and 'DESCR=' in body:
        return 'firewall'

    if ('dnsmasq-dhcp' in body or 'DHCPACK' in body or 'DHCPDISCOVER' in body
            or 'DHCPREQUEST' in body or 'DHCPOFFER' in body):
        return 'dhcp'

    if 'dnsmasq' in body and ('query[' in body or 'reply ' in body
                              or 'forwarded ' in body or 'cached ' in body):
        return 'dns'

    if 'stamgr' in body or 'hostapd' in body or 'stahtd' in body:
        return 'wifi'
    # PATCH(ewpew): kernel lines that carry wifi auth/assoc lifecycle
    if 'kernel:' in body and any(w in body.lower() for w in
                                 ('auth', 'assoc', 'deauth', 'rejected', 'disallowed')):
        return 'wifi'
    if 'wevent' in body and 'STA_' in body:  # PATCH(ewpew): EVENT_STA_* leave/join
        return 'wifi'
    if 'STA ' in body and ('associated' in body or 'authenticated' in body):
        return 'wifi'

    return 'system'


def parse_log(raw_log: str) -> dict:
    """Parse a raw syslog line into a structured dict, or None."""
    original_raw = raw_log

    m = SYSLOG_HEADER.match(raw_log)
    if not m:
        stripped = re.sub(r'^<\d+>', '', raw_log)
        m = SYSLOG_HEADER.match(stripped)
        if not m:
            return None
        raw_log = stripped

    timestamp = parse_syslog_timestamp(m.group('month'), m.group('day'), m.group('time'))
    body = m.group('body')
    host = m.group('host')

    log_type = detect_log_type(body)

    if log_type == 'firewall':
        parsed = parse_firewall(body)
    elif log_type == 'dns':
        parsed = parse_dns(body)
    elif log_type == 'dhcp':
        parsed = parse_dhcp(body)
    elif log_type == 'wifi':
        parsed = parse_wifi(body)
    else:
        parsed = parse_system(body)

    parsed['timestamp'] = timestamp.isoformat()
    parsed['syslog_host'] = host  # sender (gateway/AP) name — distinct from DHCP lease hostname
    parsed['raw_log'] = original_raw

    for ip_field in ('src_ip', 'dst_ip'):
        ip_val = parsed.get(ip_field)
        if ip_val:
            try:
                ipaddress.ip_address(ip_val)
            except ValueError:
                parsed[ip_field] = None

    mac_val = parsed.get('mac_address')
    if mac_val and not MAC_RE.fullmatch(mac_val):
        parsed['mac_address'] = None

    return parsed

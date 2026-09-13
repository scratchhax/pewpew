"""Self-check for the CEF parser: python3 test_cef.py (no framework needed).

Samples follow the field layout UniFi gateways emit on the Enhanced /
CyberSecure protection tier. Addresses are RFC 5737 documentation ranges and
RFC 7042 documentation MACs; hostnames and client aliases are placeholders.

Two properties of real CEF the samples deliberately preserve:
  * values may contain spaces (UNIFIhost, UNIFIpolicyName, UNIFIipsSignature)
  * field availability differs by event class — firewall blocks carry
    UNIFIsrcClientIp + UNIFIdstDeviceIp, IDS/IPS threat events carry no source
    IP at all and use a bare dst=
"""
import parsers

BLOCKED = (
    "<13>Sep 13 06:10:23 site-a-gateway CEF: 0|Ubiquiti|UniFi Network|10.6.101|203|"
    "Blocked by Firewall|4|UNIFIcategory=Security UNIFIhost=Site A Gateway proto=UDP "
    "spt=5353 dpt=55006 act=blocked app=Other UNIFIrisk=low "
    "UNIFIpolicyName=Block Servers to Gateway UNIFIpolicyType=Firewall UNIFIdirection=local "
    "deviceInboundInterface=Site A Servers UNIFIdstDeviceMac=00:00:5e:00:53:01 "
    "UNIFIdstDeviceName=Site A Gateway UNIFIdstDeviceModel=UCG-Fiber "
    "UNIFIdstDeviceIp=192.0.2.1 UNIFIdstDeviceVersion=5.1.33 "
    "UNIFIsrcClientAlias=Environmental Sensor UNIFIsrcClientIp=192.0.2.49 "
    "UNIFIsrcClientMac=00:00:5e:00:53:02 UNIFIsrcZone=Servers UNIFIdstZone=Gateway "
    "UNIFIfirewallPolicy=Block Servers to Gateway UNIFItotalBytes=169 UNIFItotalPackets=1 "
    "UNIFIflowCount=1 UNIFIflowId=null UNIFIutcTime=2026-09-12T07:58:03.307Z "
    "msg=Environmental Sensor was blocked from accessing Site A Gateway."
)

THREAT = (
    "<13>Sep 13 06:10:23 site-b-gateway CEF: 0|Ubiquiti|UniFi Network|10.6.101|200|"
    "Threat Detected|7|UNIFIcategory=Security UNIFIhost=Site B Gateway proto=UDP spt=4858 "
    "dpt=53 act=allowed app=DNS UNIFIrisk=medium UNIFIpolicyName=DNS UNIFIpolicyType=IDS/IPS "
    "UNIFIdirection=outgoing deviceInboundInterface=Site B LAN "
    "deviceOutboundInterface=WAN UNIFIdeviceMac=00:00:5e:00:53:03 dst=198.51.100.201 "
    "UNIFIsrcClientAlias=Workstation 1 UNIFIsrcClientMac=00:00:5e:00:53:04 "
    "UNIFIipsSignature=ET DNS DNS Lookup for localhost.DOMAIN.TLD "
    "UNIFIipsSignatureId=2011802 UNIFIutcTime=2026-09-13T03:10:23.418Z "
    "msg=A network intrusion attempt has been detected."
)

AUDIT = (
    "<13>Sep 13 06:10:23 site-a-gateway CEF: 0|Ubiquiti|UniFi Network|10.6.101|544|"
    "Network Accessed|3|UNIFIcategory=Admin UNIFIhost=Site A Gateway "
    "msg=An admin accessed the network."
)

# No UNIFIdirection and no interface fields — derive_direction() has nothing to
# work with, so the both-endpoints-private fallback has to supply 'local'.
NO_DIRECTION = (
    "<13>Sep 13 06:10:23 site-a-gateway CEF: 0|Ubiquiti|UniFi Network|10.6.101|203|"
    "Blocked by Firewall|4|UNIFIcategory=Security UNIFIhost=Site A Gateway proto=UDP "
    "spt=5353 dpt=55006 act=blocked UNIFIdstDeviceIp=192.0.2.1 "
    "UNIFIsrcClientIp=192.0.2.49 UNIFIsrcClientMac=00:00:5e:00:53:02 "
    "msg=Blocked."
)

# act=blocked with a policy name carrying no block/allow keyword, so the
# assertion pins the act= mapping itself rather than derive_action()'s
# keyword fallback.
ACT_ONLY = (
    "<13>Sep 13 06:10:23 site-a-gateway CEF: 0|Ubiquiti|UniFi Network|10.6.101|203|"
    "Blocked by Firewall|4|UNIFIcategory=Security UNIFIhost=Site A Gateway proto=TCP "
    "spt=1024 dpt=445 act=blocked UNIFIpolicyName=Policy 7 UNIFIdirection=local "
    "UNIFIsrcClientIp=192.0.2.49 UNIFIdstDeviceIp=192.0.2.1 msg=Denied."
)

# Must not regress the legacy iptables path.
IPTABLES = (
    "<13>Sep 13 06:10:23 site-b-gateway site-b-gateway [DMZ_LOCAL-A-10000] "
    'DESCR="MGMT to GW" IN=br121 OUT= MAC=45:00:00:20:22:f8:40:00:40:11:de:2b:c0:a8 '
    "SRC=192.0.2.121 DST=192.0.2.1 LEN=32 TOS=00 PREC=0x00 TTL=64 ID=8952 DF "
    "PROTO=UDP SPT=60879 DPT=10001 LEN=12 MARK=1a0000"
)


def test_blocked():
    e = parsers.parse_log(BLOCKED)
    assert e['log_type'] == 'firewall', e['log_type']
    assert not e.get('threat'), 'firewall block must not be flagged as IDS threat'
    assert e['rule_action'] == 'block', e['rule_action']
    assert e['direction'] == 'local', e['direction']
    assert e['src_ip'] == '192.0.2.49', e['src_ip']
    assert e['dst_ip'] == '192.0.2.1', e['dst_ip']
    assert e['dst_port'] == 55006, e['dst_port']
    assert e['src_port'] == 5353, e['src_port']
    assert e['protocol'] == 'udp', e['protocol']
    assert e['mac_address'] == '00:00:5e:00:53:02', e['mac_address']
    # Space-bearing value must not swallow the following key.
    assert e['rule_name'] == 'Block Servers to Gateway', e['rule_name']
    assert e['interface_in'] == 'Site A Servers', e['interface_in']
    assert e['syslog_host'] == 'site-a-gateway', e['syslog_host']


def test_threat():
    e = parsers.parse_log(THREAT)
    assert e['log_type'] == 'firewall', e['log_type']
    assert e.get('threat') is True, 'IDS/IPS threat event must carry threat=True'
    assert e['rule_action'] == 'allow', e['rule_action']
    assert e['direction'] == 'outbound', e['direction']   # CEF 'outgoing'
    assert e['src_ip'] is None, e['src_ip']               # IDS events carry no src IP
    assert e['dst_ip'] == '198.51.100.201', e['dst_ip']   # bare dst=
    assert e['dst_port'] == 53, e['dst_port']
    assert e['mac_address'] == '00:00:5e:00:53:04', e['mac_address']
    assert e['rule_desc'] == 'ET DNS DNS Lookup for localhost.DOMAIN.TLD', e['rule_desc']


def test_audit_event_is_system():
    """Admin/audit CEF events carry no proto/ports/IPs — not traffic."""
    e = parsers.parse_log(AUDIT)
    assert e['log_type'] == 'system', e['log_type']


def test_direction_fallback():
    """No UNIFIdirection and no interfaces: both endpoints private -> local."""
    e = parsers.parse_log(NO_DIRECTION)
    assert e['log_type'] == 'firewall', e['log_type']
    assert e['direction'] == 'local', e['direction']


def test_act_maps_without_keyword_help():
    """act=blocked must drive rule_action even when the policy name is neutral."""
    e = parsers.parse_log(ACT_ONLY)
    assert e['rule_name'] == 'Policy 7', e['rule_name']
    assert e['rule_action'] == 'block', e['rule_action']


def test_iptables_unchanged():
    e = parsers.parse_log(IPTABLES)
    assert e['log_type'] == 'firewall', e['log_type']
    assert e['src_ip'] == '192.0.2.121', e['src_ip']
    assert e['dst_ip'] == '192.0.2.1', e['dst_ip']
    assert e['dst_port'] == 10001, e['dst_port']
    # extract_mac() slices bytes 7-12 of the iptables 12-byte MAC field.
    assert e['mac_address'] == '40:00:40:11:de:2b', e['mac_address']


if __name__ == '__main__':
    for fn in (test_blocked, test_threat, test_audit_event_is_system,
               test_direction_fallback, test_act_maps_without_keyword_help,
               test_iptables_unchanged):
        fn()
        print(f"  ok  {fn.__name__}")
    print("all CEF parser checks passed")

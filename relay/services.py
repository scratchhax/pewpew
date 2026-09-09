"""
Minimal port -> IANA service name map (trimmed subset).

Vendored replacement for UniFi-Insights-Plus receiver/services.py.
Only used for cosmetic labels in the visualizer.
"""

# (port, proto) overrides where proto matters; otherwise keyed by port alone
_TCP_UDP_SERVICES = {
    20: "ftp-data", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp",
    53: "dns", 67: "dhcp", 68: "dhcp", 69: "tftp", 80: "http",
    110: "pop3", 119: "nntp", 123: "ntp", 137: "netbios-ns", 138: "netbios-dgm",
    139: "netbios-ssn", 143: "imap", 161: "snmp", 162: "snmptrap",
    179: "bgp", 389: "ldap", 443: "https", 445: "smb", 465: "smtps",
    500: "ike", 514: "syslog", 515: "printer", 520: "rip", 587: "smtp-submit",
    623: "ipmi", 626: "ipcserver", 636: "ldaps", 700: "shadow",
    853: "dns-over-tls", 990: "ftps", 993: "imaps", 995: "pop3s",
    1093: "imap-ssl", 1194: "openvpn", 1433: "mssql", 1434: "mssql-monitor",
    1521: "oracle", 1701: "l2tp", 1723: "pptp", 1812: "radius", 1813: "radius-acct",
    1883: "mqtt", 1900: "ssdp", 1935: "rtmp", 2049: "nfs", 2181: "zookeeper",
    2375: "docker", 2376: "docker-tls", 2377: "swarm", 3031: "echonet",
    3128: "http-proxy", 3240: "plex-roku", 3241: "plex-player", 3242: "plex-gdm",
    3243: "plex-https", 3244: "plex-https-2", 3245: "plex-https-3", 3246: "plex-https-4",
    3247: "plex-https-5", 5000: "upnp", 5001: "commplex-main", 5004: "rtp",
    5060: "sip", 5061: "sips", 51820: "wireguard", 5190: "icq",
    5222: "xmpp-client", 5223: "xmpp-ssl", 5353: "mdns", 5355: "llds",
    5432: "postgresql", 5672: "amqp", 5683: "coap", 5900: "vnc",
    6000: "x11", 6379: "redis", 6643: "napster", 8000: "http-alt",
    8008: "http-alt-2", 8080: "http-proxy-alt", 8091: "unifi-video",
    8443: "https-alt", 8444: "unifi-2", 8445: "unifi-3", 8883: "mqtt-ssl",
    8888: "http-alt-3", 9000: "cslistener", 9443: "nutanix", 10000: "ndmp",
    11211: "memcached", 32400: "plex", 32401: "plex-ssl", 32410: "plex-cling",
    32412: "plex-ssl-2", 32413: "plex-ssl-3", 32414: "plex-ssl-4",
    32450: "plex-ssl-5", 32469: "plex-rtsp-tls",
    44373: "wakeonlan", 49152: "ws-discovery",
}

_UDP_ONLY = {
    123: "ntp", 5353: "mdns", 1900: "ssdp", 51820: "wireguard",
}

_COMMON_NAMES = {
    "http", "https", "dns", "ssh", "ntp", "dhcp", "mdns", "ssdp",
    "wireguard", "openvpn", "smb", "mqtt",
}


def get_service_name(port, protocol=None):
    """Map a destination port to an IANA-ish service name."""
    if port is None:
        return None
    try:
        port = int(port)
    except (TypeError, ValueError):
        return None
    if port in _TCP_UDP_SERVICES:
        return _TCP_UDP_SERVICES[port]
    if protocol == "udp" and port in _UDP_ONLY:
        return _UDP_ONLY[port]
    if port >= 49152:
        return "dynamic"
    if port >= 1024:
        return "service-%d" % port
    return "port-%d" % port


def get_service_description(service_name):
    if service_name and service_name in _COMMON_NAMES:
        return service_name.upper()
    return None

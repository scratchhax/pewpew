"""Self-check for the Pi-hole FTL parser: python3 test_pihole.py

Samples follow pihole.log as written by Pi-hole FTL when DNS query logging
is on, shipped over syslog by rsyslog imfile (tag 'pihole:'). Addresses are
RFC 5737 documentation ranges and MACs are from RFC 7042.

The format's quirks the samples preserve:
  * the client address sits in parentheses after the tag, tab-separated
  * blocked queries use 'gravity blocked', answers arrive as 'domain is ip'
  * housekeeping lines ('cache size ...') must NOT become DNS events
"""
import parsers


def _parse(line):
    ev = parsers.parse_log(line)
    assert ev is not None, line
    return ev


Q = _parse("<13>Sep 26 17:00:01 pihole (192.0.2.10)\tquery A github.com")
assert Q['log_type'] == 'dns' and Q['dns_query'] == 'github.com'
assert Q['dns_type'] == 'A' and Q['src_ip'] == '192.0.2.10', Q

B = _parse("<13>Sep 26 17:00:01 pihole (192.0.2.10)\tgravity blocked ads.example.net")
assert B['log_type'] == 'dns' and B['dns_query'] == 'ads.example.net'
assert B.get('dns_blocked') is True and B['src_ip'] == '192.0.2.10', B

C = _parse("<13>Sep 26 17:00:02 pihole (192.0.2.11)\tcache hit github.com/198.51.100.7")
assert C['log_type'] == 'dns' and C['dns_query'] == 'github.com', C

R = _parse("<13>Sep 26 17:00:03 pihole (192.0.2.11)\tgithub.com is 198.51.100.7")
assert R['log_type'] == 'dns' and R['dns_answer'] == '198.51.100.7', R

F = _parse("<13>Sep 26 17:00:04 pihole (192.0.2.12)\tforwarded plex.tv to 198.51.100.14#53")
assert F['log_type'] == 'dns' and F['dns_query'] == 'plex.tv', F

H = _parse("<13>Sep 26 17:00:05 pihole cache size 10000, max 10000")
assert H['log_type'] == 'system', H

HK = _parse("<13>Sep 26 17:00:05 pihole time to sweep the cache: 0.05ms")
assert HK['log_type'] == 'system', HK

DH = _parse("<13>Sep 26 17:00:06 pihole (192.0.2.20)\tDHCPACK(enp1s0) 192.0.2.20 "
            "00:00:5e:00:53:01 laptop 00:00:08")
assert DH['log_type'] == 'dhcp', DH

# plain dnsmasq relayed without its tag still parses
DM = _parse("<14>Sep 26 17:00:07 router query[A] example.org from 192.0.2.30")
assert DM['log_type'] == 'dns' and DM['dns_query'] == 'example.org', DM

print('pi-hole parser: all ok')

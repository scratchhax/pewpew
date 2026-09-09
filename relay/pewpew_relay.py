#!/usr/bin/env python3
"""
pewpew relay — UDP syslog in, WebSocket events out, browser static files served.

  UDM/UDR --syslog UDP--> :5514 --parse--> ring buffer --> WS broadcast :8080/ws
                                            http://<pi>:8080/ serves the visualizer

Usage:
  python3 pewpew_relay.py [--config relay.yaml] [--demo]
"""

import argparse
import asyncio
import collections
import json
import logging
import os
import random
import sys
import time

import yaml
from aiohttp import WSMsgType, web

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parsers

logger = logging.getLogger("pewpew-relay")

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(HERE, "..", "web", "dist")

DEFAULTS = {
    "syslog_bind": "0.0.0.0",
    "syslog_port": 5514,
    "http_host": "0.0.0.0",
    "http_port": 8080,
    "buffer_size": 500,
    "wan_interfaces": ["ppp0"],
    "wan_ips": [],
    "vpn_networks": {},
    "drop_log_types": [],          # e.g. ["system"] to quiet noise
}


class Hub:
    """Holds the ring buffer and connected WS clients."""

    def __init__(self, buffer_size: int, demo: bool = False):
        self.buffer = collections.deque(maxlen=buffer_size)
        self.drops = collections.deque(maxlen=60)   # recent dropped raw lines
        self.clients = set()
        self.stats = collections.Counter()
        self.macnames = {}          # learned MAC -> hostname (from DHCPACKs)
        self.demo = demo

    def publish(self, event: dict):
        mac = (event.get("mac_address") or "").lower()
        host = event.get("hostname")
        if mac and host and host != "-":
            self.macnames[mac] = host
        elif mac and not host:
            known = self.macnames.get(mac)
            if known:
                event["hostname"] = known
        self.buffer.append(event)
        self.stats[event.get("log_type", "?")] += 1
        self.stats[f"host:{event.get('syslog_host', '?')}"] += 1
        payload = json.dumps({"type": "event", "event": event,
                              "meta": {"demo": self.demo}})
        dead = []
        for ws in self.clients:
            try:
                asyncio.get_running_loop().create_task(ws.send_str(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def attach(self, ws: web.WebSocketResponse):
        snapshot = json.dumps({"type": "snapshot",
                               "events": list(self.buffer),
                               "stats": dict(self.stats),
                               "meta": {"demo": self.demo}})
        await ws.send_str(snapshot)
        self.clients.add(ws)


def ingest(hub: Hub, drop_types: set, data: bytes, drop_res=()):
    try:
        raw = data.decode("utf-8", errors="replace").strip()
    except Exception:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if any(p.search(line) for p in drop_res):
            hub.stats["dropped"] += 1
            hub.drops.append(line[:300])
            continue
        try:
            parsed = parsers.parse_log(line)
        except Exception:
            logger.exception("parse failed")
            continue
        if not parsed:
            hub.stats["unparseable"] += 1
            continue
        if parsed.get("log_type") in drop_types:
            hub.stats["dropped"] += 1
            continue
        hub.publish(parsed)


class SyslogProtocol(asyncio.DatagramProtocol):
    def __init__(self, hub: Hub, drop_types: set, drop_res=()):
        self.hub = hub
        self.drop_types = drop_types
        self.drop_res = drop_res

    def datagram_received(self, data: bytes, addr):
        ingest(self.hub, self.drop_types, data, self.drop_res)


async def tcp_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                     hub: Hub, drop_types: set, drop_res=()):
    peer = writer.get_extra_info("peername")
    logger.info("syslog TCP client connected: %s", peer)
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            ingest(hub, drop_types, line, drop_res)
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("syslog TCP stream error from %s", peer)
    finally:
        try:
            writer.close()
        except Exception:
            pass


def rnd_mac(rng: random.Random) -> str:
    return ':'.join('%02x' % rng.randint(0, 255) for _ in range(6))


# Neutral demo identities; first entry acts as the gateway.
DEMO_AP_HOSTS = ["GATEWAY", "AP-1", "AP-2", "AP-3"]
DEMO_LAN = ["192.168.1.%d" % i for i in range(10, 40)]
DEMO_WAN = ["104.16.%.1d.%.1d" % (i % 20, i % 251) for i in range(40)]
DEMO_DOMAINS = ["github.com", "discord.com", "netflix.com", "apple.com",
                "googleapis.com", "plex.tv", "espn.com", "mqtt.broker.io"]
DEMO_SERVICES = [(443, "https", "tcp"), (80, "http", "tcp"), (53, "dns", "udp"),
                 (8443, "https-alt", "tcp"), (22, "ssh", "tcp"), (51820, "wireguard", "udp")]


def make_demo_event(rng: random.Random) -> dict:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    kind = rng.choices(
        ["firewall", "firewall", "firewall", "dns", "dhcp", "wifi", "system"],
        weights=[42, 22, 14, 12, 5, 4, 1])[0]
    if kind == "firewall":
        port, service, proto = rng.choice(DEMO_SERVICES)
        blocked = rng.random() < 0.18
        inbound = rng.random() < 0.3
        if blocked:
            rule = rng.choice(["Block LAN to WAN", "Drop Invalid", "Block RDP"])
        else:
            rule = rng.choice(["Allow LAN to WAN", "Allow Established", "Guest Net Allow"])
        lan, wan = rng.choice(DEMO_LAN), rng.choice(DEMO_WAN)
        return {
            "log_type": "firewall", "timestamp": ts,
            "rule_name": rule, "rule_desc": None,
            "rule_action": "block" if blocked else "allow",
            "direction": "inbound" if inbound else "outbound",
            "interface_in": "WAN" if inbound else "LAN",
            "interface_out": "LAN" if inbound else "WAN",
            "src_ip": wan if inbound else lan,
            "dst_ip": lan if inbound else wan,
            "src_port": rng.randint(1024, 65535),
            "dst_port": port, "protocol": proto, "service_name": service,
            "mac_address": rnd_mac(rng),
            "syslog_host": DEMO_AP_HOSTS[0],
        }
    if kind == "dns":
        return {
            "log_type": "dns", "timestamp": ts,
            "dns_type": "A", "dns_query": rng.choice(DEMO_DOMAINS),
            "src_ip": rng.choice(DEMO_LAN), "syslog_host": DEMO_AP_HOSTS[0],
        }
    if kind == "dhcp":
        mac = rnd_mac(rng)
        return {
            "log_type": "dhcp", "timestamp": ts, "dhcp_event": "DHCPACK",
            "interface_in": "LAN", "src_ip": rng.choice(DEMO_LAN),
            "mac_address": mac,
            "hostname": "dev-" + mac.replace(":", "")[-4:],
            "syslog_host": DEMO_AP_HOSTS[0],
        }
    if kind == "wifi":
        return {
            "log_type": "wifi", "timestamp": ts,
            "wifi_event": rng.choice(["associated", "disassociated", "authenticated"]),
            "mac_address": rnd_mac(rng),
            "syslog_host": rng.choice(DEMO_AP_HOSTS),
        }
    return {
        "log_type": "system", "timestamp": ts,
        "syslog_host": rng.choice(DEMO_AP_HOSTS),
    }


async def demo_loop(hub: Hub):
    rng = random.Random()
    while True:
        burst = 1
        if rng.random() < 0.08:
            burst = rng.randint(3, 8)
        for _ in range(burst):
            hub.publish(make_demo_event(rng))
        await asyncio.sleep(rng.uniform(0.3, 2.2))


def load_config(path: str) -> dict:
    cfg = dict(DEFAULTS)
    if path and os.path.exists(path):
        with open(path) as f:
            loaded = yaml.safe_load(f) or {}
        cfg.update(loaded)
    return cfg


async def main():
    ap = argparse.ArgumentParser(description="pewpew syslog→websocket relay")
    ap.add_argument("--config", default=os.path.join(HERE, "relay.yaml"))
    ap.add_argument("--demo", action="store_true", help="generate fake events")
    ap.add_argument("--no-udp", action="store_true", help="skip UDP listener")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    cfg = load_config(args.config)
    parsers.configure(cfg)
    hub = Hub(int(cfg["buffer_size"]), demo=args.demo)

    from aiohttp import web as _web

    @_web.middleware
    async def _no_cache(request, handler):
        resp = await handler(request)
        resp.headers.setdefault("Cache-Control", "no-cache")
        return resp

    app = web.Application(middlewares=[_no_cache])

    async def healthz(_):
        return web.json_response({"ok": True, "stats": dict(hub.stats),
                                  "clients": len(hub.clients),
                                  "buffered": len(hub.buffer)})
    app.router.add_get("/healthz", healthz)

    async def drops_h(_):
        return web.json_response(list(hub.drops))
    app.router.add_get("/drops", drops_h)

    async def ws_handler(request):
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        await hub.attach(ws)
        logger.info("client connected (%d total)", len(hub.clients))
        try:
            async for msg in ws:
                if msg.type == WSMsgType.ERROR:
                    break
        finally:
            hub.clients.discard(ws)
            logger.info("client disconnected (%d total)", len(hub.clients))
        return ws
    app.router.add_get("/ws", ws_handler)

    static = os.path.abspath(STATIC_DIR)
    index_file = os.path.join(static, "index.html")
    if os.path.isdir(static) and os.path.exists(index_file):
        async def serve_index(_):
            return web.FileResponse(index_file)
        app.router.add_get("/", serve_index)
        app.add_routes([web.static("/", static, show_index=False)])
        logger.info("serving static from %s", static)
    else:
        async def no_build(_):
            return web.Response(
                text="web/dist not built yet — run `npm run build` in web/",
                status=503)
        app.router.add_get("/", no_build)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, cfg["http_host"], int(cfg["http_port"]))
    await site.start()
    logger.info("HTTP + WS on http://%s:%d (ws path: /ws)", cfg["http_host"], int(cfg["http_port"]))

    import re as _re
    drop_set = set(cfg["drop_log_types"])
    drop_res = tuple(_re.compile(p) for p in cfg.get("drop_patterns", []))
    if drop_res:
        logger.info("%d raw-line drop patterns active", len(drop_res))

    if not args.no_udp:
        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(
            lambda: SyslogProtocol(hub, drop_set, drop_res),
            local_addr=(cfg["syslog_bind"], int(cfg["syslog_port"])))
        logger.info("syslog UDP on %s:%d", cfg["syslog_bind"], int(cfg["syslog_port"]))
        server = await asyncio.start_server(
            lambda r, w: tcp_client(r, w, hub, drop_set, drop_res),
            cfg["syslog_bind"], int(cfg["syslog_port"]),
            reuse_port=False)
        logger.info("syslog TCP on %s:%d", cfg["syslog_bind"], int(cfg["syslog_port"]))

    if args.demo:
        logger.info("demo mode ON")
        asyncio.create_task(demo_loop(hub))

    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

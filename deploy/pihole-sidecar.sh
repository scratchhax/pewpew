#!/bin/bash
# pihole-sidecar.sh — ship a Pi-hole container's pihole.log to a pewpew relay.
#
# Use this when Pi-hole runs in Docker (e.g. Unraid's official app) and the
# container has no log bind-mount you can tail from the host. It needs nothing
# from the Pi-hole container beyond its name: it tails the log inside the
# container and forwards one syslog-style line per query to the relay.
#
#   ./pihole-sidecar.sh <relay-host> [relay-port] [container] [path-in-container]
#
# On Unraid: save it on the flash (e.g. /boot/config/scripts/pihole-sidecar.sh)
# and run it with the User Scripts plugin ("Run in background"), or just
# nohup it. Test first with a couple of lines:
#   docker exec pihole tail -n 2 /var/log/pihole/pihole.log
#
# Relay side: nothing special — UDP syslog on 5514, Pi-hole FTL parsing is
# built in.
set -u

RELAY=${1:?usage: pihole-sidecar.sh relay-host [port] [container] [log-path]}
PORT=${2:-5514}
CONTAINER=${3:-pihole}
LOGPATH=${4:-/var/log/pihole/pihole.log}

NC=$(command -v nc || command -v busybox)
[ -n "$NC" ] || { echo 'no nc/busybox found — cannot send UDP' >&2; exit 1; }

send() {
  # busybox nc (Unraid) and classic nc both speak -u -w
  "$NC" -u -w 1 "$RELAY" "$PORT"
}

while :; do
  docker exec "$CONTAINER" tail -n 0 -F "$LOGPATH" 2>/dev/null |
  while IFS= read -r line; do
    case "$line" in '==>'*|tail:*|'') continue;; esac
    # FTL lines carry their own timestamp; we add a syslog header around them
    printf '<13>%s pihole %s\n' "$(date '+%b %e %T')" "$line" | send
  done
  sleep 5  # container restarted? wait, then re-attach
done

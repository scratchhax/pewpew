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
# Sending UDP needs neither nc nor python: plain bash speaks /dev/udp (Unraid's
# bash includes it). nc is used only if this bash was built without it.
#
# Run it either ON the Docker host (Unraid: save it on the flash, e.g.
# /boot/config/scripts/, and start it with the User Scripts plugin in
# background mode), or from ANY box that can ssh to the Docker host — set
# PIHOLE_SSH and the tail runs remotely via `ssh ... docker exec`:
#
#   PIHOLE_SSH=root@unraid ./pihole-sidecar.sh 192.168.121.6 5514 pihole
#
# (passwordless ssh keys: ssh-copy-id root@unraid)
#
# Test first with a couple of lines:
#   docker exec pihole tail -n 2 /var/log/pihole/pihole.log
#
# Relay side: nothing special — UDP syslog on 5514, Pi-hole FTL parsing is
# built in.
set -u

RELAY=${1:?usage: pihole-sidecar.sh relay-host [port] [container] [log-path]}
PORT=${2:-5514}
CONTAINER=${3:-pihole}
LOGPATH=${4:-/var/log/pihole/pihole.log}

# prefer bash's built-in UDP; fall back to nc / busybox nc
if ( exec 9<>"/dev/udp/$RELAY/$PORT" ) 2>/dev/null; then
  exec 9<>"/dev/udp/$RELAY/$PORT"
  send() { printf '%s\n' "$1" >&9; }
else
  NC=$(command -v nc || command -v busybox)
  [ -n "$NC" ] || { echo 'no /dev/udp support and no nc/busybox found' >&2; exit 1; }
  send() { printf '%s\n' "$1" | "$NC" -u -w 1 "$RELAY" "$PORT"; }
fi

# tail the log: locally, or on the Docker host via ssh (PIHOLE_SSH=user@host).
# Never expose the docker socket for this; ssh is the safe remote transport.
SSH_TARGET=${PIHOLE_SSH:-}
tail_log() {
  if [ -n "$SSH_TARGET" ]; then
    ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ExitOnForwardFailure=yes \
        -T "$SSH_TARGET" "docker exec $CONTAINER tail -n 0 -F $LOGPATH"
  else
    docker exec "$CONTAINER" tail -n 0 -F "$LOGPATH"
  fi
}

while :; do
  tail_log 2>/dev/null |
  while IFS= read -r line; do
    case "$line" in '==>'*|tail:*|'') continue;; esac
    # FTL lines carry their own timestamp; we add a syslog header around them
    printf '<13>%s pihole %s\n' "$(date '+%b %e %T')" "$line"
  done | while IFS= read -r pkt; do send "$pkt"; done
  sleep 5  # container (or ssh session) dropped? wait, then re-attach
done

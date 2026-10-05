#!/usr/bin/env bash
#
# Egress rules for the music container.
#
# The music service is the only part of Skycord that fetches a URL a member
# typed. It refuses private addresses in code — judged on the resolved
# address, after every redirect, in music/src/urlGuard.ts — and this is the
# line that holds when that code has a bug, which it did once before it was
# finished.
#
# ## What it blocks, and what it deliberately does not
#
# The container's own network is left alone, because the API and the music
# service talk to each other over it: the API asks for a track to be played,
# and the service reads that track's audio back from the API's internal
# route. Blocking the subnet would break the feature it is protecting.
#
# Everything else private is rejected: the host's own LAN, link-local, the
# cloud metadata address, and carrier-grade NAT space. That is the reach an
# SSRF would actually want.
#
# Within the stack, what protects MongoDB is not this file — it is that this
# container never receives a database credential. See compose.music.yaml.
#
# ## Why DOCKER-USER
#
# Docker inserts its own rules ahead of everything else in FORWARD on every
# restart. DOCKER-USER is the one chain it promises to leave alone.
#
# ## Why a systemd unit runs this
#
# iptables rules do not survive a reboot. A rule added once by an installer
# is a rule that is gone the first time the machine restarts, and nobody
# would notice — which is the worst shape a security control can take.
set -euo pipefail

SKYCORD_DIR="${SKYCORD_DIR:-/opt/skycord}"
TAG="skycord-music"

# The ranges an SSRF would aim at. The container's own subnet is excluded
# above these by a RETURN rule, so ordering is load-bearing.
V4_BLOCK="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10"
V6_BLOCK="fc00::/7 fe80::/10"

say()  { echo "$*"; }
warn() { echo "music-firewall: $*" >&2; }
die()  { echo "music-firewall: $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
skycord music-firewall — egress rules for the music container

  apply     (re)install the rules; waits for the container to exist
  check     exit 0 if the rules are in place, 1 if they are not
  remove    take them out
USAGE
}

# ── Is music even running here ──────────────────────────────────────────────

music_enabled() {
  [ -f "$SKYCORD_DIR/.env" ] || return 1
  grep -q '^COMPOSE_FILE=.*compose\.music\.yaml' "$SKYCORD_DIR/.env"
}

# The subnets of every network the music container is attached to. Printed
# one per line; empty when the container is not running.
music_subnets() {
  local cid nets net
  cid="$(cd "$SKYCORD_DIR" && docker compose ps -q music 2>/dev/null)" || return 0
  [ -n "$cid" ] || return 0
  nets="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$cid" 2>/dev/null)" || return 0
  for net in $nets; do
    docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' "$net" 2>/dev/null || true
  done
}

# ── Rules ───────────────────────────────────────────────────────────────────

# Every rule this script owns carries the tag, so it can find its own work
# again without guessing at line numbers — which shift whenever Docker or
# anything else touches the chain.
drop_ours() {
  local ipt="$1" line rules ours
  # Read once, then searched. On a fresh machine none of the rules are ours,
  # and a grep that matches nothing exits 1: inside a pipeline under
  # pipefail and set -e, that ended the script before a single rule was
  # added, so apply failed on every first install. Nothing to drop is fine.
  rules="$("$ipt" -S DOCKER-USER 2>/dev/null)" || return 0
  ours="$(grep -- "--comment \"\?$TAG\"\?" <<<"$rules" || true)"
  [ -n "$ours" ] || return 0
  while read -r line; do
    # -A becomes -D, and the rest of the rule is its own identifier.
    # shellcheck disable=SC2086 # deliberate: the rule is a word list
    "$ipt" ${line/#-A/-D} 2>/dev/null || true
  done <<<"$ours"
}

add_rules() {
  local ipt="$1" subnet="$2" blocks="$3" range
  # Inserted last so it ends up first: a RETURN below the rejects would
  # never be reached, and the API could not be read back.
  for range in $blocks; do
    "$ipt" -I DOCKER-USER 1 -s "$subnet" -d "$range" \
      -m comment --comment "$TAG" -j REJECT
  done
  "$ipt" -I DOCKER-USER 1 -s "$subnet" -d "$subnet" \
    -m comment --comment "$TAG" -j RETURN
}

have_rules() {
  local ipt="$1" subnet="$2" blocks="$3" range rules
  # Captured, never piped into `grep -q`: under pipefail, grep finds its line
  # and exits while iptables is still writing, iptables dies of SIGPIPE, and
  # the pipeline reports that. Measured on iptables-nft: 196 of 200 checks
  # called present rules missing. It failed the v0.20.9 release rehearsal.
  rules="$("$ipt" -S DOCKER-USER 2>/dev/null)" || return 1
  grep -q -- "-s $subnet.*--comment \"\?$TAG\"\?.*RETURN" <<<"$rules" || return 1
  for range in $blocks; do
    grep -q -- "-s $subnet -d $range.*$TAG" <<<"$rules" || return 1
  done
  return 0
}

# ── Commands ────────────────────────────────────────────────────────────────

# On boot this runs beside Docker starting the stack, so the container may
# not exist for a few seconds. Bounded, because a machine where it never
# appears should fail visibly rather than hang forever.
wait_for_container() {
  local n=0
  while [ -z "$(music_subnets)" ]; do
    n=$((n + 1))
    [ "$n" -lt 60 ] || return 1
    sleep 2
  done
}

cmd_apply() {
  music_enabled || { say "music is not enabled here — nothing to do"; return 0; }
  command -v iptables >/dev/null 2>&1 || die "iptables is not installed, so the music egress rules cannot be applied"

  wait_for_container || die "the music container never appeared — rules not applied"

  local subnet applied=0
  drop_ours iptables
  command -v ip6tables >/dev/null 2>&1 && drop_ours ip6tables

  for subnet in $(music_subnets); do
    case "$subnet" in
      *:*) command -v ip6tables >/dev/null 2>&1 &&
             add_rules ip6tables "$subnet" "$V6_BLOCK" && applied=$((applied + 1)) ;;
      *)   add_rules iptables "$subnet" "$V4_BLOCK" && applied=$((applied + 1)) ;;
    esac
  done

  [ "$applied" -gt 0 ] || die "could not work out the music container's subnet — rules not applied"
  say "music egress rules applied to $applied subnet(s)"
}

cmd_check() {
  music_enabled || { say "music is not enabled here"; return 0; }

  local subnet seen=0 bad=0
  for subnet in $(music_subnets); do
    seen=$((seen + 1))
    case "$subnet" in
      *:*) command -v ip6tables >/dev/null 2>&1 || continue
           have_rules ip6tables "$subnet" "$V6_BLOCK" || { warn "missing IPv6 rules for $subnet"; bad=1; } ;;
      *)   have_rules iptables "$subnet" "$V4_BLOCK" || { warn "missing rules for $subnet"; bad=1; } ;;
    esac
  done

  if [ "$seen" -eq 0 ]; then
    warn "the music container is not running, so its rules cannot be checked"
    return 1
  fi
  [ "$bad" -eq 0 ] || return 1
  say "music egress rules are in place"
}

cmd_remove() {
  drop_ours iptables
  command -v ip6tables >/dev/null 2>&1 && drop_ours ip6tables
  say "music egress rules removed"
}

main() {
  case "${1:-apply}" in
    apply)          cmd_apply ;;
    check)          cmd_check ;;
    remove)         cmd_remove ;;
    help|-h|--help) usage ;;
    *)              usage; exit 1 ;;
  esac
}

# Sourcing defines the functions and runs nothing, which is how the tests
# exercise the parts that do not need root.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

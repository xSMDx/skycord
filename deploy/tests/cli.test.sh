#!/usr/bin/env bash
# Tests for the parts of the skycord command that decide things: version
# comparison, reading and writing .env, rendering the templates, reading a
# health answer, and pruning backups.
#
# No Docker and no network: those are covered by the release rehearsal. This
# runs anywhere bash does, including a developer's machine.
set -uo pipefail

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n         %s\n' "$1" "$2"; FAILED=1; }
is()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3], got [$2]"; fi; }
yes_() { if "${@:2}"; then ok "$1"; else bad "$1" "expected success"; fi; }
no_()  { if "${@:2}"; then bad "$1" "expected failure"; else ok "$1"; fi; }
has()  { if grep -q "$3" "$2"; then ok "$1"; else bad "$1" "missing: $3"; fi; }
hasnt(){ if grep -q "$3" "$2"; then bad "$1" "should not contain: $3"; else ok "$1"; fi; }
# shellcheck disable=SC2317,SC2329 # called indirectly, by yes_/no_
quiet(){ "$@" >/dev/null 2>&1; }
# Counting through a glob rather than counting lines of ls output.
count(){ printf '%s' "$#"; }
skip() { printf '  skip %s\n' "$1"; }
# Windows and some network filesystems do not keep Unix permissions; the check
# below is about a server, so it runs where permissions mean something.
perms_kept() {
  local probe="$SKYCORD_DIR/.perm-probe"
  : > "$probe"; chmod 600 "$probe"
  [ "$(stat -c '%a' "$probe" 2>/dev/null)" = "600" ]
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKYCORD_DIR="$(mktemp -d)"
export SKYCORD_DIR
trap 'rm -rf "$SKYCORD_DIR"' EXIT

# shellcheck source=/dev/null
source "$ROOT/deploy/skycord"

echo "versions"
is  "the newer of two"        "$(ver_max v0.10.0 v0.9.0)" "0.10.0"
is  "counts numbers, not text" "$(ver_max v0.9.0 v0.10.0)" "0.10.0"
yes_ "0.19.1 is newer than 0.19.0" ver_gt v0.19.1 v0.19.0
no_  "0.19.0 is not newer than 0.19.1" ver_gt v0.19.0 v0.19.1
no_  "the same version is not newer" ver_gt v1.0.0 v1.0.0

echo ".env"
printf 'SKYCORD_VERSION=v0.19.0\nDOMAIN=chat.example.com\nACME_EMAIL=me@example.com\n' > "$SKYCORD_DIR/.env"
is "reads a value"          "$(env_get DOMAIN)" "chat.example.com"
is "reads nothing for a missing key" "$(env_get NOPE)" ""
env_set SKYCORD_VERSION v0.19.1
is "replaces a value"       "$(env_get SKYCORD_VERSION)" "v0.19.1"
is "leaves the others"      "$(env_get DOMAIN)" "chat.example.com"
env_set NEW_KEY hello
is "adds a missing key"     "$(env_get NEW_KEY)" "hello"
if perms_kept; then
  is "keeps the file private" "$(stat -c '%a' "$SKYCORD_DIR/.env")" "600"
else
  skip "keeps the file private (this filesystem does not keep permissions)"
fi

echo "rendering"
mkdir -p "$SKYCORD_DIR/templates"
cp "$ROOT/deploy/Caddyfile.tmpl" "$ROOT/deploy/livekit.yaml.tmpl" "$SKYCORD_DIR/templates/"
env_set LIVEKIT_API_KEY APIabc123
env_set LIVEKIT_API_SECRET s3cret
env_set LIVEKIT_UDP_PORT 7882
env_set COMPOSE_FILE "compose.yaml:compose.mongo.yaml:compose.livekit.yaml:compose.caddy.yaml"

render "$SKYCORD_DIR/templates/Caddyfile.tmpl" "$SKYCORD_DIR/Caddyfile"
has   "puts the address in"        "$SKYCORD_DIR/Caddyfile" "chat.example.com {"
has   "puts the email in"          "$SKYCORD_DIR/Caddyfile" "email me@example.com"
has   "routes voice signalling"    "$SKYCORD_DIR/Caddyfile" "reverse_proxy livekit:7880"
hasnt "no leftover placeholders"   "$SKYCORD_DIR/Caddyfile" "{{"
hasnt "no certificate line yet"    "$SKYCORD_DIR/Caddyfile" "skycord-tls"

render "$SKYCORD_DIR/templates/livekit.yaml.tmpl" "$SKYCORD_DIR/livekit.yaml"
has   "single UDP port"            "$SKYCORD_DIR/livekit.yaml" "udp_port: 7882"
has   "carries the key pair"       "$SKYCORD_DIR/livekit.yaml" "APIabc123: s3cret"
hasnt "no leftover placeholders"   "$SKYCORD_DIR/livekit.yaml" "{{"

# Voice on someone else's server: nothing in this stack answers /rtc, so the
# route must not be written at all.
env_set COMPOSE_FILE "compose.yaml:compose.mongo.yaml:compose.caddy.yaml"
render "$SKYCORD_DIR/templates/Caddyfile.tmpl" "$SKYCORD_DIR/Caddyfile"
hasnt "no voice route without LiveKit" "$SKYCORD_DIR/Caddyfile" "livekit:7880"

env_set TLS_CERT_FILE /etc/skycord-tls/origin.pem
render "$SKYCORD_DIR/templates/Caddyfile.tmpl" "$SKYCORD_DIR/Caddyfile"
has "uses a supplied certificate" "$SKYCORD_DIR/Caddyfile" "tls /etc/skycord-tls/origin.pem"

echo "health answers"
is "reads the version" "$(health_field '{"status":"ok","version":"v0.19.1","db":"up"}' version)" "v0.19.1"
is "reads the database" "$(health_field '{"status":"ok","version":"v0.19.1","db":"up"}' db)" "up"
is "reads a down database" "$(health_field '{"status":"degraded","version":"v1","db":"down"}' db)" "down"
is "says nothing for an empty answer" "$(health_field '' version)" ""
yes_ "and does not fail doing it" health_field '' version

echo "backup pruning"
mkdir -p "$SKYCORD_DIR/backups"
for i in 1 2 3 4 5; do
  touch -d "2026-09-0$i 04:00" "$SKYCORD_DIR/backups/nightly-2026090$i-040000.gz"
  touch -d "2026-09-0$i 05:00" "$SKYCORD_DIR/backups/pre-update-v0.19.$i-2026090$i-050000.gz"
done
prune_backups nightly 3
is "keeps the newest nightly backups" "$(count "$SKYCORD_DIR"/backups/nightly-*.gz)" "3"
is "leaves pre-update backups alone"  "$(count "$SKYCORD_DIR"/backups/pre-update-*.gz)" "5"
has "keeps the most recent one" <(ls -1 "$SKYCORD_DIR"/backups/nightly-*.gz) "nightly-20260905"
# A fresh install has no nightly backups, and the first manual one must not
# report failure because there was nothing to prune.
yes_ "succeeds when there is nothing of that kind" prune_backups nosuch 3
prune_backups pre-update 2
is "prunes pre-update separately" "$(count "$SKYCORD_DIR"/backups/pre-update-*.gz)" "2"

echo "installer flags"
# The installer cannot be run here — it wants root, Linux and Docker — but its
# parser and its usage text can be. An option that exists but is undocumented,
# or documented but unparsed, is the failure this catches.
usage_out="$(bash "$ROOT/deploy/install.sh" --help 2>&1)"
for flag in --mongo-external --voice-external --host-network --from-env --proxy; do
  case "$usage_out" in
    *"$flag"*) ok "$flag is documented" ;;
    *) bad "$flag is documented" "not in --help" ;;
  esac
done
yes_ "accepts the flags the cutover uses" \
  quiet bash "$ROOT/deploy/install.sh" --mongo-external --voice-external --host-network --proxy external --help
no_  "rejects an option it does not know" \
  quiet bash "$ROOT/deploy/install.sh" --mongo-externals --help

echo "logs arguments"
# skycord logs used to follow the log always, so a script that asked for
# diagnostics never got its shell back. These stubs stand in for an install.
# shellcheck disable=SC2329 # a stub, reached through the sourced cmd_logs
need_install() { :; }
# shellcheck disable=SC2329 # a stub, reached through the sourced cmd_logs
compose() { printf '%s
' "compose $*"; }
# shellcheck disable=SC2329 # called indirectly, by no_
logs_rejects() { ( cmd_logs --nope ) >/dev/null 2>&1; }
is  "does not follow by default" "$(cmd_logs)" "compose logs --tail 100"
is  "takes a service name"       "$(cmd_logs skycord)" "compose logs --tail 100 skycord"
is  "-f follows"                 "$(cmd_logs -f skycord)" "compose logs --tail 100 -f skycord"
is  "--tail sets how much"       "$(cmd_logs --tail 50 skycord)" "compose logs --tail 50 skycord"
no_ "rejects an unknown flag"    logs_rejects

echo ""
if [ "$FAILED" = "0" ]; then echo "all good"; else echo "FAILURES"; fi
exit "$FAILED"

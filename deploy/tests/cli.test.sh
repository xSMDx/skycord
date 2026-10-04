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
has()  { if grep -q -- "$3" "$2"; then ok "$1"; else bad "$1" "missing: $3"; fi; }
hasnt(){ if grep -q -- "$3" "$2"; then bad "$1" "should not contain: $3"; else ok "$1"; fi; }
# The same, ignoring comments. A compose file that NAMES a secret in a note
# about never passing it would otherwise fail a test for not passing it.
code_hasnt() {
  if grep -v '^[[:space:]]*#' "$2" | grep -q -- "$3"
    then bad "$1" "should not contain: $3"; else ok "$1"; fi
}
# shellcheck disable=SC2317,SC2329 # called indirectly, by yes_/no_
quiet(){ "$@" >/dev/null 2>&1; }
# For functions that die: a subshell keeps the exit from ending the run.
# shellcheck disable=SC2317,SC2329 # called indirectly, by no_
sub()  { ( "$@" ) >/dev/null 2>&1; }
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

echo "instance profile"
# The installer is not sourced whole — it would try to install things. Its
# quoting helper is lifted out and run on its own.
eval "$(sed -n '/^env_quote()/,/^}/p' "$ROOT/deploy/install.sh")"
is "a plain value stays plain"        "$(env_quote 'https://example.com/terms')" "https://example.com/terms"
is "an empty value stays empty"       "$(env_quote '')"                          ""
is "a space is single-quoted"         "$(env_quote 'Sky Den')"                   "'Sky Den'"
is "a # is quoted, not a comment"     "$(env_quote 'Den #1')"                    "'Den #1'"
# shellcheck disable=SC2016 # single quotes on purpose: the test is that $ stays literal
is "a \$ is kept literal"             "$(env_quote 'a$b')"                       "'a\$b'"
is "an apostrophe double-quotes"      "$(env_quote "Sam's Place")"               "\"Sam's Place\""
is "and escapes \$, \" and \\ inside" "$(env_quote "it's \$5 \"now\" \\o/")"     "\"it's \$\$5 \\\"now\\\" \\\\o/\""

for var in INSTANCE_NAME INSTANCE_DESCRIPTION INSTANCE_OPERATOR INSTANCE_CONTACT \
           TERMS_URL PRIVACY_URL GUIDELINES_URL COOKIES_URL COPYRIGHT_URL IMPRINT_URL SOURCE_URL; do
  has "compose forwards $var" "$ROOT/deploy/compose.yaml" "$var: \${$var:-}"
  has ".env.example documents $var" "$ROOT/.env.example" "^$var="
done
has "compose points the app at the folder" "$ROOT/deploy/compose.yaml" 'INSTANCE_DIR: /app/instance'
has "compose mounts it read-only"          "$ROOT/deploy/compose.yaml" './instance:/app/instance:ro'
has "the installer creates it"             "$ROOT/deploy/install.sh"   'SKYCORD_DIR/instance'
has "nginx proxies /instance"              "$ROOT/docs/self-hosting/networking.md" 'invites|instance|'

# The questions all sit inside a block --yes skips.
guarded="$(awk '/^if \[ -z "\$ASSUME_YES" \]; then$/{g=1} g{print} /^fi$/{g=0}' "$ROOT/deploy/install.sh")"
for q in 'Name for this instance' 'Who runs it' 'How people can reach you' \
         'Link to your terms of service' 'Link to your privacy policy' \
         'Enable music channels' 'Scan music uploads for viruses'; do
  if grep -q "$q" <<<"$guarded"; then ok "--yes skips: $q"; else bad "--yes skips: $q" "not inside an ASSUME_YES block"; fi
done

echo ""
echo "users"
is  "defaults to thirty days"    "$(users_window)"            "30"
is  "takes a plain number"       "$(users_window 7)"          "7"
is  "takes --days"               "$(users_window --days 90)"  "90"
no_ "rejects a word"             sub users_window abc
no_ "rejects zero"               sub users_window 0
no_ "rejects a negative"         sub users_window -1
no_ "rejects an unknown option"  sub users_window --nope
usage > "$SKYCORD_DIR/usage.txt"
has "usage lists it"             "$SKYCORD_DIR/usage.txt" "skycord users"

echo "music"
# The flag, the question and the compose entry have to agree. A flag that
# turns nothing on, or a compose file nothing adds, is the failure here.
has "the installer documents --music"     "$ROOT/deploy/install.sh" '--music '
has "the installer parses --music"        "$ROOT/deploy/install.sh" '--music)'
has "the installer parses --no-music"     "$ROOT/deploy/install.sh" '--no-music)'
has "it adds the compose file"            "$ROOT/deploy/install.sh" 'compose.music.yaml'
# shellcheck disable=SC2016 # a literal $, on purpose: this is the heredoc
# line that writes the value into .env, not an expansion.
has "it writes the shared secret"         "$ROOT/deploy/install.sh" 'MUSIC_INTERNAL_SECRET=\$MUSIC_INTERNAL_SECRET'
has "it installs the firewall script"     "$ROOT/deploy/install.sh" 'music-firewall.sh'
has "it enables the unit"                 "$ROOT/deploy/install.sh" 'skycord-music-firewall'

# Every file the installer reaches for has to be in a release, or it is
# silently absent on a real server: install.sh guards each one with -f.
for asset in compose.music.yaml music-firewall.sh \
             skycord-backup.service skycord-backup.timer \
             skycord-update.service skycord-update.timer \
             skycord-music-firewall.service; do
  case " $ASSETS " in
    *" $asset "*) ok "released: $asset" ;;
    *)            bad "released: $asset" "not in ASSETS, so fetch_release never downloads it" ;;
  esac
done

# Both halves of the link live in the overlay. Without the app's half the
# service runs and the API never knows it is there.
has "music overlay sets the service url"  "$ROOT/deploy/compose.music.yaml" 'MUSIC_SERVICE_URL'
has "music overlay sets the api url"      "$ROOT/deploy/compose.music.yaml" 'API_INTERNAL_URL'
# The whole point of the separate container.
code_hasnt "music never gets the database"    "$ROOT/deploy/compose.music.yaml" 'MONGO_URI'
code_hasnt "music never gets the jwt secrets" "$ROOT/deploy/compose.music.yaml" 'JWT_ACCESS_SECRET'
code_hasnt "music never gets the crypto key"  "$ROOT/deploy/compose.music.yaml" 'ENCRYPTION_KEY'

# music_enabled reads COMPOSE_FILE, and the pattern has to survive the file
# appearing anywhere in a colon-separated list.
printf 'COMPOSE_FILE=compose.yaml:compose.mongo.yaml\n' > "$SKYCORD_DIR/.env"
no_  "off when the overlay is absent"     music_enabled
printf 'COMPOSE_FILE=compose.yaml:compose.music.yaml\n' > "$SKYCORD_DIR/.env"
yes_ "on when the overlay is last"        music_enabled
printf 'COMPOSE_FILE=compose.yaml:compose.music.yaml:compose.caddy.yaml\n' > "$SKYCORD_DIR/.env"
yes_ "on when the overlay is in the middle" music_enabled
# A file whose name merely contains the word is not the overlay.
printf 'COMPOSE_FILE=compose.yaml:compose.musicfoo.yaml\n' > "$SKYCORD_DIR/.env"
no_  "not fooled by a similar name"       music_enabled

# Status says something only when music is on, and says plainly when the
# rules are missing — a quiet "on" would be the dangerous answer.
printf 'COMPOSE_FILE=compose.yaml\n' > "$SKYCORD_DIR/.env"
is  "status is silent when music is off"  "$(music_status_line)" ""
printf 'COMPOSE_FILE=compose.yaml:compose.music.yaml\n' > "$SKYCORD_DIR/.env"
rm -f "$SKYCORD_DIR/music-firewall.sh"
case "$(music_status_line)" in
  *MISSING*) ok "status shouts when the script is gone" ;;
  *)         bad "status shouts when the script is gone" "got: $(music_status_line)" ;;
esac

# The firewall script's own parts, without root or Docker.
# shellcheck source=/dev/null
if ( source "$ROOT/deploy/music-firewall.sh"
     printf 'COMPOSE_FILE=compose.yaml:compose.music.yaml\n' > "$SKYCORD_DIR/.env"
     music_enabled || exit 1
     printf 'COMPOSE_FILE=compose.yaml\n' > "$SKYCORD_DIR/.env"
     music_enabled && exit 1
     exit 0 )
then ok  "the firewall script agrees about when music is on"
else bad "the firewall script agrees about when music is on" "it does not"
fi

has "the firewall excludes its own subnet" "$ROOT/deploy/music-firewall.sh" 'RETURN'
has "the firewall blocks link-local"       "$ROOT/deploy/music-firewall.sh" '169.254.0.0/16'
has "the firewall blocks the metadata net" "$ROOT/deploy/music-firewall.sh" '169.254'
has "the firewall uses DOCKER-USER"        "$ROOT/deploy/music-firewall.sh" 'DOCKER-USER'
has "the unit re-applies on boot"          "$ROOT/deploy/systemd/skycord-music-firewall.service" 'WantedBy=multi-user.target'

echo "scanner"
# Opt-in, so the same three have to agree: the flag, the question, the file.
has "the installer documents --scan"      "$ROOT/deploy/install.sh" '--scan '
has "the installer parses --scan"         "$ROOT/deploy/install.sh" '--scan)'
has "the installer parses --no-scan"      "$ROOT/deploy/install.sh" '--no-scan)'
has "it adds the scanner overlay"         "$ROOT/deploy/install.sh" 'compose.scan.yaml'
# "Never ask" has to be a different answer from "not asked yet", or the
# question is asked anyway. --no-music used to set "off" and was.
has "--no-music means never ask"          "$ROOT/deploy/install.sh" 'MUSIC="never"'
has "--no-scan means never ask"           "$ROOT/deploy/install.sh" 'SCAN="never"'
case " $ASSETS " in
  *" compose.scan.yaml "*) ok "released: compose.scan.yaml" ;;
  *)                       bad "released: compose.scan.yaml" "not in ASSETS, so fetch_release never downloads it" ;;
esac
has "scanner overlay points music at clamd" "$ROOT/deploy/compose.scan.yaml" 'MUSIC_CLAMD_HOST: clamav'
has "scanner overlay keeps its signatures"  "$ROOT/deploy/compose.scan.yaml" 'clamav-db:/var/lib/clamav'
code_hasnt "the scanner never gets the database"    "$ROOT/deploy/compose.scan.yaml" 'MONGO_URI'
code_hasnt "the scanner never gets the jwt secrets" "$ROOT/deploy/compose.scan.yaml" 'JWT_ACCESS_SECRET'
code_hasnt "the scanner publishes no port"          "$ROOT/deploy/compose.scan.yaml" 'ports:'

printf 'COMPOSE_FILE=compose.yaml:compose.music.yaml\n' > "$SKYCORD_DIR/.env"
no_  "scanner off when its overlay is absent"  scan_enabled
case "$(scan_status_line)" in
  *"Scanner:   off"*) ok "status says the scanner is off" ;;
  *)                  bad "status says the scanner is off" "got: $(scan_status_line)" ;;
esac
printf 'COMPOSE_FILE=compose.yaml:compose.music.yaml:compose.scan.yaml\n' > "$SKYCORD_DIR/.env"
yes_ "scanner on when its overlay is there"    scan_enabled
case "$(scan_status_line)" in
  *"Scanner:   on"*) ok "status says the scanner is on" ;;
  *)                 bad "status says the scanner is on" "got: $(scan_status_line)" ;;
esac

if [ "$FAILED" = "0" ]; then echo "all good"; else echo "FAILURES"; fi
exit "$FAILED"

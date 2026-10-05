#!/usr/bin/env bash
# The release rehearsal: a real install, a real update, and an update to a
# deliberately broken build that must roll itself back — all against the image
# that was just built, on a throwaway machine.
#
# This is what stands between a bad release and every server's `skycord update`.
# It runs in CI after the image is pushed and before `latest` moves.
#
#   bash deploy/tests/rehearsal.sh ghcr.io/xsmdx/skycord v0.19.1
set -euo pipefail

IMAGE="${1:?usage: rehearsal.sh <image> <version>}"
VERSION="${2:?usage: rehearsal.sh <image> <version>}"

DIR="${SKYCORD_DIR:-/opt/skycord}"
NEXT="v999.0.0"      # the same image, offered as if it were newer
BROKEN="v999.0.1"    # an image that cannot start
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

say()  { printf '\n=== %s\n' "$*"; }
# Compose, the way the skycord command runs it: as root, from the install
# directory, whose .env names the compose files. That directory is 0700, so
# neither the cd nor a glob inside it works as the runner user.
stack() { sudo sh -c 'cd "$1" || exit 1; shift; exec docker compose "$@"' sh "$DIR" "$@"; }
in_dir() { sudo sh -c "$1"; }
fail() {
  printf '\nREHEARSAL FAILED: %s\n' "$*" >&2
  timeout 30 sudo skycord logs --tail 50 skycord 2>/dev/null || true
  exit 1
}

# What the music firewall actually sees, printed before failing on it. A
# failure here used to say only "NOT in place", with the check's own reason
# sent to /dev/null by status — two release attempts went by on that.
music_diag() {
  printf '\n--- music firewall check, with its reasons\n'
  sudo SKYCORD_DIR="$DIR" "$DIR/music-firewall.sh" check || true
  printf '\n--- the unit that applies the rules\n'
  sudo systemctl status skycord-music-firewall --no-pager 2>&1 | tail -8 || true
  sudo journalctl -u skycord-music-firewall --no-pager 2>&1 | tail -15 || true
  printf '\n--- DOCKER-USER, v4 and v6\n'
  sudo iptables -S DOCKER-USER 2>&1 || true
  sudo ip6tables -S DOCKER-USER 2>&1 || true
  printf '\n--- the music container'"'"'s networks and their subnets\n'
  local cid net
  cid="$(stack ps -q music 2>/dev/null || true)"
  for net in $(sudo docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$cid" 2>/dev/null); do
    printf '%s: ' "$net"; sudo docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$net" 2>&1 || true
  done
  printf '\n--- docker %s, %s\n' "$(sudo docker version --format '{{.Server.Version}}' 2>/dev/null)" "$(sudo iptables -V 2>/dev/null)"
}

# The rules, read once and searched. Never `iptables -S | grep -q` under
# pipefail: grep exits on its match while iptables is still writing, iptables
# dies of SIGPIPE, and the pipeline fails with every rule in place.
docker_user_rules() { sudo iptables -S DOCKER-USER 2>/dev/null || true; }

# Everything comes from the working tree: the release these files describe does
# not exist yet, which is the whole point of rehearsing before publishing.
export SKYCORD_LOCAL_FILES="$ROOT/deploy/_bundle"
rm -rf "$SKYCORD_LOCAL_FILES"
mkdir -p "$SKYCORD_LOCAL_FILES"
cp "$ROOT"/deploy/compose*.yaml "$ROOT"/deploy/mongo-init.sh "$ROOT"/deploy/Caddyfile.tmpl \
   "$ROOT"/deploy/livekit.yaml.tmpl "$ROOT"/deploy/skycord "$ROOT"/deploy/install.sh \
   "$ROOT"/deploy/music-firewall.sh "$SKYCORD_LOCAL_FILES/"
cp "$ROOT"/deploy/systemd/* "$SKYCORD_LOCAL_FILES/"
( cd "$SKYCORD_LOCAL_FILES" && sha256sum ./* > SHA256SUMS )

say "Install"
# localhost, so Caddy issues its own certificate instead of asking Let's
# Encrypt for one it could never get on a runner.
sudo -E SKYCORD_LOCAL_FILES="$SKYCORD_LOCAL_FILES" bash "$ROOT/deploy/install.sh" \
  --domain localhost --email ci@example.com --version "$VERSION" --music --yes \
  || fail "the installer did not finish"

sudo skycord status || fail "status does not work"

say "Music is on, and locked in"
# This is the only place the egress rules can actually be exercised: they
# need Linux, a real Docker network and iptables, none of which a developer's
# machine reliably has. Everything else about music is unit-tested; this is
# the part that is only true on a server.
grep -q "Music:     on, egress restricted" <<<"$(sudo skycord status)" \
  || { sudo skycord status; music_diag; fail "status does not report music as locked down"; }

# The rules themselves, not just what status says about them.
RULES="$(docker_user_rules)"
grep -q "skycord-music" <<<"$RULES" \
  || fail "no skycord-music rules in DOCKER-USER"
grep -q "169.254.0.0/16.*REJECT" <<<"$RULES" \
  || fail "the cloud metadata address is not blocked"
# The container's own subnet must be allowed, above the rejects, or the API
# and the decoder cannot speak and the feature is dead.
grep -q "skycord-music.*RETURN" <<<"$RULES" \
  || fail "the music subnet has no RETURN rule — the API would be unreachable"

# The API agrees the feature is on. This is the half that was missing for a
# while: the container ran and nothing was wired to it.
stack exec -T skycord \
  node -e "fetch('http://127.0.0.1:3001/instance').then(r=>r.json()).then(p=>{ if (p.music!==true) { console.error(p); process.exit(1) } })" \
  || fail "the instance profile does not report music as available"

# And the service answers, through the name the API uses for it.
stack exec -T skycord \
  node -e "fetch('http://music:3060/health').then(r=>{ if(!r.ok) process.exit(1) })" \
  || fail "the API cannot reach the music service"

say "The app answers, and the API is the API"
stack exec -T skycord \
  node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(h=>{ if (h.version!=='$VERSION'||h.db!=='up') { console.error(h); process.exit(1) } })" \
  || fail "/health did not report $VERSION with a reachable database"

say "Register an account and send a message"
# The password has to satisfy server/utils/validators.ts, whose set of special
# characters does not include a hyphen.
stack exec -T skycord node -e "
const base = 'http://127.0.0.1:3001'
const body = { username: 'rehearsal', email: 'rehearsal@example.com', password: 'Rehearsal!123', displayName: 'Rehearsal' }
// The API answers with an access token in the body and keeps only the refresh
// token in a cookie, so a cookie jar authenticates nothing. This is what
// server/__tests__/helpers.ts does.
let token = ''
const post = async (path, data) => {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = 'Bearer ' + token
  const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(data) })
  if (!r.ok) { console.error(path, r.status, await r.text()); process.exit(1) }
  return r.json()
}
;(async () => {
  const account = await post('/auth/register', body)
  token = account.accessToken
  if (!token) { console.error('register returned no accessToken'); process.exit(1) }
  const server = await post('/servers', { name: 'Rehearsal' })
  const channel = server.channels.find(c => c.type === 'text')
  await post('/servers/' + server.server.id + '/channels/' + channel.id + '/messages', { content: 'rehearsal message' })
  console.log('ok')
})()
" || fail "could not register, make a server and post a message"

say "Update to a build offered as newer"
# The version is baked into the image, so a plain re-tag would still report
# the old one and the update would rightly refuse to believe it had landed.
CTX="$(mktemp -d)"
printf 'FROM %s:%s\nENV SKYCORD_VERSION=%s\n' "$IMAGE" "$VERSION" "$NEXT" > "$CTX/Dockerfile"
sudo docker build -q -t "$IMAGE:$NEXT" "$CTX" >/dev/null
sudo -E SKYCORD_LOCAL_FILES="$SKYCORD_LOCAL_FILES" skycord update "$NEXT" --yes \
  || fail "the update did not finish"
grep -q "$NEXT" <<<"$(sudo skycord version)" || fail "the update did not record $NEXT"

say "Update to a broken build, which must roll itself back"
printf 'FROM busybox\nCMD ["false"]\n' > "$CTX/Dockerfile"
sudo docker build -q -t "$IMAGE:$BROKEN" "$CTX" >/dev/null
# The update is expected to fail: it should put the working version back.
sudo -E SKYCORD_LOCAL_FILES="$SKYCORD_LOCAL_FILES" SKYCORD_HEALTH_TIMEOUT=45 \
  skycord update "$BROKEN" --yes && fail "a broken build was accepted as healthy"

grep -q "$NEXT" <<<"$(sudo skycord version)" || fail "did not go back to $NEXT"
stack exec -T skycord \
  node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(h=>{ if (h.db!=='up') process.exit(1) })" \
  || fail "the working version did not come back healthy"

say "The message written before all of this is still there"
stack exec -T mongo \
  mongo --quiet -u "$(sudo sed -n 's/^MONGO_ROOT_USER=//p' "$DIR/.env")" \
        -p "$(sudo sed -n 's/^MONGO_ROOT_PASSWORD=//p' "$DIR/.env")" \
        --authenticationDatabase admin skycord \
        --eval 'quit(db.messages.countDocuments({ content: "rehearsal message" }) === 1 ? 0 : 1)' \
  || fail "the message did not survive the update and rollback"

say "Backup and restore"
sudo skycord backup rehearsal || fail "backup failed"
LATEST="$(in_dir "ls -1t $DIR/backups/rehearsal-*.gz | head -1")"
[ -n "$LATEST" ] || fail "the backup was not written"
printf 'restore\n' | sudo skycord restore "$LATEST" || fail "restore failed"

say "Rehearsal passed"

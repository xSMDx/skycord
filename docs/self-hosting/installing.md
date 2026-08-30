# Installing Skycord

From a clean server to a running instance. For domains, TLS and Cloudflare, see
[networking.md](./networking.md) — do this first, that second.

---

## Requirements

| | | |
|---|---|---|
| **Node.js** | 22 or newer | Node 18 is end-of-life; the toolchain refuses it |
| **MongoDB** | 4.4 or newer | 4.4 is the *floor*, not a ceiling — see below |
| **A reverse proxy** | nginx or Caddy | Not optional; the API binds to localhost |
| **LiveKit** | optional | Only needed for voice and video |

**Why MongoDB 4.4 is called out.** MongoDB 5.0+ requires AVX, a CPU instruction
set that pre-2011 processors lack. Running well on old hardware is a goal of
this project, so 4.4 is supported deliberately. If your CPU is modern, use
whatever version you like — nothing here depends on 4.4 specifically.

Check before you install, if you are on old hardware:

```bash
grep -o avx /proc/cpuinfo | head -1
```

Nothing printed means AVX is absent, and MongoDB 5.0+ will install and then
crash on start with an illegal-instruction error that does not explain itself.

**Docker is a fine way to run it**, and is what the reference deployment uses —
it makes the 4.4 pin explicit and keeps the version off the host:

```bash
docker run -d --name mongodb \
  --restart unless-stopped \
  -p 127.0.0.1:27017:27017 \
  -v mongodata:/data/db \
  mongo:4.4
```

Two details in there are load-bearing:

- **`-p 127.0.0.1:27017:27017`**, not `-p 27017:27017`. The short form binds to
  every interface, and Docker writes its own iptables rules — so a container
  published that way is reachable from the internet *even with ufw denying the
  port*. This is the most common way a self-hosted database ends up exposed.
- **`--restart unless-stopped`**. Without it the container does not come back
  after a reboot. The API starts fine, the process manager reports it healthy,
  and every request fails against a database that is not running.

Verify both:

```bash
ss -tlnp | grep 27017     # must say 127.0.0.1:27017, never 0.0.0.0:27017
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' mongodb
systemctl is-enabled docker
```

## Install

```bash
git clone https://github.com/xSMDx/sykord.git
cd sykord
npm ci
cp .env.example .env
```

Now edit `.env` — the next section covers every value — then:

```bash
npm run build
npm start
```

`npm run build` produces two things:

- `dist/` — the static client, which your reverse proxy serves
- `dist/server/` — the compiled API, which `npm start` runs on `PORT`

Copy `dist/` to your web root. This step is manual and is the single most
common cause of "I deployed and nothing changed":

```bash
sudo cp -r dist/* /var/www/app.example.com/
```

## Keeping it running

```bash
npm i -g pm2
pm2 start dist/server/index.js --name skycord
pm2 save
pm2 startup      # prints a command to run — survives reboots
```

`pm2 save` is the part people skip, and it is what restores your process list
after a reboot.

## Environment variables

All of them are annotated in [`.env.example`](../../.env.example). These are the
ones that need a decision.

### Required

**`NODE_ENV=production`** — leave it. It is not a logging switch: auth cookies
get `Secure` and `SameSite=Strict` only when it reads exactly `production`. The
server refuses to start in development mode when it is reachable beyond
localhost, so getting this wrong fails at boot rather than silently serving
session cookies that anything on the network can read.

**`MONGO_URI`** — e.g. `mongodb://localhost:27017/skycord`. Keep MongoDB bound
to localhost; see networking.md §7.

**`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`** — two *different* high-entropy
values. Generate each:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Changing these logs everyone out, which is also how you force a logout if a
secret leaks.

**`CLIENT_ORIGIN` / `COOKIE_DOMAIN`** — your real domain in production
(`https://app.example.com` and `example.com`). These are what the boot guard
inspects.

### Optional — API keys

Skycord works without either of these. Both are free, and the app degrades
honestly rather than breaking when they are absent.

#### GIFs — KLIPY

Powers the GIF picker in the composer and the emoji picker's GIF tab.

1. Request a key at **<https://klipy.com/developers>**
2. Put it in `.env`:

```
KLIPY_API_KEY=your_key_here
```

3. Restart the server.

**If you skip this**, the GIF picker shows *"GIFs aren't set up on this server"*
and names the variable to add. It does not show an error, and it does not tell
anyone to try again — because retrying will never help. Every other feature is
unaffected.

The key is deliberately server-side only. KLIPY puts the key in the URL *path*,
so any browser-side call would ship it in the bundle for anyone to read. All GIF
requests are proxied through `/gifs`, and rate-limited — each call spends your
quota, so that limit is protecting your account as much as your server.

#### Voice and video — LiveKit

```
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

`LIVEKIT_URL` is sent to the **browser**, so it must be publicly reachable — not
`localhost`, not a private IP. Setup and the UDP requirements are in
[networking.md §6](./networking.md#6-voice-and-video-livekit).

**If you skip this**, text, servers, channels, DMs and everything else work
normally. Calls will not connect.

## First run

1. Open your domain and **register** — the first account is a normal account;
   there is no admin tier yet.
2. Create a server. It comes with `#general` and a `General` voice channel.
3. Invite people from the server menu.

There is no seeding step and no admin console. If you need to change something
at the data level, it is a normal MongoDB database.

## Updating

```bash
cd ~/sykord
git pull
npm ci
npm run build
sudo cp -r dist/* /var/www/app.example.com/
pm2 restart skycord
```

Then confirm the browser is actually getting the new build — the bundle name is
content-hashed, so it changes on every real deploy:

```bash
curl -s https://app.example.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

If it has not changed, the copy did not happen or Cloudflare is serving a cached
`index.html` ([networking.md §5](./networking.md#5-cloudflare)).

## Backups

Nothing in Skycord backs itself up. Everything — accounts, servers, every
message — is in that one database, and a container that fails to come back takes
all of it.

A script rather than a bare cron line, because a cron line that silently stops
working looks exactly like one that is working:

```bash
sudo tee /usr/local/bin/skycord-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

DEST=/var/backups/skycord
KEEP_DAYS=14
STAMP=$(date +%F-%H%M)
mkdir -p "$DEST"

# --archive to a single file, so one backup is one artefact to copy off the box.
# Change `docker exec mongodb` to a plain `mongodump` if Mongo is not in Docker.
docker exec mongodb mongodump --db=skycord --archive --gzip > "$DEST/skycord-$STAMP.gz"

# A zero-length archive means mongodump failed but the redirect still made a
# file — the failure mode that leaves you with a directory full of nothing.
if [ ! -s "$DEST/skycord-$STAMP.gz" ]; then
  echo "skycord-backup: EMPTY ARCHIVE, dump failed" >&2
  rm -f "$DEST/skycord-$STAMP.gz"
  exit 1
fi

find "$DEST" -name 'skycord-*.gz' -mtime +$KEEP_DAYS -delete
echo "skycord-backup: ok $(du -h "$DEST/skycord-$STAMP.gz" | cut -f1)"
EOF
sudo chmod +x /usr/local/bin/skycord-backup.sh
```

Run it once by hand before trusting it:

```bash
sudo /usr/local/bin/skycord-backup.sh && ls -lh /var/backups/skycord
```

Then daily at 04:00:

```bash
sudo crontab -l 2>/dev/null | { cat; echo "0 4 * * * /usr/local/bin/skycord-backup.sh >> /var/log/skycord-backup.log 2>&1"; } | sudo crontab -
```

**Restore** — test this at least once, on a throwaway database. A backup you
have never restored is a hypothesis:

```bash
docker exec -i mongodb mongorestore --archive --gzip --drop < /var/backups/skycord/skycord-2026-08-30-0400.gz
```

`--drop` replaces existing collections. Without it you get a merge, which is
rarely what you want when recovering.

**Copy them off the machine.** A backup on the same disk as the database
survives a mistake but not a dead server. `rsync` to another host, or an
`rclone` target, on the same schedule.

## Development

```bash
npm ci
cp .env.example .env     # set NODE_ENV=development for local work
npm run dev              # client :5173, API :3001
npm test                 # 429 tests, needs a reachable MongoDB
npm run typecheck        # client + server
```

Development mode is allowed only while every origin is loopback. The moment
`CLIENT_ORIGIN` or `COOKIE_DOMAIN` points somewhere public, the server refuses
to start unless `NODE_ENV=production`.

---

## See also

- [networking.md](./networking.md) — domain, TLS, reverse proxy, Cloudflare, firewall
- [`.env.example`](../../.env.example) — every variable, annotated
- [ROADMAP.md](../ROADMAP.md) — what is coming, and what is not built yet

# One-command install, part 4 — publish, prove, and move skycord.xyz

> Spec: `docs/superpowers/specs/2026-09-11-one-command-install-design.md`, §5–§6.
> Parts 1–3 are built. This part is run by the user: there is no server access
> from Claude's side, so every step here is a command to run and an answer to
> check against.

Four stages. Each one proves the previous. **Stop at the first answer that does
not match** and paste it back rather than pushing on.

| | Stage | Risk if it goes wrong |
|---|---|---|
| A | Publish v0.19.1 | none — nothing installs it yet |
| B | The install URL | one nginx reload, reversible |
| C | A throwaway server | none — it is destroyed either way |
| D | Move skycord.xyz | reversible in three commands |

---

## Stage A — publish v0.19.1

Publishing first is deliberate. The release workflow's rehearsal is the gate:
it installs, updates, and deliberately breaks an update to prove the rollback,
against the very image it just built. Nothing in the world runs
`skycord update` yet — skycord.xyz is still on pm2 — so a release that turns
out to be wrong costs a version number and nothing else.

```bash
git checkout main
git merge --no-ff feat/one-command-install
git push origin main
git tag v0.19.1
git push origin v0.19.1
```

Watch the Release workflow. It runs the typecheck, both test suites, the script
tests and ShellCheck; builds for x86-64 and ARM64; runs the rehearsal; and only
then moves `latest` and publishes the release.

**One manual step, once.** If the package at
`https://github.com/users/xSMDx/packages/container/skycord/settings` says
Private, set it to Public. Otherwise no server can pull the image without
signing in to GHCR, and every install fails at the same place.

**Then check the release has its files:** `install.sh`, `skycord`, the five
compose files, `Caddyfile.tmpl`, `livekit.yaml.tmpl`, the four systemd units,
and `SHA256SUMS`.

---

## Stage B — the install URL

On the VPS, inside the `skycord.xyz` (landing) server block of
`/etc/nginx/sites-available/skycord`:

```nginx
    # One source of truth: the installer is a release asset, never a copy.
    location = /install.sh {
        return 302 https://github.com/xSMDx/skycord/releases/latest/download/install.sh;
    }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsSL https://skycord.xyz/install.sh | head -3
```

**Expect:** the first three lines of the installer (`#!/usr/bin/env bash` and
its opening comment), not HTML.

---

## Stage C — one throwaway server

The only thing that proves what CI cannot: a real certificate from a real
Let's Encrypt, and a real voice call over the single UDP port between two
networks.

**You need:** any hourly-billed VPS (Hetzner, Vultr, DigitalOcean — pennies for
an hour) and a name you can point at it, e.g. `test.skycord.xyz`.

1. **Create it.** Ubuntu 24.04, 2 GB of memory is comfortable. Note the IP.

2. **Point the name at it** and wait until this answers with that IP:

   ```bash
   dig +short test.skycord.xyz
   ```

   In Cloudflare, leave this record **grey** (DNS only). Let's Encrypt cannot
   complete its check through Cloudflare's proxy — which is the whole reason
   the installer asks about Cloudflare instead of guessing.

3. **Install,** on that server, the way a stranger would:

   ```bash
   curl -fsSL https://skycord.xyz/install.sh -o install.sh
   less install.sh          # it is short, and this is the point of it being short
   sudo bash install.sh
   ```

   Answer `test.skycord.xyz`, your email, and **no** to Cloudflare. Press enter
   past the KLIPY and Resend keys.

   **Expect:** it ends with `https://test.skycord.xyz is up.`

4. **Check the machine:**

   ```bash
   sudo skycord status
   curl -s https://test.skycord.xyz/health
   ```

   **Expect:** `{"status":"ok","version":"v0.19.1","db":"up"}`, four containers
   running, and no certificate warning in a browser.

5. **Use it.** Register, create a server, send a message, run a search.

6. **Make a voice call.** Two devices, ideally on different networks — a phone
   on mobile data and a laptop on wifi is the ideal pair. Confirm you hear each
   other. This is the one thing no test on a runner can prove: the single UDP
   port, the advertised external IP, and the TCP fallback.

7. **Back up and restore,** on real disk with real data:

   ```bash
   sudo skycord backup
   ls -lh /opt/skycord/backups/
   sudo skycord restore /opt/skycord/backups/manual-*.gz
   ```

   **Expect:** the restore finishes, the app comes back, and your message is
   still there.

   Updating is not tested here — v0.19.1 is the newest thing that exists, and
   `skycord update` correctly refuses to reinstall what is already running. The
   update-and-rollback path is what the CI rehearsal exercises on every
   release; its first real-world run is the v0.19.2 update in stage D's
   aftermath.

8. **Destroy the server.** Nothing on it needs to be kept.

---

## Stage D — move skycord.xyz onto it

The app moves into a container. **MongoDB, LiveKit and nginx stay exactly where
they are** and are not touched. At every point below, going back is the three
commands in D6.

### D1. Before anything changes

```bash
sudo cp /root/sykord/.env ~/env-backup-$(date +%F)
sudo cp /etc/nginx/sites-available/skycord ~/nginx-backup-$(date +%F)
docker ps --format '{{.Names}}'          # confirm the MongoDB container's name
docker exec mongodb mongodump --db=skycord --archive --gzip > ~/skycord-before-move-$(date +%F).gz
ls -lh ~/skycord-before-move-*.gz        # must not be 0 bytes
```

If `docker ps` shows a different name than `mongodb`, use that name in the
`mongodump` line.

**One thing to read in `/root/sykord/.env` before continuing:** the host part
of `MONGO_URI`. It must be `127.0.0.1` or `localhost`, not a Docker network
alias like `mongodb`. On the host's network a container alias does not resolve.
If it is an alias, change that one word to `127.0.0.1` in the copy you point
the installer at.

### D2. Install alongside, on a spare port

Nothing here touches the running site. pm2 keeps serving on 3001 throughout.

```bash
curl -fsSL https://skycord.xyz/install.sh -o install.sh
sudo bash install.sh \
  --domain app.skycord.xyz \
  --version v0.19.1 \
  --from-env /root/sykord/.env \
  --proxy external --host-network \
  --mongo-external --voice-external \
  --yes
```

`--from-env` carries over the JWT secrets and the encryption key, so everyone
stays signed in and the stored voice-server credentials still decrypt.
`--mongo-external --voice-external` say "those already run here" and read their
addresses out of that same file, so no credential goes on the command line.
`--host-network` puts the container on the machine's own network, where
`127.0.0.1:27017` and `127.0.0.1:7880` mean what they say.

Then move it off 3001 until the switch:

```bash
sudo sed -i 's/^PORT=3001/PORT=3002/' /opt/skycord/.env
sudo skycord apply
```

**Check the new one while the old one is still serving the site:**

```bash
curl -s http://127.0.0.1:3002/health
sudo skycord status
```

**Expect:** `{"status":"ok","version":"v0.19.1","db":"up"}`. That is the
container reading the same live database the site is serving from.

**Also check voice moderation can reach LiveKit** — this is the one setting the
installer had to guess:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7880
grep '^LIVEKIT_ADMIN_URL=' /opt/skycord/.env
```

**Expect:** a `200`, and `http://127.0.0.1:7880`. If LiveKit's HTTP port is
something else on this machine, set it with `sudo skycord config` and
`sudo skycord apply`. Calls work either way; what breaks is kicking and muting.

### D3. Switch the port

```bash
sudo pm2 stop sykord-api                       # stopped, not deleted — that is the way back
sudo sed -i 's/^PORT=3002/PORT=3001/' /opt/skycord/.env
sudo skycord apply
curl -s http://127.0.0.1:3001/health
```

**Expect:** the same healthy answer, now on 3001.

### D4. Switch nginx

In the `app.skycord.xyz` server block, keep the `listen`, `server_name`,
`ssl_certificate` and `ssl_certificate_key` lines exactly as they are, and
replace everything else with:

```nginx
    # The app serves its own files and its own API on one port now, so nothing
    # out here needs to know which paths belong to which.
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 7d;
    }

    # Belt and braces: the container has no server source in its web root.
    location ^~ /server/ { deny all; }
```

**Delete, specifically:** the `root` and `try_files` lines, the
`location ~ ^/(auth|users|servers|…)` alternation, the separate `/socket.io/`
block, and **every `add_header` security line**. The app sends its own
`Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`,
`X-Content-Type-Options` and `Permissions-Policy` now; a second set from nginx
does not replace the first, it arrives beside it, which is how a browser ends
up holding two contradictory framing rules.

Leave the `/rtc` block alone if it is in this file — LiveKit has not moved.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### D5. Check the live site

```bash
curl -s https://app.skycord.xyz/health
curl -s -o /dev/null -w '%{http_code}\n' https://app.skycord.xyz/servers        # 401
curl -s -o /dev/null -w '%{http_code}\n' https://app.skycord.xyz/server/app.js  # 403
curl -sI https://app.skycord.xyz/ | grep -ci '^x-frame-options'                 # exactly 1
curl -sI https://app.skycord.xyz/ | grep -ci '^strict-transport-security'       # exactly 1
```

In a browser, signed in as you already were:

- you are **still signed in** — if you were logged out, the secrets did not
  carry over; go back (D6) and check `--from-env` pointed at the live `.env`
- send a message, and see it arrive on a second device (websockets)
- make a voice call
- run a search, and open an old message from a result
- upload an avatar or an attachment

If the page looks like the old build, purge `https://app.skycord.xyz/` in
Cloudflare — the container sends `no-cache` for the HTML and a year for
`/assets`, but Cloudflare may still hold the previous copy.

### D6. Going back

Any point above, in the order they were changed:

```bash
sudo cp ~/nginx-backup-<date> /etc/nginx/sites-available/skycord
sudo nginx -t && sudo systemctl reload nginx
cd /opt/skycord && sudo docker compose stop skycord
sudo pm2 start sykord-api
```

Both run against the same database, and v0.19.1 only ever adds to it, so
nothing written during the attempt is lost either way.

### D7. After a quiet week

```bash
sudo pm2 delete sykord-api && sudo pm2 save
sudo rm -rf /var/www/app.skycord.xyz/assets /var/www/app.skycord.xyz/index.html
sudo skycord status
```

The landing page keeps its own deploy — `git pull` and a copy — and is
unaffected. With npm no longer running on the server, the lockfile conflict
that used to block that pull cannot happen again.

---

## After all four stages

Deploying becomes: write the changelog, tag, wait for CI, then
`sudo skycord update`. That is `docs/RELEASING.md`, and v0.19.2 is its first
real run.

Record what happened in the deploy notes — especially anything that differed
from this runbook. That file is what the next release reads.

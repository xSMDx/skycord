# One-command install and update — design

**Status:** approved in session 2026-09-11, section by section. Ships as **v0.19.1**, the first
tagged release; v0.20.0 stays reserved for the Windows app.

## Why

Self-hosting is a first-class goal of Skycord, and today it takes an afternoon:

- **Install:** Node, MongoDB 4.4 in Docker, a reverse proxy, TLS and LiveKit, then copy the build
  into a web root, set up pm2, and hand-write about fifteen environment variables
  (`docs/self-hosting/installing.md`, `networking.md`).
- **Update:** seven manual steps. The reference deployment's own history shows those steps failing
  silently:
  - a modified `package-lock.json` aborting `git pull` while everything after it "succeeds";
  - a forgotten `dist/` copy leaving the old bundle live;
  - `dist/*` publishing the compiled server into the web root;
  - a new API prefix silently falling through to the SPA because nginx was not told about it.

After this work:
- **A new server:** `curl -fsSL https://skycord.xyz/install.sh | sudo bash`, answer two questions,
  and it is running on HTTPS.
- **Any server, skycord.xyz included:** `skycord update`, with a backup, a health check and an
  automatic switch back.

## Decisions (asked and answered)

| Question | Answer |
|---|---|
| Which servers? | Everyone, **skycord.xyz included**. It moves onto the same setup last, after the installer is proven on a fresh server |
| How does a version reach a server? | **Ready-built images per release.** GitHub Actions builds each version tag and publishes it to GHCR (the repo is public) |
| How many addresses does a self-hoster set up? | **One.** `chat.example.com` carries the app, the API and voice signalling |
| How do updates happen? | **Manual, with a safety net:** backup, health check, automatic switch back. Nightly auto-update is opt-in |
| Approach | **Docker Compose + installer script + `skycord` command.** Native install rejected: MongoDB 4.4 is not packaged for current distros. All-in-one container rejected: it cannot use existing services |

## 1. What runs

```
                  chat.example.com  (80/443)
                           │
                         Caddy ── obtains and renews the certificate
             ┌─────────────┴──────────────┐
        /rtc │                            │ everything else
             ▼                            ▼
         LiveKit ◄─── internal calls ─── Skycord ───► MongoDB 4.4
   7881/tcp · 7882/udp               app + API +      private network only
   voice media, direct               socket.io
```

### Containers

One compose project in `/opt/skycord`.

| Service | Image | Published on the host |
|---|---|---|
| `skycord` | `ghcr.io/xsmdx/skycord:<version>` — built per release | nothing (bundled mode) |
| `mongo` | `mongo:4.4` (pinned; never auto-bumped) | nothing |
| `livekit` | `livekit/livekit-server:<pinned>` | `7881/tcp`, `7882/udp` |
| `caddy` | `caddy:<pinned>` | `80/tcp`, `443/tcp` |

- **One private network.** MongoDB and the API are reachable only on the stack's private network.
  Neither publishes a port, which removes the "Docker writes iptables rules ahead of ufw" exposure by
  construction rather than by instruction.
- **MongoDB** runs with authentication. An init script creates an application user with
  `readWrite` on the `skycord` database only, and the app connects as that user. The root
  credentials stay in `.env` for backups.
- **LiveKit uses a single UDP port** (`rtc.udp_port: 7882`, muxed), a TCP fallback (`rtc.tcp_port:
  7881`) and `use_external_ip: true`. On a home server that is two port forwards, not a range of
  thousands.
- **Caddy** is the only listener on 80/443:
  - it routes `/rtc*` to `livekit:7880` and everything else to `skycord:3001`, with websockets
    handled natively;
  - it carries the security headers from `networking.md` §3;
  - LiveKit's admin API (`/twirp`) is **not** routed publicly.
- **Logs** use Docker's `json-file` driver with rotation (10 MB × 3 per container), so a chatty
  container cannot fill a small disk.

### Persistent state

- The `mongo-data` volume.
- The `caddy-data` volume, which holds the certificates.
- `/opt/skycord/`:
  - `.env`, root-only (`chmod 600`), holding every secret;
  - the compose file, `Caddyfile`, `livekit.yaml` and `voice-servers.json` if used;
  - `backups/`.

### Changes to Skycord itself

1. **Serve the client from the API process** when `CLIENT_DIR` is set; the image sets it to
   `/app/client`.
   - `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`.
   - Other files from the client build (worklet, sounds, icons) get a short cache.
   - A `GET` that accepts `text/html` and matches no API prefix and not `/socket.io` returns
     `index.html` with `Cache-Control: no-cache`.
   - Unknown API paths keep returning JSON 404s.
   - The client directory in the image holds only the client build. The compiled server lives
     elsewhere (`/app/server`), so the August `/server/` exposure cannot recur.
   - With `CLIENT_DIR` unset nothing changes, so development and the current deployment are
     unaffected.
2. **`/health`** returns `{ status, version, db }`.
   - `version` comes from `SKYCORD_VERSION`, baked into the image at build time (`"dev"` when
     unset).
   - It answers **503** whenever Mongoose is not connected. The update's health check needs "the
     new version is up *and* reached its database", not "the process answered".
3. **`LIVEKIT_ADMIN_URL`** (optional) is the address `RoomServiceClient` uses for the instance's
   own LiveKit, the `LIVEKIT_URL` trio. Without it the server converts the public `wss://` URL to
   `https://` and calls itself back through the public address. That hairpin is wasteful in a
   container and fails outright on home routers without NAT loopback. Guild-registered voice
   servers keep today's behaviour.
4. **`BIND_HOST=0.0.0.0`** in the image's bridge mode, where only the private network can reach
   the container. This is the existing variable; the host-network mode (see §5) sets `127.0.0.1`.
5. **`TRUST_CF_IP`** is written explicitly by the installer: `true` only if the admin says the
   address is behind Cloudflare's proxy. Its production default of `true` would otherwise let
   anyone on a non-Cloudflare server forge the address recorded for their session.

### Swappable pieces

Each piece can be replaced by one you already run, with one setting each. Implemented as compose
override files selected through `COMPOSE_FILE` in `.env`.

| Piece | Replacement |
|---|---|
| Proxy | `external` — no Caddy; `skycord` listens on `127.0.0.1:3001` for an existing nginx, and the installer prints a server block (forward everything, websocket headers, the `/server/` deny kept as defence in depth) |
| MongoDB | `external` — no `mongo` service; `MONGO_URI` points at the existing database |
| Voice | `external` (existing LiveKit: `LIVEKIT_URL`/key/secret, plus `LIVEKIT_ADMIN_URL`) or `off` |
| Network | `host` — used only when the other pieces are external and live on the host's loopback (skycord.xyz, §5) |

## 2. The installer

**Distribution.**
- `install.sh` is attached to every GitHub release. `https://skycord.xyz/install.sh` is a 302 to
  `…/releases/latest/download/install.sh`: one nginx `location` on the landing block, one source of
  truth, and `curl -fsSL` follows it.
- The release's `SHA256SUMS` lets anyone download, verify and read it before running it.
- It needs root and says so.

**Checks, before any change.** Each stops with an explanation of what to fix:
- **OS and architecture:** Linux, `x86_64` or `aarch64`. Warns under 1 GB of RAM or 5 GB of free
  disk.
- **Docker:** if absent, installs it with Docker's official `get.docker.com` script. Requires the
  compose v2 plugin and says so if it is too old.
- **Ports 80/443 in use:** switches to the external-proxy mode and prints the nginx block to paste.
- **Existing install:** `/opt/skycord` exists → stops and points at `skycord update`. A re-run
  never overwrites secrets.

**Questions** (every one also a flag, so `--yes` gives a fully non-interactive install):
- the address (`--domain`) and an email for certificate notices (`--email`);
- **behind Cloudflare's proxy?** If yes: SSL mode must be Full (strict), and the installer takes a
  Cloudflare Origin Certificate (paste or file path), because Let's Encrypt's HTTP challenge cannot
  pass Cloudflare's forced-HTTPS redirect;
- optional **KLIPY** key (GIFs) and **Resend** key plus sender (password reset). Both can be added
  later with `skycord config`.

Other flags:

| Flag | Effect |
|---|---|
| `--no-voice` | Leaves out LiveKit |
| `--proxy external` | Uses an existing web server instead of Caddy |
| `--mongo-uri …` | Uses an existing MongoDB |
| `--livekit-url/-key/-secret` | Uses an existing LiveKit |
| `--version vX.Y.Z` | Installs a specific release |
| `--from-env <file>` | Imports an existing `.env`'s secrets instead of generating new ones (§5) |

**Actions:**
1. **Generates:**
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, 64 random bytes each;
   - `ENCRYPTION_KEY`, 32 bytes;
   - a LiveKit key pair;
   - the MongoDB root and application passwords.

   All go into `/opt/skycord/.env`, `chmod 600`, alongside `NODE_ENV=production`,
   `CLIENT_ORIGIN=https://<domain>`, `LIVEKIT_URL=wss://<domain>` and
   `LIVEKIT_ADMIN_URL=http://livekit:7880`.
2. **Renders** the compose file, `Caddyfile` and `livekit.yaml` from the release's templates.
3. **Installs** `/usr/local/bin/skycord` and the systemd timers: nightly backup on; auto-update
   installed, off.
4. **Firewall:**
   - if **ufw is active**, it offers to allow 80, 443, 7881/tcp and 7882/udp;
   - it never edits SSH rules and never enables ufw, since that can lock the admin out;
   - if ufw is inactive, it prints the ports instead.
5. **Starts** the stack and waits until `https://<domain>/health` answers `ok` with the expected
   version over a valid certificate.
6. **Prints** the address and the everyday commands. The first account registered is a normal
   account; there is no admin tier yet.

**Failures name their cause.** For example: the domain does not resolve to this server; port 80 is
blocked, so no certificate; Docker failed to start. A plain re-run continues from where it stopped.

## 3. Updates and the `skycord` command

A bash script at `/usr/local/bin/skycord`, operating on `/opt/skycord`. It needs root because it
reads `.env`.

**`skycord update [version]`:**
1. **Resolve.** Without a version it takes the newest non-prerelease from GitHub's releases API.
   It prints what changed with a link to the notes and confirms (`--yes` skips). A version older
   than the running one is refused; that is what `rollback` is for.
2. **Back up.** `mongodump --archive --gzip` into
   `backups/pre-update-<old version>-<timestamp>.gz`. It **refuses to continue if the archive is
   empty**: a failed dump behind a successful redirect is the classic silent failure.
3. **Fetch.** Downloads the release's templates and `SHA256SUMS` and verifies them. Pulls the new
   image **while the old one keeps serving**.
4. **Apply.** Re-renders the compose file and configs from the new templates with the admin's
   `.env` kept, then recreates **only the `skycord` service**. MongoDB, LiveKit and Caddy do not
   restart unless the release changed their pinned image. Downtime is seconds, and socket.io
   clients reconnect on their own.
5. **Verify.** Waits up to 90 s for `/health` to report the **new version** and `db: "up"`.
6. **Switch back on failure.** Recreates the previous image, confirms it is healthy, and prints
   the failed container's last 50 log lines.
   - **The database is not restored automatically.** Releases only add to it (see the rule
     below), so the previous version runs on the newer data.
   - Restoring would erase everything written since the backup; that stays a deliberate
     `skycord restore`.
7. **Record.** Writes the version to `SKYCORD_VERSION` in `.env`, so reboots and later commands use
   it.

**Other commands:**

| Command | Does |
|---|---|
| `skycord status` | Running version, container health, certificate expiry, disk, last backup, and whether a newer release exists |
| `skycord rollback` | Returns to the previous version by hand (same verify step) |
| `skycord backup` | An on-demand backup, with the empty-archive guard |
| `skycord restore <file>` | Asks first, stops `skycord`, restores with `--drop` (replace, never merge), starts it again |
| `skycord logs [service]` | `docker compose logs` with sensible defaults |
| `skycord config` | Opens `.env` in `$EDITOR`, validates it, applies it (recreates what changed) |
| `skycord auto-update on\|off` | Enables or disables the nightly `skycord update --yes` timer. Off by default |
| `skycord version` | Script and running versions |

**Backups.**
- Nightly at 04:00 (systemd timer), keeping 14 days.
- Pre-update backups are kept separately: the most recent five. A run of updates cannot push the
  nightly ones out, and nightly pruning cannot delete the backup taken just before an update.

**The release rule** goes into `docs/RELEASING.md`:
- **a release may only add to the database** — new fields, new indexes, idempotent startup
  backfills, as v0.19.0 already does;
- renaming or dropping anything is planned across two releases, so switching back is always safe.

## 4. Releases

**`.github/workflows/ci.yml`** runs on every push to `main` and on pull requests:
- `npm ci`, then `npm run typecheck`;
- the client tests;
- the server tests against a `mongo:4.4` service container through `TEST_MONGO_URI`;
- ShellCheck over the installer and the CLI;
- the script tests (§6).

It builds no image. This is the repo's first CI.

**`.github/workflows/release.yml`** runs on a `v*.*.*` tag:
1. **Checks:** the same checks as CI. A failure publishes nothing.
2. **Build:** `linux/amd64` and `linux/arm64`.
   - The client and server are compiled once, in a stage pinned to the build platform (the output
     is platform-independent).
   - Each target platform only runs `npm ci --omit=dev` (native `bcrypt` included) in a
     `node:22-slim` runtime stage, on Debian because `bcrypt`'s prebuilt binaries target glibc.
   - The ARM build therefore never compiles the whole app under emulation.
   - The image runs as a non-root user and carries `SKYCORD_VERSION=<tag>`.
3. **Publish:** pushes `ghcr.io/xsmdx/skycord:<tag>` (and `:0.19` style minor tags).
4. **Rehearse:** runs the end-to-end rehearsal (§6) against the pushed image.
5. **Release:** only if the rehearsal passes, moves `:latest` and creates the GitHub release:
   - notes linking the landing changelog;
   - assets: `install.sh`, `skycord`, the compose, Caddy and LiveKit templates, `SHA256SUMS`.

**One manual step, once.** If GHCR marks the first published package private, one switch in its
settings makes it public, so servers pull it without logging in.

**Versioning.**
- Tags are `vX.Y.Z` and match the landing changelog. `v0.19.1` is the first.
- `package.json`'s version is not used for this; the tag is the version.

**Our release routine** (`docs/RELEASING.md`):
1. write the landing changelog;
2. tag and push;
3. wait for the release workflow;
4. `sudo skycord update` on skycord.xyz;
5. check `skycord status`.

This replaces the seven-step deploy.

## 5. Moving skycord.xyz

Done **last**, after §6's real-server test. The VPS runs many unrelated services and its nginx
serves several sites on 80/443/2053 with a Cloudflare origin certificate, so it uses the external
pieces throughout:

- **nginx stays.**
  - Only the `app.skycord.xyz` block changes, to "forward everything to `127.0.0.1:3001`" with
    websocket headers.
  - The static root, the API prefix alternation and the "three edits per new route" rule go
    away.
  - The `location ^~ /server/ { deny all; }` guard stays.
- **MongoDB stays:** the existing `mongodb` container and its data, used as an external MongoDB.
  Folding it into the stack is optional and not part of this work.
- **LiveKit stays** at `livekit.skycord.xyz`, as an external LiveKit, with
  `LIVEKIT_ADMIN_URL=http://127.0.0.1:7880`.
- **Host networking** for the `skycord` container, and only there. It sees exactly what the pm2
  process sees today (MongoDB on `127.0.0.1:27017`, LiveKit on `127.0.0.1:7880`) and binds only
  `127.0.0.1:3001`.
- **`--from-env /root/sykord/.env`.**
  - The existing JWT secrets are imported, so sessions survive.
  - The existing `ENCRYPTION_KEY`/JWT-derived key is imported, so stored voice-server secrets
    still decrypt.
  - `TRUST_CF_IP=true` is kept, since skycord.xyz is behind Cloudflare with 443 scoped to its
    ranges.

**Cutover.** Commands are written out for the user to run; there is no server access from here.
1. Back up the database. Copy `/root/sykord/.env` and the current nginx config aside.
2. Install in all-external mode with the container on a spare port first. Check that
   `curl 127.0.0.1:<spare>/health` reports `v0.19.1` and `db: "up"`.
3. `pm2 stop sykord-api`, keeping it registered. Move the container to `3001`, swap the nginx
   block, run `nginx -t` and reload. Downtime is seconds.
4. **Verify:**
   - `/health` through the public address;
   - sign in, send a message, a voice call, search;
   - `/server/index.js` → 403, `/servers` → 401;
   - Cloudflare serving the new page, purging `https://app.skycord.xyz/` if needed.

**Going back** (any time that week) is three commands: restore the saved nginx block, stop the
container, `pm2 start sykord-api`.
- Both use the same database, and releases only add to it, so no data is lost either way.
- After a quiet week, `pm2 delete sykord-api && pm2 save`, and remove the old
  `/var/www/app.skycord.xyz` contents.

**The landing page** stays static on nginx, deployed from the checkout with `git pull` and the
copy. npm no longer runs on the VPS, so the lockfile can no longer block that pull. The
`/install.sh` redirect is added to the landing block in the same change.

## 6. Proving it works

Four layers, each catching what the previous cannot:

1. **Server tests**, test-first, in the existing suites:
   - **Client serving:**
     - `index.html` has `no-cache`;
     - hashed assets are `immutable`;
     - a deep link returns `index.html`;
     - unknown API paths return JSON 404;
     - no path reaches the compiled server;
     - with `CLIENT_DIR` unset, no static serving at all.
   - **`/health`:** reports version and `db`; returns 503 with the database disconnected.
   - **`adminUrl`:** prefers `LIVEKIT_ADMIN_URL` for the instance's own server and ignores it for
     guild-registered servers.
2. **Script tests.**
   - ShellCheck runs on every push.
   - The installer's and CLI's decisions are tested with a bash test runner (bats) and stubbed
     `docker`, `curl` and `ss`:
     - flag parsing;
     - the checks (ports taken, Docker missing, existing install, low memory);
     - version comparison and the refusal to downgrade through `update`;
     - the switch-back decision;
     - backup pruning;
     - `.env` rendering, including `--from-env`.
3. **End-to-end rehearsal** on every release tag, on a GitHub Ubuntu runner:
   1. a real install from the just-pushed image with `--domain localhost`, using Caddy's internal
      certificate instead of Let's Encrypt;
   2. register an account and send a message through the API;
   3. `skycord update` to a second build of the same commit tagged as newer;
   4. `skycord update` to a deliberately broken build, expecting an automatic switch back with the
      message still readable;
   5. `skycord backup`, then `skycord restore`.

   `:latest` moves only if every step passes.
4. **One real server before skycord.xyz.** A throwaway hourly-billed VPS with a test address
   (e.g. `test.skycord.xyz`), created by the user:
   - a real Let's Encrypt certificate;
   - a voice call through the single UDP port, from outside the network;
   - a real `skycord update`.

   Deleted afterwards.

## Documentation

- **`docs/self-hosting/installing.md`** is rewritten around the one command. The current manual
  path moves to an appendix, `manual-install.md`, for people who will not use Docker.
- **`networking.md`** shrinks to what still needs a human:
  - DNS;
  - Cloudflare's settings;
  - the two voice ports;
  - home-server port forwarding;
  - the external-proxy nginx block.
- **`docs/RELEASING.md`** — the routine and the additive-only rule.
- **`docs/ROADMAP.md`** — the queue becomes: one-command install and update → UI/UX audit →
  Windows app (v0.20.0) → multi-instance (v0.21) → phone app → E2EE.
- The clone URL in the docs moves from the old `sykord` repository name to `skycord`.

## Delivery

Four implementation plans, each tested and useful on its own, in this order:

1. **Server and image.**
   - Contents: client serving, `/health` with version and database state, `LIVEKIT_ADMIN_URL`, the
     `Dockerfile` and `.dockerignore`, and `ci.yml`.
   - Result: an image that runs the whole app on one port, and CI on every push.
2. **Stack, installer and command.**
   - Contents: the compose file and its override files, the Caddy and LiveKit templates,
     `install.sh`, the `skycord` command, the systemd timers, the script tests, and `release.yml`
     with the rehearsal.
   - Result: `v0.19.1` can be tagged, built and installed on a fresh server.
3. **Documentation:** the self-hosting guides, the manual-install appendix, `RELEASING.md` and
   `ROADMAP.md`.
4. **The real-server test and the skycord.xyz move.**
   - The throwaway-VPS check.
   - A runbook with every command for the cutover and for going back.
   - The landing `/install.sh` redirect.
   - Commands are run by the user; there is no server access from here.

## Risks and things to confirm while planning

- **ARM64 and MongoDB 4.4.** Confirm which ARM CPUs the official `mongo:4.4` arm64 image runs on
  before the docs promise any particular board. The x86 claim (no AVX needed) is already
  established.
- **GHCR visibility** of the first package (the one manual switch, above).
- **Let's Encrypt behind Cloudflare** is handled by taking an origin certificate. Document the
  alternative of a grey-clouded record during install, for those who prefer it.
- **Single-port UDP** is right for small instances. A very busy instance can move to a port range
  by editing `livekit.yaml`; note it in the docs.
- **`curl | bash` trust.** The script is short and published with checksums. Signing release
  assets (e.g. minisign or cosign) is a follow-up, not part of this work.
- **The rehearsal's runtime** on GitHub's runners. If the end-to-end job is too slow, it runs on
  release tags only, never on every push — which is already the plan.

## Out of scope

- Moving skycord.xyz's MongoDB or LiveKit into the stack.
- TURN, Windows or macOS as a host OS, Kubernetes, and multi-server (horizontal) deployments.
- An in-app "update available" notice. There is no admin tier yet to show it to; `skycord status`
  reports it.

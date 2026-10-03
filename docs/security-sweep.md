# Security Sweep — 2026-10-03

Manual review of the API (`server/`), client (`src/`), desktop shell
(`desktop/src/`) and the new music service (`music/`) at
`share-app-audio` @ `31440af`.

The previous sweep is [security-sweep-2026-08-09.md](security-sweep-2026-08-09.md),
at `main` @ `334d50d`. **434 files and ~64,000 lines have changed since**, including
channels, categories, roles and permissions, voice and LiveKit, invites,
discovery, the Electron shell with its own updater, and the music service.

**Evidence key** — `PROVEN` demonstrated at runtime · `CODE` verified by reading
the code path.

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | **HIGH** | `engine.io` 6.6.9 — Engine.IO protocol revision mismatch DoS, pre-auth | `CODE` | **FIXED** (6.6.11) |
| 2 | MEDIUM | `qs` — array-limit bypass, and DoS via attacker-controlled `isBuffer` | `CODE` | **FIXED** (6.16.0) |
| 3 | MEDIUM | `morgan` — log forging and log injection via unescaped separators | `CODE` | **FIXED** (1.12.1) |
| 4 | LOW | `compose.music.yaml` describes a service with no entry point | `CODE` | **OPEN — inert** |
| 5 | INFO | Dev-only advisories remain (nodemon chain, vite/esbuild) | `CODE` | **ACCEPTED** |

**Production dependency vulnerabilities: 5 → 0.**

August's only open finding, **#4 production running in development mode**, is
**closed**: the deployment sets `NODE_ENV=production`, which is what drives
`Secure` and `SameSite` on both auth cookies, and `app.skycord.xyz` answers
with `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
(Confirmed from the other direction too, and expensively: the local dev stack
had to override `NODE_ENV` and `COOKIE_DOMAIN` precisely *because* it inherits
a production `.env` whose cookies a plain-HTTP origin refuses to store.)

---

## 1. HIGH — `engine.io` protocol revision mismatch DoS

[GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv).
`engine.io@6.6.9` was the installed transport under `socket.io@4.8.3`.

This one matters more than its CVSS suggests, for two reasons specific to
this product. The Engine.IO handshake happens **before** the Socket.IO auth
middleware runs, so it needs no account — anyone who can reach the origin can
attempt it. And Socket.IO is not a side channel here: presence, occupancy,
typing, call state and now music all ride it, so taking it down takes down
most of what makes the app feel alive while leaving the HTTP API answering,
which reads as "Skycord is broken" rather than "Skycord is under attack".

`socket.io@4.8.3` depends on `engine.io@~6.6.0`, so **6.6.11 is a lockfile
bump with no API change**. Applied, and the full suite — 1845 tests including
the socket integration ones — passes on it.

## 2–3. MEDIUM — `qs` and `morgan`

`qs` 6.15.2 → 6.16.0 ([array-limit bypass via bracket-key comma
parsing](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), and
[DoS via attacker-controlled `isBuffer`](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)).
Reached through both `express` and `body-parser`.

`morgan` 1.11.0 → 1.12.1 (log forging via unescaped Unicode line separators;
log injection via an unescaped double quote in a quoted field). Low impact on
its own, and worth taking because the logs are what an incident is
reconstructed from.

Both were in-range bumps.

## 4. LOW — a compose service that cannot start

`deploy/compose.music.yaml` was written alongside the music service and
references `ghcr.io/xsmdx/skycord-music`, a `/health` endpoint and a
`MUSIC_INTERNAL_SECRET`. None of the three exists yet: `music/src/` is four
modules and no entry point, and there is no Dockerfile for it.

**Inert, and deliberately so.** `deploy/install.sh` builds `COMPOSE_FILE`
from the mongo and livekit choices only and never appends this file, so no
installer run and no `skycord update` can pick it up. A host would have to
add it to `COMPOSE_FILE` by hand.

Recorded rather than fixed because the fix is the rest of phase 1, not a
patch. The risk if forgotten is a failed deploy, not an exposure — but the
secret name in a shipped file invites someone to set it and wire it up.

## 5. INFO — the dev-only advisories that remain

Six, all in `devDependencies`, none shipped:

- `nodemon` → `braces`, `chokidar`. npm's suggested remedy is nodemon
  **1.14.10**, a major *downgrade* to a 2018 release. Declined.
- `vite` → `esbuild`. The remedy is Vite 8, a major upgrade. The esbuild
  advisory is the dev-server CORS one, which affects a developer's own
  machine while `npm run dev` is running, not any build output.

Neither reaches a user. Both are worth revisiting on the next dependency
pass, when a major bump can be tested on its own rather than inside a release.

---

## Verified clean

Recorded because "we looked" is the useful half of a sweep, and the next one
should know what was already covered.

### Socket authorisation — all 22 handlers

The August sweep found three handlers with no authorisation at all
(`message:pin`, `message:react`, `dm:send`). Eleven more have been added
since. Every handler was read against the gate it reaches for:

| Gate | Handlers |
|---|---|
| In-call membership, checked server-side against `activeCalls` | `voice:state`, `call:join`, `call:rejoin`, all five `music:*` |
| Channel permission bits | `message:delete`, `message:pin` |
| Relationship (friendship / DM policy) | `dm:send`, `dm:reply` |
| Server or conversation membership | `group:send`, `group:subscribe` |
| Caller-only by construction | `call:leave`, `typing:*`, `presence:*`, `disconnect` |

`message:pin` is **stronger** than the August fix: it now needs
`canAccessMessage` *and* `ManageMessages` in a channel, while staying open in
a DM or group where there is no moderator and a pin is a shared bookmark.

The five `music:*` handlers share one gate, and it is the whole permission
model for the feature: roles do not exist, so what limits damage is the caps,
not identity. A socket that is connected but not in the call achieves nothing
— there is a test that joins one and tries.

### Injection

- No `$where`, `$function` or `mapReduce` anywhere.
- One user id interpolates into a `$regex` (`conversationsController.ts:174`).
  It is JWT-derived **and** validated against `^[a-f0-9]{24}$` immediately
  before use, with the reason written down beside it.
- `searchUsers` escapes before `$regex`, as the August fix left it.
- No `exec`, `execSync`, or `spawn` with `shell: true` anywhere in the tree.

### The music service, which is the largest new attack surface

It is the first thing in Skycord that takes a URL from a member and makes the
**server** fetch it, on a machine PRODUCT.md says sits on a home LAN.

- **SSRF** is judged on the *resolved address*, never the URL text, which
  disposes of decimal, hex, `0.0.0.0` and `nip.io`-style encodings for free.
  Every answer is checked, not the first, because one public and one private
  answer is the cheapest rebinding setup there is. 19 tests.
- The guard **returns the address it approved** and the fetcher connects to
  *that* with `Host` set, so no second resolution can differ from the one
  that was validated.
- **Redirects are re-approved per hop**, with a hop limit, and there is a
  test that a hop the guard rejects is refused rather than followed.
- **`ffmpeg` never sees the URL.** The body is piped to its stdin, so nothing
  a member typed reaches argv — the argument-injection class is absent rather
  than defended. *This is a property of phase 1 only*; phase 2 puts a URL on
  yt-dlp's command line and all of it returns.
- The publisher's LiveKit token sets **`canSubscribe: false`** and narrows
  sources to the microphone: a service that fetches attacker-chosen URLs has
  no business receiving a room's microphones.
- `Content-Length` is never trusted; bytes are counted off the socket, with a
  test where the server claims five bytes and sends a hundred kilobytes.

The container hardening in `compose.music.yaml` — no database credentials,
read-only root, all capabilities dropped, CPU and memory capped — and the
`DOCKER-USER` egress rules documented there are the first line. The code
above is the second, and it needed to be: the guard had a real hole during
development (IPv4-mapped addresses in the hex form a URL normalises to) that
only an integration test caught.

### The Electron shell

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on
  **every** `BrowserWindow` — app, servers, splash and the share picker.
- `will-navigate` prevented and `setWindowOpenHandler` denying on all of them.
- `will-attach-webview` prevented.
- `shell.openExternal` is gated on `externalSafe`, which allows `http:` and
  `https:` only — so `file:`, `javascript:` and the Windows handler schemes
  (`ms-msdt:`, `search-ms:`) cannot be reached through a link.
- The preload exposes four narrow bridges and no general IPC.

### Secrets

- Nothing logs a token, secret, password or cookie. The one line mentioning a
  secret reports that decryption *failed*, without the value.
- The only secret in a URL is the password-reset token, which must be in the
  link. It is **hashed at rest**, TTL-bound, and **single-use** — the handler
  refuses a record with `usedAt` set.
- Voice-server secrets are encrypted at rest (`secretBox.ts`).

### Transport and headers

`app.skycord.xyz` answers with HSTS (2 years, `includeSubDomains`),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`. No `rejectUnauthorized: false` or
`NODE_TLS_REJECT_UNAUTHORIZED` anywhere in the tree.

### Public HTTP surface

Every route file applies `requireAuth` globally except `auth.ts`, where the
deliberately public routes — register, login, refresh, logout, forgot and
reset password, and the `reset-available` capability probe — all carry
`strictLimit`. `/me` and the session-management routes require auth, and the
session revocations are rate limited on top.

---

## Not covered

Stated so the next sweep knows where to start rather than assuming this was
exhaustive.

- **No dynamic testing.** This is a read of the code and the live headers, not
  a penetration test. The August sweep carried `PROVEN` findings from runtime
  probing; nothing here was exploited to confirm it.
- **Permissions as a system.** Individual handlers were checked against the
  gate they call. Whether the permission *model* has a path to privilege
  escalation — a category overwrite that outranks a channel deny, say — is a
  bigger question than this sweep answered, and it is the obvious next one
  now that roles exist.
- **The desktop updater's trust chain.** Signature verification is
  electron-updater's, driven by `latest.yml` from a GitHub release. Not
  reviewed here.
- **Rate limiting under concurrency.** The music limiter is a fixed window
  per member in one process; an instance behind more than one API process
  would get one window each. Single-process is the shipped topology, so this
  is a note rather than a finding.

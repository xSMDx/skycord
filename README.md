# Skycord

Voice, video and screen share for people who already know each other.

A self-hostable place for a friend group to talk. It looks like Discord on
purpose — muscle memory is binding, and a chat app that makes you relearn where
things are is a chat app nobody switches to. What is different is where it
runs: your hardware, your database, no company in the middle.

**Open the app:** [app.skycord.xyz](https://app.skycord.xyz) ·
**Site, roadmap and changelog:** [skycord.xyz](https://skycord.xyz)

**Docs:** [Self-hosting](./docs/self-hosting/) ·
[Installing](./docs/self-hosting/installing.md) ·
[Networking & Cloudflare](./docs/self-hosting/networking.md) ·
[Email & password reset](./docs/self-hosting/email.md) ·
[Roadmap](./docs/ROADMAP.md)

---

## Status — read this before deploying

This is a young project, run by one person, and it is honest about what it is
not. **It works, and it is not finished.**

**What works today:** servers with text and voice channels grouped into
categories, DMs and group DMs, voice and video calls with screen share
(LiveKit), invite links, replies, reactions, pins, edits, custom statuses,
presence, themes, a phone layout, and a keyboard-driven quick switcher.

**What is not built yet, and will affect you:**

| | |
|---|---|
| **Roles and permissions** | Every server is owner-vs-member. There are no moderators, no per-channel permissions, no bans. |
| **Server Settings** | No UI for server-level configuration. Renaming, icons and publishing to Discover are not reachable yet. |
| **End-to-end encryption** | Designed in detail, not built. Messages are stored as plaintext in your database. Do not treat this as a private-messaging tool. |
| **Notifications** | No push, no per-server notification settings. |
| **Moderation tools** | None beyond removing a member. |

If you need any of those, this is not ready for you yet. If you want a small
private place for a group that already trusts each other, it does that well.

---

## Requirements

- **Node.js 22 or newer.** Node 18 is end-of-life and the toolchain no longer
  supports it.
- **MongoDB 4.4.** Pinned deliberately — 5.0+ requires AVX, which pre-2011 CPUs
  lack, and running on old hardware is a goal of this project. Newer MongoDB
  works fine if your CPU supports it; 4.4 is the floor, not a ceiling.
- **A reverse proxy** (nginx, Caddy) with TLS. Not optional — see Configuration.
- **LiveKit** — only if you want voice and video. Text and everything else work
  without it.

## Install

Full walkthrough: **[docs/self-hosting/installing.md](./docs/self-hosting/installing.md)**.
The short version:

```bash
git clone https://github.com/xSMDx/sykord.git
cd sykord
npm ci
cp .env.example .env
```

Then edit `.env` (see below), and:

```bash
npm run build
npm start
```

`npm run build` produces two things: a static client in `dist/`, which your
reverse proxy serves, and the compiled server in `dist/server/`, which
`npm start` runs on `PORT` (3001 by default). Point your proxy's document root
at `dist/` and proxy the API routes to the Node process.

For a long-running instance use a process manager:

```bash
npm i -g pm2
pm2 start dist/server/index.js --name skycord && pm2 save
```

## Configuration

Every variable is documented in [`.env.example`](.env.example). Three matter
more than the rest:

**`NODE_ENV=production`.** This is not a logging switch. Auth cookies get the
`Secure` flag and `SameSite=Strict` **only** when it reads exactly
`production`; anything else serves session cookies that anything on the network
path can read. The server refuses to start in development mode when it is
reachable beyond localhost, rather than let that pass quietly.

**`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.** Two different high-entropy
values. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**`CLIENT_ORIGIN` and `COOKIE_DOMAIN`.** Your real domain in production. These
are what the startup guard checks.

### Optional API keys

Both are free, and the app works without either — it degrades honestly rather
than breaking.

**GIFs (KLIPY).** Powers the GIF picker. Request a key at
<https://klipy.com/developers> and set `KLIPY_API_KEY`. Without it the picker
says *"GIFs aren't set up on this server"* and names the variable to add —
rather than showing an error and telling you to retry something that will never
work. The key is server-side only: KLIPY puts it in the URL path, so any
browser-side call would ship it in the bundle.

**Password reset (Resend).** Set `RESEND_API_KEY` and `EMAIL_FROM` to let
people reset a forgotten password. Without them "Forgot?" is hidden rather than
offered and broken. Domain verification is the step that catches people out —
see [email.md](./docs/self-hosting/email.md).

**Voice and video (LiveKit).** Set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET`. Without them everything except calls works normally.
Setup, and the UDP requirements that trip people up, are in
[networking.md §6](./docs/self-hosting/networking.md#6-voice-and-video-livekit).

### Putting it on a domain

DNS, reverse proxy, TLS, Cloudflare, firewall rules and the voice/UDP gotchas
are all in **[docs/self-hosting/networking.md](./docs/self-hosting/networking.md)**.
Worth reading before you point a domain at this rather than after.

## Development

```bash
npm ci
cp .env.example .env    # then set NODE_ENV=development for local work
npm run dev             # client on :5173, API on :3001
```

```bash
npm test                # 444 tests
npm run typecheck       # client + server
```

The test suite needs a reachable MongoDB. Tests never run against your
production database — they use a separate database and reset it between files.

## Project layout

```
src/           Vue 3 client
server/        Express + Socket.IO + Mongoose
  controllers/ HTTP handlers
  sockets/     realtime
  models/      Mongoose schemas
docs/          ROADMAP.md, PRODUCT.md, and design specs
landing/       the marketing page (separate static deploy)
```

`docs/` is worth reading before contributing — the specs record *why* decisions
were made, not just what was built.

## Contributing

Issues and pull requests welcome. Two things worth knowing:

- Tests and typecheck must pass (`npm test`, `npm run typecheck`).
- Comments here explain **why**, not what. If a line looks odd and the reason is
  not obvious from the code, say so in a comment — most of the existing ones
  exist because something non-obvious broke once.

## License

AGPL-3.0. If you run a modified version as a network service, you have to offer
its source. Fork it, run it, change it — just keep it open.

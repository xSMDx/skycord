# Self-hosting Skycord

Running your own instance — your hardware, your database, nobody in the middle.

## Guides

**[Installing](./installing.md)** — the one command, what it asks, what it sets
up, updating, backups, and using pieces you already run.

**[Installing by hand](./manual-install.md)** — the same thing without Docker:
Node, MongoDB, a web server and a process manager, wired up yourself.

**[Email & password reset](./email.md)** — Resend setup, domain verification,
and how the reset flow behaves. Optional; the app runs fine without it.

**[Networking](./networking.md)** — putting it on a domain. Opens by letting you
pick how far to go — localhost-only, public with TLS, or fully hardened — then
covers DNS, reverse proxy, TLS, Cloudflare, the UDP requirements for voice,
firewall rules, and the mistakes that make a working install look broken.

Read Installing first. The one command covers the domain, the certificate and
the proxy, so Networking is then background rather than homework — worth
reading for DNS, Cloudflare, firewalls, and what to check when calls connect
with no sound. Email is independent: set it up whenever you want password reset
to work.

## Before you start

Two things are worth knowing up front, because they decide whether this is the
right tool for you at all.

**`NODE_ENV=production` is a security setting, not a logging one.** Auth cookies
get `Secure` and `SameSite=Strict` only when it reads exactly that. The server
refuses to boot in development mode when it is reachable beyond localhost, so a
mistake here stops the instance instead of quietly weakening it.

**Some things are not built yet**, and they will affect you:

- **No bans.** Kicking works; a ban that stops somebody coming back does not
  exist yet.
- **No admin tier.** The first account registered is an ordinary account.
  Anything instance-wide happens in the database or not at all.
- **No end-to-end encryption.** Designed in detail, not built. Messages are
  stored as plaintext in your database. Do not treat this as a private-messaging
  tool.
- **No push notifications.**

If you need any of those, wait. If you want a small private place for a group
that already trusts each other, it does that job now.

## The hosted instance

If you would rather not run one: [app.skycord.xyz](https://app.skycord.xyz).
Same software, someone else's hardware. [skycord.xyz](https://skycord.xyz) has
the roadmap and changelog.

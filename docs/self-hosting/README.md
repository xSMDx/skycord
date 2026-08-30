# Self-hosting Skycord

Running your own instance — your hardware, your database, nobody in the middle.

## Guides

**[Installing](./installing.md)** — requirements, first-time setup, every
environment variable, the optional API keys, updating, and running it under a
process manager.

**[Networking](./networking.md)** — putting it on a domain: DNS, reverse proxy,
TLS, Cloudflare, the UDP requirements for voice, firewall rules, and the
mistakes that produce a site which looks broken for no obvious reason.

Read Installing first, then Networking. You can get a working instance on
localhost from Installing alone; Networking is what puts it on the internet
safely.

## Before you start

Two things are worth knowing up front, because they decide whether this is the
right tool for you at all.

**`NODE_ENV=production` is a security setting, not a logging one.** Auth cookies
get `Secure` and `SameSite=Strict` only when it reads exactly that. The server
refuses to boot in development mode when it is reachable beyond localhost, so a
mistake here stops the instance instead of quietly weakening it.

**Some things are not built yet**, and they will affect you:

- **No roles or permissions.** Every server is owner-vs-member. No moderators,
  no per-channel permissions, no bans.
- **No Server Settings UI.** Server-level configuration is not reachable yet.
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

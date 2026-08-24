# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop-first. A phone layout exists but is explicitly on hold and is not a design target
right now. An Electron desktop shell is planned (partly to reach OS-level idle detection and a
secure mic context without a certificate), but it wraps this same web UI — it does not introduce
a native design language.

## Users

**Primary: self-hosters, and specifically people with an old machine they want to put to work.**
The situation is concrete — someone has a laptop or desktop a few generations old sitting in a
closet, and they want it to be the thing their friends talk on. The job is "run a place for my
people to hang out, on hardware I already own, without an account with a company."

The crew they invite is the second audience: 5–30 people who already know each other, who would
otherwise be on Discord, and who mostly want voice and text to work without thinking about it.
They did not choose Skycord — the host did — so nothing may require them to understand
self-hosting to use it.

Universities and schools are a later expansion, not the current design target.

## Product Purpose

A self-hosted place for a group of people to talk — text channels, voice channels, direct
messages, calls, screen share. Success is a host getting their own instance running on modest
hardware and their crew staying on it because it does not feel like a downgrade.

## Positioning

Three claims, in the order they matter:

1. **You can run it yourself.** Your hardware, your data, no company in the middle. This is not
   a marketing line — it drives real technical decisions and is allowed to constrain them.
2. **Real end-to-end encryption** — opt-in per conversation and permanent once enabled, with
   device authorisation derived from the ECDH shared secret rather than issued by the server.
   Designed in detail, **not yet built**; do not present it as shipped.
3. **Open and donation-funded.** Open-source once the app is in good shape, funded by donations.
   No ads, no upsell, no eventual monetisation of the people using it.

## Operating Context

- The host runs the server themselves; the members just sign in. Two very different relationships
  to the same product, and only one of them ever sees a terminal.
- **Everyone arrives already knowing Discord.** That is an asset, and the user has made it a
  binding constraint (see Brand Commitments).
- Long-session software: people leave it open all day, in the background, while doing something
  else. Anything that demands attention repeatedly is a tax, not a delight.
- Voice is used heavily and is the highest-stakes surface — the moment a microphone goes live is
  the moment the product is most able to embarrass someone.

## Capabilities and Constraints

**Shipped:** servers, categories, text channels, voice channels, DMs, group DMs, voice/video
calls, screen share, invites (including invites that land you in a specific voice channel),
presence with timed statuses, member lists, message replies/reactions/pins, themes, custom
accent, GIFs, stickers.

**Designed, not built:** end-to-end encryption. **Not built:** roles and permissions (everything
is owner-vs-member today), Server Settings, per-channel permissions, per-server profile,
notification settings, server mute.

**Hardware constraint, load-bearing:** the stack must run on old consumer hardware. MongoDB is
pinned to **4.4** precisely because 5.0+ requires AVX, which pre-2011 CPUs lack. Weigh "can
someone self-host this on a machine they already own?" against any infrastructure decision.
A consequence worth knowing: Mongo runs standalone with no replica set, so **transactions are
unavailable** and concurrency is handled with atomic single-document updates.

**Scale:** built for crews, not communities. A server caps at 100 members.

Voice runs on LiveKit. The client is Vue 3 + TypeScript; the server is Express + Socket.IO.

## Brand Commitments

- **Name:** Skycord. Domains `skycord.xyz` (landing) and `app.skycord.xyz`.
- **Muscle memory is binding.** The three-column structure (server rail → channel sidebar →
  conversation), where things live, and what clicks do must not change. A redesign replaces the
  visual world on top of that structure; nobody should have to relearn where anything is.
- Landing voice, already in use: *"your crew's place to talk."* Plain, unceremonious, second
  person.
- The repository is private on purpose until the app is in good shape.

## Evidence on Hand

- Running deployment at `app.skycord.xyz`, landing page at `skycord.xyz`.
- A design critique of the current desktop UI scored **19/40** and is archived at
  `.impeccable/critique/2026-08-24T03-49-06Z__src-views-chatapp-vue.md`. Its central finding —
  that the chrome reproduces Discord's palette exactly, down to requesting Discord's proprietary
  `gg sans` without shipping a font file — is what prompted the redesign.
- Roadmap and known defects: `docs/ROADMAP.md`.

## Open Decisions

- Whether education (classes, cohorts) becomes a first-class capability or stays a use case.
- Whether E2EE ships before or after the desktop shell.

# Ember landing page — design

**Date:** 2026-08-24
**Surface:** `landing/index.html` → `/var/www/skycord.xyz/` (separate deploy target from the app)
**Mode:** Persuade. Unlike the app, no "keep the stock look" constraint applies here.
**Approved:** in session, after the Ember direction was chosen over Paper and Terminal.

## Premise

The landing page is Skycord's own brand surface. The app deliberately looks like Discord
because muscle memory is binding; the landing page must NOT, because wearing Discord's
blurple says "clone" before a visitor reads a word. It also currently tells the wrong
story: the hero and all three meta descriptions say "running on our own server", while
PRODUCT.md's first positioning claim is that you can run it yourself.

The pitch chosen (from three options): **both, honestly sequenced.** The hosted instance
is the primary CTA because it exists; self-hosting is named as arriving with the
open-source release, as a plain statement rather than a button. No email capture — there
is no list, no endpoint, and a privacy-first product should not collect addresses it has
no system to handle.

## Visual world — "Ember"

The metaphor: an old machine in a closet with one warm light on. The box is running;
your people are on it. Personal and physical, not corporate.

```
--ground   #14110F   warm charcoal (not slate-blue — every chat product ships slate)
--surface  #1E1A17   cards, nav
--line     #35302B   hairline borders
--text     #F2EDE7   warm white
--text-2   #B8AFA4   secondary
--ember    #E8853A   the accent: CTAs, live states, the machine's LED
--ember-hi #F09D5B   hover
--sage     #8A9A7B   mono accents: uptime, specs, version numbers
```

Type: **Fira Sans** (headings 600, body 400) + **Fira Code** (mono accents), replacing
Space Grotesk/Inter/JetBrains Mono. Chosen via ui-ux-pro-max's typography DB (the one
useful hit of its four; its two pattern suggestions — Enterprise Gateway and Portfolio
Grid — were rejected as category mismatches).

Flat surfaces, hairline borders, no gradients, one shadow under the hero visual only.
Transitions 150–200ms ease-out. `prefers-reduced-motion` honoured. Contrast ≥4.5:1 on
every text/ground pair, measured not assumed.

## What stays

- Four views under the tabbed nav: home, features, roadmap, changelog.
- Single self-contained file; `og.jpg` unchanged; no build step.
- `RELEASES` data verbatim.
- The headline: **"Your crew's place to talk."**
- The plain, unceremonious, second-person voice throughout.

## What changes

**Hero.** Sub-line: "Voice, video and screen share for people who already know each
other. Runs on hardware you own — ours today, yours when we open-source." Primary CTA
`Open Skycord` (ember). Beside it, plain text: "Self-hosting lands with the open-source
release." No second button.

**Hero visual.** The fake app-screenshot mock is replaced by a CSS illustration of an
old tower machine with one ember LED, and a Fira Code caption:
`uptime 214 days · 8 friends connected · your hardware`. This is the brand image.

**Meta descriptions** (all three: description, og:description, twitter:description)
lose "our own server" and carry the honest line — these are what Discord unfurls.

**Roadmap data corrections** (truthfulness, independent of design):
- "Mobile app" moves from *Building now* → *Being looked at* (phone layout is on hold).
- "Channels" moves from *Next up* → *Building now*, copy updated: servers, categories,
  voice channels and invites are live; roles and server settings are the part still
  coming.
- Everything else carries over unchanged.

**Features grid**: keeps its items but drops "Mobile support" and adds
"Channels & servers".

**Footer**: carries the donation-funded / no-ads / open-source-planned line.

## Verification

- Contrast on every token pair via computed styles.
- 375 / 768 / 1024 / 1440 widths, no horizontal scroll.
- Reduced motion: transitions collapse, nothing disappears.
- Tab through the page: focus visible on every interactive element.
- Deploy: `sudo cp -r ~/sykord/landing/* /var/www/skycord.xyz/`, then verify the OG
  unfurl and hard-refresh the page.

## Rejected

- **Paper** (light editorial README look): confident but reads "project" not "product"
  to the non-technical half of the audience.
- **Terminal** (phosphor on black): strongest self-hoster signal, but the most-copied
  indie look, and it speaks only to the host — the crew being invited did not choose
  Skycord.
- **Email capture** for the self-hosting announcement: no list infrastructure, and
  collecting addresses without one contradicts the privacy story.
- **Enterprise Gateway / Portfolio Grid** patterns from the design DB: category
  mismatches for a donation-funded app for friend groups.

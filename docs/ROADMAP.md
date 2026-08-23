# Skycord Roadmap

The ordered queue. Nothing here starts until the user says so — they trigger each item.

## Standing directives

- **No deploys until channels is finished.** Everything lands on `main` unpushed and unshipped.
  The gate is: channels complete → **UI/UX audit and polish** → then ship. (Stated 2026-08-21,
  extended 2026-08-23.)
- **Phone / mobile layout is on hold.** Do not spend effort on touch variants.
- The nginx deploy gate is still required before anything ships: `servers` and `invites` must be
  in the location alternation, and `/join/<code>` must fall through to the SPA index.

## Queue

| # | Item | State |
|---|------|-------|
| 1 | **Channels** | in progress — see below |
| 2 | **UI/UX audit and polish (whole app)** | queued, scoped below |
| 3 | E2EE | designed, not built — `docs/superpowers/specs/2026-08-09-e2ee-design.md` |
| 4 | Electron desktop shell + auto-update | parked, needs a brainstorm on pickup |

Done and shipped: context menus (v0.6), mobile/PWA rebuild (v0.10), profile picture and banner
framing, landing page, call telemetry (v0.9), presence fixes (v0.10.1).

Still unscoped, ask when picked up: user customization, user profile rebuild, password reset via
authenticator (TOTP — new backend and schema, not a UI change).

---

## 1. Channels — what remains

Plans live in `docs/superpowers/plans/`, ledger in `.superpowers/sdd/progress.md`.

Merged: servers/channels API, channel messaging, 3a client slice, 3b operable server,
3c categories, 3d voice + invites, 3e voice stage, 3f members and presence UI.

Outstanding:

- **Server Settings** — a real screen. None exists. Next up by the user's instruction.
- **Drag-to-reorder channels and categories** (owners). No reorder endpoint exists at all;
  `position` is assigned on create and never updated. No list-reordering primitive in `src/`.
- **Invite expiry choice** — the server accepts `24h`/`7d`/`never` and the modal displays expiry,
  but the client never sends a choice, so every invite silently gets 24h.
- **Text chat under the voice stage** — the Stoat-style "chat down there where your voice chat is"
  the user liked. Deferred deliberately: it reverses the spec's "text inside voice channels is out
  of scope" and needs a conversationId, history and a composer per voice channel.
- Per-channel permissions, roles, per-server profile.

---

## 2. UI/UX audit and polish

**Added 2026-08-23 at the user's request:** once channels is up and running, scope the whole app
for UI/UX flaws and perfect them, using the skills available rather than ad-hoc judgement.

This is a deliberate phase, not a cleanup pass tacked onto the end of channels. It runs across the
whole app, not only the surfaces channels touched.

### Why it is its own phase

The app has been built feature-first over many months by different plans. Several surfaces are
known to be inconsistent or half-finished, and the user has already named some of them:

- **Presence / status UI overall** — the user's words: buggy, needs a full UI/UX overhaul. Partly
  addressed in 3f (live status, chevrons, member list) but never audited end to end.
- **Voice channel styling** — reference is Discord and Stoat; the separated-from-Discord direction
  is wanted, the execution is not finished.
- **The server dropdown** — restyled in 3b but still reads closer to a context menu than to a
  sectioned server menu.
- Light-mode issues and layout glitches the user will name per screen.
- Call visuals: participant tiles, speaking rings, mute/deafen states, layout for 2+ people.

### Method — the skills to actually use

Run these rather than eyeballing it:

- **`ui-ux-pro-max`** — the searchable design database (styles, palettes, font pairings, UX
  guidelines, motion presets). Primary reference for any concrete styling decision.
- **`gsd-ui-review`** — retroactive six-pillar visual audit of implemented frontend code, produces
  a scored `UI-REVIEW.md`. This is the scoping instrument: run it first to get a ranked list of
  flaws instead of guessing where to start.
- **`claude-mem:design-is`** — audit against Dieter Rams' ten principles, then hands off a plan
  prompt. Good second opinion on whether a surface earns its complexity.
- **`apple-design`** — for motion, gestures, springs, interruptible transitions, translucency and
  typography. Relevant to the sheets, flyouts, call stage and anything drag-driven.
- **`frontend-design`** — aesthetic direction, keeping the result from reading as templated.
- **`dataviz`** — the call telemetry ping graph is a real chart and should be held to it.
- **`superpowers:brainstorming`** before any redesign, **`superpowers:writing-plans`** to turn the
  audit into executable plans.

### Shape of the phase

1. **Scope** — run the audit skills across the app, surface by surface, and produce one ranked
   inventory of flaws. No fixes yet.
2. **Triage with the user** — they decide what is a flaw and what is intentional. Their taste is
   the spec; several "inconsistencies" are deliberate divergences from Discord that they like.
3. **Plan and execute** in slices, the same way channels was built.
4. **Exit criteria:** the ranked inventory is empty or explicitly deferred, and the user has seen
   and signed off on each surface.

### Constraints carried in

- Phone layout stays on hold, so this is a desktop pass.
- `object-fit: cover` crops to the element box first, and `border-radius` does not clip a scaled
  element — both cost several rounds before. See `src/composables/useCrop.ts`.
- Never render a status from a fetched copy; route it through `livePresence(id, fetched)`.

---

## Known debts, unscheduled

- `lucide-vue-next@1.0.0` is deprecated (npm says use `@lucide/vue`), imported in 39 files.
  Mechanical fix: same component names, different specifier.
- VPS runs Node v18.19.1, EOL since April 2025. Node 20 LTS upgrade is overdue.
- Security sweep finding #4 still open: prod runs `NODE_ENV=development`, so the refresh cookie
  ships without `Secure` over the plaintext Cloudflare→origin leg. Must be fixed *with* the
  Cloudflare origin certificate — flipping `NODE_ENV` alone breaks login.
- Deleting a channel orphans its `Message` documents.
- `withServerLock` is per-process, valid only while the API is one pm2 process.
- `vite.config.ts` hardcodes `hmr.clientPort: 5173`, which is wrong whenever the dev server runs
  on another port and wrong behind nginx.

# Skycord Roadmap

The ordered queue. Nothing here starts until the user says so — they trigger each item.

## Standing directives

- **Ship channels incrementally. (Superseded the old gate 2026-08-24.)** The previous directive
  was "no deploys until channels is finished — channels complete → UI/UX audit → then ship."
  That is retired. The user's reasoning: Discord's own channels were not complete at launch
  either; they grew a piece at a time. A slice ships when it is *safe*, not when the feature set
  is *finished*.

  What that changes: **Server Settings and roles no longer block a deploy.** They are the next
  slices, not a gate. Absent capabilities are badged "Soon" in the UI rather than hidden, so
  shipping without them is honest rather than misleading.

  What it does NOT change — these are safety gates and still hold:
    1. ✅ nginx location alternation must include `servers` and `invites`, and `/join/<code>`
       must fall through to the SPA index. **Done 2026-08-24, verified: the 404 on `/servers`
       came from the API as JSON, not from nginx as HTML, proving the proxy matches.**
    2. ✅ **DONE 2026-08-30.** The Cloudflare→origin leg is TLS and the refresh cookie is
       protected end to end. Cloudflare Origin certificate at `/etc/ssl/cloudflare/`
       (RSA 2048, SAN `skycord.xyz` + `*.skycord.xyz`, valid to 2041); nginx listens on
       443 and 2053; Cloudflare SSL/TLS set to **Full (strict)**; `.env` on
       `NODE_ENV=production` with `CLIENT_ORIGIN=https://app.skycord.xyz`; pm2 running
       the compiled `dist/server/index.js`. Verified on a fresh login rather than
       assumed: `syk_rt` carries HttpOnly, Secure and SameSite=Strict.

       443 was reclaimed from `forward443.service`, a socat unit relaying the whole
       port to 91.107.243.162. Sampled at zero established connections and disabled,
       **not deleted** — `systemctl enable --now forward443` restores it if the far end
       turns out to need it. 2053 stays as a fallback.

       Fixed in the same session: `cp -r dist/*` had been publishing the compiled
       backend and its sourcemaps into the public web root on every deploy. See the
       deploy notes for the nginx trailing-slash trap that fix walked into.

    3. ⬜ A human smoke-tests the build before it goes out. Not perfectionism — the UI pass was
       verified in a review browser with no microphone, no real pointer input, no matching
       `:focus-visible`/`:active`, and a starved rAF. Voice is the least-verified surface.
- **Phone / mobile layout is ACTIVE again (2026-08-25).** The hold is lifted. It was
  frozen while channels was desktop-only; channels shipped, and none of it was reachable
  on a phone — the rail was `display: none` with a note saying it would be designed
  alongside channels.

  Being built in slices, same as channels:
    1. ✅ **Navigation** — the rail returns beside the channel list on the list screen,
       keeping the existing two-screen push. Touch targets to 44px, and the hover-only
       `+` and row actions made permanent (hover does not exist on a phone, so there was
       no discoverable way to create a channel). Spec:
       `docs/superpowers/specs/2026-08-25-phone-channels-nav-design.md`
    2. ⬜ **Voice on a phone** — the stage, call controls, occupant list as phone screens.
    3. ⬜ **Server management on a phone** — create channel/category, invites, members.

## Queue

| # | Item | State |
|---|------|-------|
| 1 | **Channels** | in progress — see below |
| 2 | **UI/UX audit and polish (whole app)** | queued, scoped below |
| 3 | Electron desktop shell + auto-update | parked, needs a brainstorm on pickup — now blocks E2EE |
| 4 | E2EE (DMs only) | designed, not built — `docs/superpowers/specs/2026-08-30-e2ee-revision.md`; gated on native mobile **and** desktop apps |

Done and shipped: context menus (v0.6), mobile/PWA rebuild (v0.10), profile picture and banner
framing, landing page, call telemetry (v0.9), presence fixes (v0.10.1).

Still unscoped, ask when picked up: user customization, user profile rebuild, password reset via
authenticator (TOTP — new backend and schema, not a UI change).

---

## 1. Channels — what remains

Plans live in `docs/superpowers/plans/`, ledger in `.superpowers/sdd/progress.md`.

Merged: servers/channels API, channel messaging, 3a client slice, 3b operable server,
3c categories, 3d voice + invites, 3e voice stage, 3f members and presence UI,
3g polish (two-colour voice badge, camera modal, animated chevrons, category animation,
drag between categories, timed statuses, Invite to Voice, cascading menus, voice member
state, voice occupant menus).

### Next slices (no longer blocking a deploy — see Standing directives)

- **Server Settings** — a real screen. Nothing exists: no component, no route. The user has
  named it next more than once, and three other items are queued behind it.
- **Roles and permissions** — no role field anywhere in the model. Everything is
  owner-vs-member today, which is why invites and channel CRUD are owner-only and why the
  moderation rows below cannot be built.

### Queued behind those

- **Moderation in voice** — Server Mute, Server Deafen, Disconnect, Kick. They act on
  someone else's client and need the permissions model. Deliberately parked with kick/ban.
- **Server mute** — no field, no endpoint. The rail label's reference shows a "Muted" line
  that cannot be shown truthfully until this exists.
- **Notification settings, Hide Muted Channels, Privacy Settings, per-server profile** —
  all absent from the server menu for the same reason: nothing behind them.

### Independent of settings

- **Reordering *within* a category.** `position` is assigned on create
  (channelsController, categoriesController) and never updated — there is no write path.
  Moving *between* categories now works and is not this.
- **Text chat under the voice stage** — the Stoat-style layout the user liked. Deferred
  deliberately: it reverses the spec's "text inside voice channels is out of scope" and
  needs a conversationId, history and a composer per voice channel.
- **Mention / Add Note / Block / Ignore / Apps / Soundboard** in the user menus — each
  needs its own backing (composer insertion API, per-relationship data, a block model).

### Known defects, unscheduled

- Deleting a channel orphans its `Message` documents server-side.
- Group reactions are unverified — un-gating `handleReact` in 3a fixed groups incidentally,
  and no test covers a group reaction.
- Non-owner paths across 3b are unit-tested only, never exercised in a browser.
- Rail double-click race: two fast clicks on two uncached servers can leave
  `activeChannelId` from server A while `activeServerId` is B.
- `role="button"` on `.ch-item` wrapping a real `<button>` is ARIA
  children-presentational; the correct shape is a plain row with the label inside the
  button and `.ch-more` as its sibling.
- `withServerLock` is per-process, valid only while the API is one pm2 process.

### Before anything ships

- nginx needs `servers` and `invites` in its location alternation, and `/join/<code>` must
  fall through to the SPA index.

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

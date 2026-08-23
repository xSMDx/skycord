# Channels Plan 3g — Visual Fixes, Timed Statuses, and Invite to Voice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six things the user asked for after reviewing the running app. Three are small visual
fixes; three are real features, two of which need new backend.

## Global Constraints

- **No new runtime or dev dependencies.** This includes drag-and-drop: build the primitive, do not
  add a library.
- **`npm run typecheck` must exit 0.** Baseline is zero errors.
- **All existing tests stay green.** Baseline **361 across 31 files**. Run `npx vitest run`
  unfiltered before every commit. Requires Docker/MongoDB; a stopped daemon shows as `connectDb`
  hook timeouts across ~16 files and is an environment failure, not a code one.
- **Files have mixed CRLF/LF line endings.** Content-based edits only, never line numbers.
- **The phone layout is on hold.** Desktop only.
- **Nothing deploys.** The nginx gate stays parked.
- **Never render a status from a fetched copy.** Route it through `livePresence(id, fetched)`.
- **Never send `user.status` raw from the server.** It goes through `effectiveStatus(stored, userId)`
  in `server/state/presence.ts`, which maps `invisible` to `offline`. There is deliberately no field
  in any public payload that says "invisible".

## Facts established by survey — trust these over your own assumptions, but verify before relying

- `.ri-voice` (ChatApp.vue, the rail badge) hardcodes `background:#23a55a`.
- `CameraPreviewModal.vue` **already exists** and is already mounted in `ChatApp.vue` behind
  `showCameraPreview`, with an `@confirm="onCameraConfirmed"`. `CameraFlyout.vue` has its own
  separate inline preview (a `previewing` ref and a `.cf-prevbox`) — that inline one is the bug.
- `.cb-chev` buttons in `CallBar.vue` open the mic and camera flyouts. A rotate-on-open precedent
  already exists further down the same file (the expand chevron uses an inline `transform`).
- **`updateChannel` already accepts `category` in the body** and moves a channel into a category or
  out of one, validating that the category belongs to this server. Moving between categories is
  therefore already backed by the API. **`position` is assigned on create and never updated**, so
  ordering *within* a category is not.
- `User.status` is an enum with **no expiry field**. But `ICustomStatus` already carries
  `clearAt: Date | null` with expiry applied **on read** via `liveStatus()` — no sweeper, matching
  how conversation mute works. Mirror that pattern; do not invent a second one and do not add a cron.
- `ServerInvite` has `code`, `server`, `createdBy`, `expiresAt`, `uses`. **No channel field.**

## Out of scope

- Reordering channels *within* a category (needs a `position` write path). Moving *between*
  categories is in scope; say so in your report rather than quietly adding ordering.
- Roles, per-channel permissions, Server Settings.
- Text chat under the voice stage.

---

### Task 1: The voice indicator gets two colours

**Files:** Modify `src/views/ChatApp.vue`

The user's decision, after being offered a six-colour scheme: **"lets keep it simple 2 colors green
and black like pic 1."**

- [ ] **Step 1**

`.ri-voice` is green for everyone right now. Make it mean something: **green when you are in that
server's voice**, **black/dark when there is voice activity you are not part of**. Derive
"am I in it" from the room you are actually connected to, not from membership of the server.

Keep the existing ring (`box-shadow: 0 0 0 2px var(--bg-floor)`) so the dark state still reads as a
badge against a dark rail rather than disappearing into it. Check it in both themes.

- [ ] **Step 2:** Typecheck, full suite, build, commit.

---

### Task 2: Previewing the camera opens the modal, not an inline box

**Files:** Modify `src/components/voice/CameraFlyout.vue`, `src/views/ChatApp.vue`

The flyout grows a live preview inside itself, which is what the user photographed as wrong. The
reference (Discord's "Ready to video chat?") is a centred modal — and this project already has one.

- [ ] **Step 1**

Read `CameraPreviewModal.vue` first and report what it already does. Compare it against the
reference: a preview area, a camera picker, an "Always preview video" preference, and a
"Turn On Camera" confirm. Build only what is missing.

- [ ] **Step 2**

Make the flyout's preview row **open that modal** and close the flyout, instead of expanding
`.cf-prevbox`. Delete the inline preview and its `previewing` / `startPreview` / `stopPreview`
machinery **only if nothing else uses it** — check, do not assume. Any temporary capture the
inline preview owned must still be stopped; a leaked camera track is a lit webcam LED.

- [ ] **Step 3:** Typecheck, full suite, build, commit.

---

### Task 3: Animate the mic and camera chevrons

**Files:** Modify `src/components/voice/CallBar.vue`

The user arrowed both `.cb-chev` buttons. They are static; the flyout they open gives no visual
acknowledgement from the control itself.

- [ ] **Step 1**

Rotate each chevron 180 degrees while its own flyout is open, with a real transition — not the
instant inline `transform` the expand chevron uses. Only the chevron whose menu is open moves.

Respect `prefers-reduced-motion`: the rotation is decoration, so it should snap rather than
animate for users who have asked for less movement. Check whether this file or the global stylesheet
already has a reduced-motion block and follow it rather than inventing a second convention.

- [ ] **Step 2:** Typecheck, full suite, build, commit.

---

### Task 4: Categories animate, and channels can be dragged between them

**Files:** Modify `src/views/ChatApp.vue`, `src/composables/useServers.ts`, `src/composables/useApi.ts`

- [ ] **Step 1: Animate collapse**

`collapsedCategories` flips a boolean and the channels vanish. Animate open and close. A CSS
`height` transition needs a measured height because `auto` does not animate — use the standard
Vue `<Transition>` JS hooks, or a grid-rows trick, but not a hardcoded per-row height: categories
hold different numbers of channels and channel names wrap.

The category's own chevron should rotate with the same timing, so one gesture reads as one motion.
Same reduced-motion rule as Task 3.

- [ ] **Step 2: Write the failing tests for the move**

Before touching drag: `updateChannel` already accepts `category`, so the client work is a call it
does not currently make. Add a `moveChannel(sid, cid, categoryId | null)` wrapper in `useApi.ts` and
cover in `useServers.test.ts`:

- a channel moved into a category leaves its old group and appears in the new one
- a channel moved **out** of every category (`null`) lands in the uncategorised group
- `groupedChannels` order stays deterministic afterwards
- a move the server rejects does not leave the sidebar showing the optimistic position

- [ ] **Step 3: The drag primitive**

There is **no list-reordering primitive anywhere in `src/`** — the only drag code is image cropping
and bottom-sheet dragging, and neither generalises. Build the smallest thing that works for this
list: HTML5 drag-and-drop is already in the platform and needs no dependency.

Requirements:
- Text channels and voice channels both drag.
- Dropping onto a category moves the channel into it; dropping outside every category moves it out.
- A drop target is visible while dragging — the user must be able to see where it will land.
- Owners only. `updateChannel` is `requireOwner`-gated, so a non-owner drag would fail at the API;
  do not offer the affordance to someone who cannot use it.
- The sidebar must not be left showing a move the server refused.

- [ ] **Step 4:** Typecheck, full suite, build, commit.

---

### Task 5: The member list, and statuses that actually expire

**Files:** Modify `src/views/ChatApp.vue`, `src/components/profile/ProfilePopout.vue`,
`server/models/User.ts`, `server/state/presence.ts`, `server/controllers/usersController.ts`,
plus tests

The user chose **"Member list + real timers"**, which reverses the earlier chevrons-only decision.
The chevrons must now open something.

- [ ] **Step 1: Restyle the member list**

Match the reference's grouping and density. Sections, section counts, dimmed offline block. Keep
the grouping logic in `activeMembers` — it is tested; this is presentation only.

- [ ] **Step 2: Write the failing backend tests**

`User.status` has no expiry. `ICustomStatus.clearAt` + `liveStatus()` is the pattern to mirror:
**expiry on read, no sweeper**. Add `statusUntil: Date | null`.

Cover in `server/__tests__/`:
- a status with `statusUntil` in the future is reported as chosen
- a status whose `statusUntil` has passed reports as `online`, not as the expired value
- `statusUntil: null` never expires
- **an expired `invisible` does not leak** — it must report as online, and at no point as the
  literal string `invisible`
- setting a new status clears a stale `statusUntil` rather than inheriting it
- the expiry is applied inside `effectiveStatus`, so **every** caller gets it — a second copy of
  this logic is how `invisible` once leaked verbatim

- [ ] **Step 3: Implement the backend**

Expiry belongs in `effectiveStatus` because that is the single funnel every public payload goes
through. Remember a Mongoose `default` does not reach already-stored rows, and `.lean()` reads
`undefined` where a hydrated doc reads `null` — treat both as "no expiry".

- [ ] **Step 4: The submenus**

Chevrons open a duration list: 15 Minutes, 1 Hour, 8 Hours, 24 Hours, 3 Days, Forever. Picking a
duration sets the status **and** its expiry. Clicking the status row itself still sets it instantly
with no expiry — the chevron is the only thing that opens the submenu.

The UI must show a status that expired while the tab was open without needing a reload.

- [ ] **Step 5:** Typecheck, full suite, build, commit.

---

### Task 6: Invite to Voice

**Files:** Modify `server/models/ServerInvite.ts`, `server/controllers/invitesController.ts`,
`src/views/ChatApp.vue`, `src/composables/useApi.ts`, a new component for the modal, plus tests

The user's words: **"when some one hit the see more it will show the modal, and the invite will be
like a group invite and a channel invite which will directly join you in that voice chat if you hit
join."**

- [ ] **Step 1: Write the failing tests**

`ServerInvite` has no channel field. Add a nullable `channel`, and thread it through preview and
join so the client knows where to land.

Cover:
- an invite created against a voice channel carries it; a plain server invite still has none
- `previewInvite` names the voice channel when there is one
- `joinViaInvite` returns the channel so the client can act on it
- a channel-targeted invite whose channel was **deleted** still joins the server and simply does not
  land you in voice — it must not 500, and it must not refuse the join
- a channel from a *different* server is refused, the same way `updateChannel` refuses a foreign
  category
- an already-member using a channel invite still gets the channel back (they should land in voice
  even though there is no join to perform)

- [ ] **Step 2: Backend**

Mirror `updateChannel`'s category resolution for validating that the channel belongs to this server.

- [ ] **Step 3: The inline flyout**

An "Invite to Voice" row under a voice channel, listing a few friends with a one-click invite, and
a **"See more…"** that opens the modal. Check what an invite actually *delivers* to the recipient
before designing this — if there is no notification path, say so in your report rather than building
a button that silently does nothing.

- [ ] **Step 4: The modal**

Search, the server's member list, per-row invite, and the shareable link. Reuse `activeMembers`
from 3f rather than fetching members again.

- [ ] **Step 5: Landing in voice**

Following a channel invite joins the server and connects to that voice channel. The three-way room
naming contract still applies: `roomFor`, `callRoom` and `voiceRoomName` must all produce
`voice:<channelId>`.

- [ ] **Step 6:** Typecheck, full suite, build, commit.

---

### Task 7: Browser verification

- [ ] **Set the viewport to at least 1280 wide first.** A previous pass was run at 374px, where the
      app is in `.shell.mobile` and the rail is `display:none` — and hidden DOM answers
      `querySelector` perfectly well, so every check read as a pass while nothing was on screen.
- [ ] The voice badge is green when you are in the call and dark when you are not.
- [ ] The camera preview row opens the modal; no inline box; no camera left running after closing.
- [ ] Both chevrons rotate when their flyout opens and return when it closes.
- [ ] Categories animate open and closed, chevron included.
- [ ] A channel drags into another category and stays there after a reload. A voice channel too.
- [ ] Dragging is not offered to a non-owner.
- [ ] The member list matches the reference.
- [ ] A timed status expires on its own, visibly, without a reload — and an expired invisible reads
      as online, never as "invisible".
- [ ] Invite to Voice: the inline list invites, "See more…" opens the modal, and following the
      invite lands you in that voice channel.
- [ ] Console errors and any 4xx.

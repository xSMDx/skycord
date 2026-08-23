# Channels Plan 3f — The Member List and Voice Presence in the Sidebar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every server saying "Members 0", and make voice activity visible from the rail without opening the server.

**Architecture:** Almost all of this is client work. `GET /servers/:sid/members` already returns everything the panel needs — id, username, displayName, avatar, avatarCrop, `effectiveStatus`, and `isOwner` — and `livePresence` already exists to keep a fetched status current. The voice indicators read `activeCalls`, which the client already holds.

## What is actually wrong

`src/views/ChatApp.vue` renders the server members panel from

```ts
const members: Member[] = []      // a literal, empty, from the mock era
```

so the header reads `Members 0` on every server, forever, and the Online section is always empty. It is not an unstyled list; there is no data behind it at all.

## Global Constraints

- **No new runtime or dev dependencies.**
- **`npm run typecheck` must exit 0.** Baseline is zero errors.
- **All existing tests stay green.** Baseline **335 across 30 files**. Run `npx vitest run` unfiltered before every commit. Requires Docker/MongoDB; a stopped daemon shows as `connectDb` hook timeouts across ~16 files and is an environment failure, not a code one.
- **Files have mixed CRLF/LF line endings.** Content-based edits only.
- **The phone layout is on hold.** Do not build touch variants.
- **Nothing deploys.** The nginx gate stays parked.
- **Never render a status from a fetched copy.** Route it through `livePresence(id, fetchedStatus)` from `usePresence`. Three surfaces were stale for exactly that reason and were fixed today; a fourth would undo the point of the fix.

## Out of scope

- Server Settings — the user's explicit "then move to settings", i.e. after this.
- Roles. The member list groups by online/offline, not by role, until a role system exists.
- Timed statuses ("DND for 1 hour") — the user chose chevrons-look-only.
- Text chat under the voice stage — deferred by the user.

---

### Task 1: Server members as real state

**Files:**
- Modify: `src/composables/useServers.ts`, `src/composables/useApi.ts`, `src/composables/__tests__/useServers.test.ts`

**Interfaces:**
- Produces: `membersByServer`, `loadServerMembers(sid)`, `activeMembers` (the sorted, grouped view the panel renders), `upsertMember`, `removeMember`

- [x] **Step 1: Add the call**

`getServerMembers(sid)` in `useApi.ts`, returning `{ members: WireMember[] }`. Read `getServerMembers` in `server/controllers/serversController.ts` (around line 226) and mirror its exact shape — my API guesses have been wrong in most tasks of this project, so verify rather than trust the type I write here.

- [x] **Step 2: Write the failing tests**

Extend `useServers.test.ts`, and extend its `beforeEach` to reset the new state — module state no test can reset has already caused one real bug here.

Cover:
- members land per server and do not leak between servers
- `activeMembers` splits into online and offline, with the owner first among the online
- **offline means offline**: `status === 'offline'` groups down, everything else groups up
- a member whose live presence has changed since the fetch groups by the **live** value, not the fetched one — this is the whole reason `livePresence` exists
- `upsertMember` adds and updates in place without duplicating
- `removeMember` drops them
- removing a server drops its members
- `resetServers()` clears them

- [x] **Step 3: Implement, then typecheck, full suite, commit**

Grouping belongs in the composable, not the template — it is logic, it is testable, and a `v-for` with a filter expression inside it is where sort order goes to die.

---

### Task 2: Render the panel

**Files:**
- Modify: `src/views/ChatApp.vue`

- [x] **Step 1: Delete the stub and render real members**

Remove `const members: Member[] = []` and the computeds hanging off it. The panel renders `activeMembers` from Task 1: an `Online — n` section then an `Offline — n` section, offline dimmed, matching the group DM panel's existing markup so the two do not look like different apps.

Fetch on entering a server. `openServer` already fetches detail once and caches; members follow the same rule, and `server:memberJoined` / `server:memberLeft` keep the cache honest — both events already arrive and are currently near no-ops.

- [x] **Step 2: Label the toggle**

The members button has no label. Add "Show Member List" / "Hide Member List" to its tooltip, matching how the other icon buttons in this file are described.

- [x] **Step 3: A count that is true**

The header reads `Members {{ n }}`. Use the real number. Note `activeServer.memberCount` exists but is **not** kept current — `server:memberJoined`/`memberLeft` carry no count (verified during 3b), so derive it from the list you actually have rather than from a field nothing updates.

- [x] **Step 4: Typecheck, full suite, build, commit**

---

### Task 3: Voice activity in the rail and the sidebar

The user asked for all three, and "make it look better than Discord".

**Files:**
- Modify: `src/views/ChatApp.vue`

- [x] **Step 1: A speaker badge on the rail icon**

A server with anyone in any of its voice channels gets a small speaker mark on its rail icon. Derive it from `activeCalls` — the client already holds every `voice:<channelId>` room — plus `channelsByServer` to map a channel back to its server.

That mapping only exists for servers whose detail has been fetched. A server you have not opened this session has no channel list, so its badge cannot be derived. Say so in your report rather than fetching every server's detail on boot to make a badge work.

- [x] **Step 2: The sidebar header**

While you are in voice in the open server, the server-name header gains a speaker icon and the occupant avatars. Small — it sits in a 48px bar.

- [x] **Step 3: The rail hover preview**

Hovering a server with voice activity shows a small panel: the server name, the voice channel, and who is in it. The rail already has tooltips via `v-tip`; check whether that primitive can carry rich content before building a second floating-panel mechanism, and say what you found.

Do not let it fight the existing tooltip — one hover, one thing.

- [x] **Step 4: Typecheck, full suite, build, commit**

---

### Task 4: Chevrons on the status rows

**Files:**
- Modify: `src/components/profile/ProfilePopout.vue`

- [x] **Step 1**

Add a chevron to Idle, Do Not Disturb and Invisible, matching the reference. **Clicking still sets the status instantly** — the user chose the look without the duration submenus.

A chevron normally promises a submenu, and this one does not have one. That is a deliberate choice, not an oversight: write it as a comment so the next reader does not "fix" it by wiring an empty menu.

- [x] **Step 2: Typecheck, build, commit**

---

### Task 5: Browser verification

- [x] Every server shows a real member count and a real list, grouped online then offline, owner first.
- [x] Someone changing status moves between the groups live, without a reload.
- [x] A second account joining the server appears in the list without a reload.
- [x] The toggle is labelled.
- [x] A server with voice activity shows the rail badge; one without does not.
- [x] The sidebar header shows the speaker and occupants while you are in voice.
- [x] Hovering a server with voice activity shows the preview; hovering one without shows the ordinary tooltip.
- [x] The status rows have chevrons and still set instantly.
- [x] Console errors and any 4xx.

---

## Verified in the browser

Two accounts (`slicetest_a` owner, `slicetest_b`) against the dev stack, desktop viewport.

- Panel reads `Members 2`; `ONLINE — 1` / `OFFLINE — 1`, owner first, `Owner` tag rendered.
- **Both directions live, no reload.** `slicetest_b` connecting moved them Offline → Online and
  collapsed the empty Offline section; releasing the hold moved them back.
- Rail badge on the server with voice activity only; the two quiet servers stayed bare.
- Sidebar header carried the speaker and one occupant avatar while in voice.
- Hover: voice server → preview `Slice Test HQ / GENERAL / slicetest_a`, no tooltip; quiet
  server → tooltip `Join Race HQ`, no preview. One hover, one thing, in both directions.
- Status rows show a tick on the current status and chevrons on the other three.
- No 4xx and no application console errors.

Two notes on method, both of which cost time here:

- The pane had been left at a **374px viewport**, so the app was in `.shell.mobile` and the rail
  was `display:none`. Element queries still matched — hidden DOM answers `querySelector` — so a
  reading can look like a pass while nothing is on screen. The hover preview "failing" was
  actually its own zero-size guard firing correctly on a `display:none` rail item.
- The member-list update was read too early three times before this run. It was never broken;
  the settle window was too short. Read the clock before filing the defect.

## Carried forward

- **Server Settings** — next, by the user's instruction.
- **OS-level idle** (are you using your PC, is a game running) is impossible from a browser tab and belongs in the Electron shell via `powerMonitor.getSystemIdleTime()`.
- Text chat under the voice stage — deferred.
- The deploy gate: nginx needs `servers` and `invites` in its location alternation, and `/join/<code>` must fall through to the SPA index.
- `withServerLock` is per-process.
- Deleting a channel orphans its `Message` documents.
- `vite.config.ts` hardcodes `hmr.clientPort: 5173` while the dev config serves 8090.

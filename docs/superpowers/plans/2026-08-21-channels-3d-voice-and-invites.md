# Channels Plan 3d — Voice Channels and Invite Expiry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make voice channels real — click one, you are in it, and everyone in the server sees who else is. Plus finish the invite expiry choice the server has always accepted and the client has never sent.

**Architecture:** LiveKit already carries every DM and group call; a voice channel is a third room kind alongside them. The server mints a token for `voice:<channelId>` after checking the caller is a member of the channel's server and that the channel is actually a voice one, and the existing `call:join` / `call:leave` occupancy tracking learns the same kind. The client widens the same `'dm' | 'group'` union it already threads through `useVoice`, and the sidebar lists occupants under each voice channel.

**Tech Stack:** Express + Mongoose + Socket.IO + livekit-server-sdk on the server; Vue 3 `<script setup lang="ts">` + livekit-client on the client; vitest + supertest.

## Global Constraints

- **No new runtime or dev dependencies.** LiveKit is already wired end to end.
- **`npm run typecheck` must exit 0.** Baseline at `f64fd43` is genuinely zero errors.
- **All existing tests stay green.** Baseline is **275 passing across 23 files**. Run `npx vitest run` unfiltered before every commit. **Requires Docker/MongoDB** — a stopped daemon shows up as `connectDb` hook timeouts across ~16 files, which is an environment failure, not a code one. Docker has stopped twice unprompted during this project; if it is down, say so rather than reporting the failures as real.
- **No `.vue` imports in any test file** — vitest runs in node with no DOM.
- **Files have mixed CRLF/LF line endings.** Use content-based edits, never line-number edits.
- **The phone layout is on hold** (user, 2026-08-21). The spec calls for voice-join to be a bottom sheet on touch; **build the desktop instant-join only**. Do not add the touch variant, and do not spend effort making the sidebar work on a phone — `.shell.mobile .rail` is `display:none`, so servers are unreachable there anyway.
- **Nothing deploys.** Everything lands on `main`, unpushed. The nginx deploy gate stays open and parked.
- **Out of scope:** text inside voice channels (a voice channel is one thing — the spec names this), per-channel permissions, video or screenshare *initiated from* a channel row (the existing call surface already offers both once you are connected), the member list, Server Settings.

## Two traps this plan exists to avoid

**`broadcastCall` will silently corrupt if you give it a third prefix.** It currently branches on `room.startsWith('group:')` and *else assumes a DM*, parsing participants out of the room name with `room.slice(3).split('_')`. Hand it a channel room and that else-branch produces garbage user ids and quietly emits to nobody — no error, no log, just occupancy that never appears. It must become an explicit three-way branch, and the DM case must stay last.

**Do not name the LiveKit room `chan:<id>`.** That is already the Socket.IO room name carrying that channel's *text* traffic. The two namespaces are separate so it would technically work, and it would even be convenient — but a single identifier meaning two different things in one file is how the next person introduces a real bug. Use **`voice:<channelId>`** for LiveKit, and target occupancy broadcasts explicitly at the Socket.IO room `chan:<channelId>`, which every server member already joined at connect.

---

### Task 1: Mint a token for a voice channel

**Files:**
- Modify: `server/controllers/voiceController.ts`
- Create: `server/__tests__/voiceChannelToken.test.ts`

**Interfaces:**
- Produces: `roomFor(kind, convId, selfId)` accepting `'channel'`; `POST /voice/token` accepting `kind: 'channel'`

- [ ] **Step 1: Read what you are extending**

```bash
cat server/controllers/voiceController.ts
sed -n '49,66p' server/sockets/chatSocket.ts   # canAccessMessage's channel branch — the authorisation shape to mirror
```

`canAccessMessage` already resolves Channel → Server → members. Your check is the same, plus one extra condition.

- [ ] **Step 2: Write the failing tests**

Create `server/__tests__/voiceChannelToken.test.ts`, mirroring the harness in `server/__tests__/channels.test.ts`. Cover:

- a server member gets a token for a **voice** channel, and the response carries `token`, `url`, and `room`
- `room` is `voice:<channelId>` — assert the exact string, since the client derives the same name independently and a mismatch puts two people in different rooms while both think they are connected
- requesting a token for a **text** channel is refused with a clear 400 — a voice call in a text channel is not a thing
- a **non-member** of the server is refused
- a nonexistent channel id 404s, and a malformed one does not 500
- the existing `dm` and `group` kinds still work unchanged — add one case each, because you are editing the function that serves them

Decide the non-member status by reading what `loadServer`/`canAccessMessage` already do rather than inventing one, and say in your report which you matched and why. (Note `loadServer` answers 403 for a non-member, which an earlier plan's brief got wrong.)

- [ ] **Step 3: Run them, watch them fail, then implement**

Widen `roomFor`:

```ts
export const roomFor = (kind: 'dm' | 'group' | 'channel', convId: string, selfId: string) =>
  kind === 'channel' ? `voice:${convId}`
  : kind === 'group' ? `group:${convId}`
  : `dm:${dmConvId(selfId, convId)}`
```

In `getVoiceToken`, accept the third kind and add its membership branch. Two conditions, both required: the channel exists and is `type: 'voice'`, and the caller is a member of the server that owns it. Import `Channel` and `Server`.

- [ ] **Step 4: Full suite, typecheck, commit**

```bash
npm run typecheck && npx vitest run
```

```bash
git add server/controllers/voiceController.ts server/__tests__/voiceChannelToken.test.ts
git commit -m "feat(server): mint LiveKit tokens for voice channels"
```

---

### Task 2: Track and broadcast who is in a voice channel

**Files:**
- Modify: `server/sockets/chatSocket.ts`
- Create: `server/__tests__/voiceChannelPresence.test.ts`

**Interfaces:**
- Consumes: `roomFor`'s naming from Task 1 — the two must agree
- Produces: `call:join` / `call:leave` accepting `kind: 'channel'`; `call:state` reaching every member of the channel's server

- [ ] **Step 1: Read the machinery**

```bash
sed -n '515,560p' server/sockets/chatSocket.ts   # callRoom, broadcastCall, postCallSystem
sed -n '710,725p' server/sockets/chatSocket.ts   # the reconnect catch-up
```

- [ ] **Step 2: Write the failing tests**

Create `server/__tests__/voiceChannelPresence.test.ts`, mirroring `server/__tests__/channelSockets.test.ts`. Cover:

- A joins a voice channel; **B, a different member of the same server, receives `call:state`** naming A
- a user who is **not** a member of that server receives nothing
- A leaves; members receive `call:state` with A removed
- two members join; both appear, and each sees the other
- A disconnects without leaving cleanly; the occupancy clears (find how the existing disconnect handler does this for DM/group rooms and assert the channel case the same way)
- **a reconnecting member is told about a call already in progress** — this is the catch-up loop at the bottom of the connect handler, and it has a `belongs` check that only understands `group:` and `dm:` today
- **no system message is created** for a channel call. There is no text history in a voice channel, and `postCallSystem` would write a `Message` whose `conversationId` is a voice channel nobody can read. Assert the `Message` count is unchanged.

For the socket tests, note the harness's `nextEvent` rejects after 3000ms, so a missing event fails rather than hangs.

- [ ] **Step 3: Implement**

`callRoom` gains the channel case and must produce **exactly** what `roomFor` produces — they are two copies of one naming rule, and the existing comment already says "Room names mirror voiceController". Keep that true.

`broadcastCall` becomes an explicit three-way branch:

```ts
    const broadcastCall = (room: string) => {
      const userIds = [...(activeCalls.get(room) ?? [])]
      const payload = { room, userIds }
      if (room.startsWith('voice:')) {
        // Occupancy is server-wide news: everyone should see who is sitting in
        // a voice channel without being in it. Every member joined the socket
        // room `chan:<id>` for this channel at connect, so it is exactly the
        // right audience — note that is the SOCKET room, deliberately named
        // differently from this LiveKit room.
        io.to(`chan:${room.slice(6)}`).emit('call:state', payload)
      } else if (room.startsWith('group:')) {
        io.to(room).emit('call:state', payload)
      } else {
        // DM last, because this branch PARSES the room name and would happily
        // produce nonsense from any prefix it does not recognise.
        const [a, b] = room.slice(3).split('_')
        io.to(`user:${a}`).to(`user:${b}`).emit('call:state', payload)
      }
    }
```

Guard `postCallSystem` so it never runs for a channel.

Extend the reconnect catch-up's `belongs` check with a channel case: the room belongs to you if you are a member of the server that owns that channel. You already have `myServers` in scope there (it is fetched for the `chan:` room joins) — use it rather than a new query.

- [ ] **Step 4: Full suite, typecheck, commit**

---

### Task 3: Client — a third voice kind

**Files:**
- Modify: `src/composables/useVoice.ts`, `src/composables/useSocket.ts`, `src/composables/useApi.ts`
- Create: `src/composables/__tests__/voiceRoomName.test.ts`

- [ ] **Step 1: Widen the union everywhere it appears**

`'dm' | 'group'` is threaded through several signatures. Find every one and widen it:

```bash
grep -rn "'dm' | 'group'" src/
```

`voiceRoomName` (`useVoice.ts:174`) must produce the same string the server does. It is the second copy of the naming rule and the reason a test is worth writing for a three-line function:

```ts
export const voiceRoomName = (kind: 'dm' | 'group' | 'channel', convId: string, myId: string) =>
  kind === 'channel' ? `voice:${convId}`
  : kind === 'group' ? `group:${convId}`
  : `dm:${[myId, convId].sort().join('_')}`
```

- [ ] **Step 2: Test it**

Create `src/composables/__tests__/voiceRoomName.test.ts`. Pin all three kinds, and pin that the DM form is order-independent (both participants must derive the same room). Add a comment naming `roomFor` in `server/controllers/voiceController.ts` as the other copy, so whoever changes one finds the other.

- [ ] **Step 3: Typecheck, full suite, commit**

---

### Task 4: Join a voice channel, and see who is in it

**Files:**
- Modify: `src/views/ChatApp.vue`

- [ ] **Step 1: Make the row joinable**

Voice channel rows currently render inert (Task 4 of plan 3c left them with a context menu but no click handler). Clicking one connects, on desktop, immediately — no confirmation, no modal. That is what the spec means by instant join, and it matches every other client.

Read how a DM or group call is started in this file and reuse that path with the new kind; do not write a second connect flow. Clicking the voice channel you are already in should not reconnect — check what `connect()` already does about that before adding your own guard.

Joining a voice channel does **not** change which text channel is open. They are independent: people sit in voice while reading a text channel. Do not touch `activeChannelId`.

- [ ] **Step 2: List occupants under the channel**

`call:state` arrives with `{ room, userIds }`. For a `voice:<channelId>` room, render those users under that channel's row, indented — avatar plus display name.

The reference screenshots show **two densities**: avatar + name in one, avatar-only in another. Build the named variant; note the other in your report as a later option rather than guessing at a trigger for it.

You need names and avatars for the ids. Check what the client already has before fetching anything: `usePresence`, the friends list, and cached message authors are all possible sources, and a member list does not exist yet. If some ids cannot be resolved, render the generated default avatar (`avatarFor`) rather than dropping the person — an unresolvable occupant is still an occupant, and a missing one makes the channel look empty when it is not.

- [ ] **Step 3: Check the existing Voice Connected panel**

The panel above the user panel already shows the current call for DMs and groups. Verify it renders sensibly for a channel — it names the conversation, so it needs a channel name and its server. Fix what is wrong; do not rebuild it.

- [ ] **Step 4: Typecheck, full suite, build, commit**

---

### Task 5: The invite expiry choice

Small, and the last half-built thing in the invite flow. The server has always accepted `expiry` — `expiryFor` in `invitesController.ts` maps `'never'` and `'7d'`, defaulting to 24h — and the modal already *displays* each invite's expiry. The client just never sends a choice, so every invite silently gets 24 hours.

**Files:**
- Modify: `src/composables/useApi.ts`, `src/components/modals/InviteServerModal.vue`
- Modify: `server/__tests__/invites.test.ts`

- [ ] **Step 1: Confirm the server's contract**

```bash
grep -n "expiryFor" -B 2 -A 4 server/controllers/invitesController.ts
```

Read exactly which strings it accepts and what an unrecognised value does. Then check whether `invites.test.ts` already covers the three choices; if it only covers the default, add the missing cases — the client is about to depend on all three.

- [ ] **Step 2: Send the choice**

`createServerInvite(sid)` gains an expiry argument. Give it a default that preserves today's behaviour so nothing changes for a caller that does not pass one.

- [ ] **Step 3: Offer it in the modal**

Add a three-way choice — 24 hours / 7 days / never — beside the Create Invite Link button. Default to 24 hours, matching what the server does today.

Match the modal's existing controls; `CreateChannelModal`'s text/voice type toggle is the closest sibling and already solves "pick one of a small set" in this codebase's visual language.

The active invite list already shows expiry per row, so a link minted as "never" should visibly differ there — check that it does rather than assuming, since `expiryLabel` was written when everything was 24h.

- [ ] **Step 4: Typecheck, full suite, build, commit**

---

### Task 6: Browser verification

The gate for Tasks 4 and 5.

**Environment:** MongoDB up. `skycord-api` on **8990** (must match `API_PORT` in `.env` or every call 404s through the Vite proxy) and `skycord-dev` on 8090. Accounts `slicetest_a` / `slicetest_b`, password `SliceTest!2026`. If the Browser pane is not displayed, screenshots and real input are unavailable — drive the DOM with dispatched events, which do reach Vue handlers including modifier guards.

Voice needs two real participants, and the in-app browser shares one cookie jar, so a second tab is silently the same user. Use the Chrome MCP for client B if it is connected; otherwise drive B with a node LiveKit client, and say plainly in the report which half you could not observe.

1. Click a voice channel. Expect: connected, the Voice Connected panel appears naming the channel and server, and **the text channel you were reading stays open**.
2. Your own avatar appears under that voice channel in the sidebar.
3. From B, join the same channel. Expect both occupants under it, on both clients.
4. B leaves. Expect B to disappear from A's sidebar without a reload.
5. A disconnects abruptly (close the tab). Expect A to clear from B's sidebar.
6. Reload while a call is in progress in a channel you are not in. Expect the occupants to be there on load — that is the reconnect catch-up.
7. A non-member must never see the occupancy. Hardest to check live; if you cannot, say so.
8. Confirm **no system message** appears anywhere from a channel call.
9. Mint an invite with each of the three expiries. Expect the active-links list to show three visibly different expiries, and "never" not to read as a date in 1970 or "Invalid Date".
10. Console errors and any 4xx.

---

## Deploy gate — parked, still required

Not urgent: the user has said nothing deploys until channels is finished. But before anything ships, `/etc/nginx/sites-available/skycord` needs `servers` and `invites` in its location alternation, and `/join/<code>` must fall through to the SPA index like `/theme/<slug>` does.

## Carried forward

- **Member list** is still `const members: Member[] = []`. The reference server has 164 offline of 180, so the real one needs role grouping, counts, and virtualising.
- **Phone layout** — on hold by the user's instruction.
- `role="button"` on `.ch-item` containing a real `<button>` is ARIA children-presentational; the clean shape is a plain div row with the label wrapped in the button and `.ch-more` as its sibling.
- `withServerLock` is per-process; scaling past one API process needs a distributed lock.
- Deleting a channel orphans its `Message` documents.
- `vite.config.ts` hardcodes `hmr.clientPort: 5173` while the dev launch config serves 8090, so HMR dials a dead port.
- Presence events have no ordering guarantee — a rapid disconnect/reconnect can deliver `offline` after `online`.
- Invites are owner-only; Discord makes this a per-role permission.

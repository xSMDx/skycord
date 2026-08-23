# Channels Plan 3e — The Voice Channel Stage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a voice channel look like a place you are, not a 117-pixel strip wedged above someone else's conversation.

**Architecture:** Almost everything needed already exists and is used by DM and group calls — `CallStage` renders the tile grid, `useVoice` already tracks `speaking` per participant, `CallStage` already has a `.speaking` class, and `callExpanded` already implements hide-chat. What is missing is the *mode*: a voice channel has no text conversation of its own, so the stage should own the pane while you are looking at that channel, and shrink to a bar only once you navigate to a text channel.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, LiveKit via the existing `useVoice`.

## What is actually wrong

Measured in the running app, connected to a voice channel:

```
stage size          463 × 117      ← a strip
chat.call-expanded  false          ← hide-chat off
messages visible    true           ← the TEXT channel's messages
composer visible    true           ← "Message #general"
```

So joining a voice channel leaves you reading `#general` with a squashed call stage above it. The reference (Discord pics 1-2, Stoat pics 6-7) shows the stage owning the pane.

## Global Constraints

- **No new runtime or dev dependencies.**
- **`npm run typecheck` must exit 0.** Baseline at `f6006d3` is zero errors.
- **All existing tests stay green.** Baseline **311 across 27 files**. Run `npx vitest run` unfiltered before every commit. Requires Docker/MongoDB; a stopped daemon shows as `connectDb` hook timeouts across ~16 files and is an environment failure, not a code one.
- **Files have mixed CRLF/LF line endings.** Content-based edits only.
- **The phone layout is on hold** (user, 2026-08-21). Do not build touch variants.
- **Nothing deploys.** The nginx gate stays parked.

## Out of scope, named so it cannot be absorbed

- **Text chat inside a voice channel.** The user wants Stoat's chat-under-the-stage and has explicitly deferred it: *"stage only for now, chat later."* It reverses the spec's locked "text inside voice channels is out of scope" and needs a conversation id, message history and a composer for a voice channel. If a task starts to need it, stop and report.
- Server Settings and drag-to-reorder — those are plan 3f.
- Roles and per-channel permissions.
- The presence/status bugs — separate work, tracked in the ledger.

---

### Task 1: Viewing a voice channel is a mode

Clicking a voice channel currently joins it and deliberately leaves the open text channel alone — plan 3d made that choice on purpose, because people sit in voice while reading elsewhere. That is still right. What is missing is the other half: while you are *looking at* the voice channel, it should own the pane.

So this needs a third piece of state. **Do not repurpose `activeChannelId`** — it means "the text channel whose messages are on screen", and overloading it makes leaving voice ambiguous.

**Files:**
- Modify: `src/composables/useServers.ts` (the viewed-voice state and its tests)
- Modify: `src/composables/__tests__/useServers.test.ts`

**Interfaces:**
- Produces: `viewedVoiceId` (ref), `viewVoiceChannel(id)`, and the rule that opening a text channel clears it

- [ ] **Step 1: Write the failing tests**

Add to `src/composables/__tests__/useServers.test.ts`, extending the existing `beforeEach` to reset the new state (module-level state that no test can reset has already caused one real bug in this project — do not reintroduce it):

- `viewVoiceChannel(id)` sets `viewedVoiceId` and leaves `activeChannelId` untouched
- `openChannel(textId)` clears `viewedVoiceId` — opening a text channel means you are looking at text now
- `selectLanding` clears it too, since entering a server lands you on a text channel
- switching to another server clears it
- `removeChannel` on the viewed voice channel clears it — you cannot be looking at a channel that no longer exists
- `resetServers()` clears it

- [ ] **Step 2: Run them, watch them fail, then implement**

A module-level `ref<string | null>(null)` beside the others, exposed from `useServers()`, cleared everywhere the list above says. Comment why it is separate from `activeChannelId` — the next reader will otherwise try to merge them.

- [ ] **Step 3: Typecheck, full suite, commit**

---

### Task 2: The stage owns the pane

**Files:**
- Modify: `src/views/ChatApp.vue`

- [ ] **Step 1: Render the stage instead of the chat when a voice channel is being viewed**

While `viewedVoiceId` is set, the chat column shows the call stage full-height, with the voice channel's name as the header — not the text channel's messages, and not its composer. Measured today the stage is 463×117 inside a chat column that is still rendering `#general`; it should be the pane.

The existing `callExpanded` flag already implements "the call fills the chat column" for DM and group calls. Reuse it — read how `.chat.call-expanded` works before adding a second mechanism. The difference for a voice channel is that the mode is not a toggle the user opts into: there is no text conversation to go back to, so it is simply on.

Consequently the expand/collapse control that DM and group calls offer should not appear for a voice channel — a button whose only outcome is to reveal an empty conversation is worse than no button. Check what `CallBar` emits for that control and hide it for `kind === 'channel'`.

- [ ] **Step 2: Wire the two modes**

- Click a voice channel → join **and** view it (stage owns the pane).
- Click a text channel while connected → `viewedVoiceId` clears, the text channel renders normally, and the call bar sits above it exactly as it does for a DM or group call today. Still connected, still in the channel.
- Click the voice channel you are already in → view it again. Do not reconnect; `connect()` already guards on that, so check what it does before adding your own.

- [ ] **Step 3: Leaving**

Leaving the call while viewing it must land somewhere real — the server's landing text channel, the same one entering the server picks. Do not leave the user on an empty pane titled after a channel they are no longer in.

- [ ] **Step 4: Typecheck, full suite, build, commit**

---

### Task 3: The talking indicator

`useVoice` already tracks `speaking` per participant — a local analyser with a 250ms hangover, and LiveKit's `isSpeaking` for remotes. `CallStage` already puts a `.speaking` class on `.s-av`. So the data and the hook exist; this task is making it read as an indicator.

**Files:**
- Modify: `src/components/voice/CallStage.vue`
- Modify: `src/views/ChatApp.vue` (the sidebar occupant rows)

- [ ] **Step 1: Check what `.speaking` currently renders**

```bash
grep -n "\.s-av" -A 12 src/components/voice/CallStage.vue | grep -A 12 "speaking"
```

Look at the actual CSS before changing it. If there is already a ring and it is simply too subtle, strengthen it rather than adding a second treatment. The reference screenshots show a clear coloured ring around the speaking participant's avatar.

- [ ] **Step 2: Put the indicator on the sidebar occupants too**

The reference (Stoat, pic 7 — the user drew an arrow at it) shows the indicator on the occupant rows under the channel, not only on the stage tiles. Those rows are `.vc-occ` in `ChatApp.vue`, built from `voiceOccupants()`.

This needs speaking state for people whose tiles are not on screen. `useVoice.participants` carries `speaking` for everyone in the room you are in — use it, and note in your report that occupants of a voice channel you are *not* in cannot have a speaking state, because nothing subscribes to their audio. An occupant you cannot know about must render as not-speaking, never as unknown or missing.

- [ ] **Step 3: Respect reduced motion**

If the indicator animates, gate it behind `prefers-reduced-motion` the way the rest of the app does — check how, and match it.

- [ ] **Step 4: Typecheck, full suite, build, commit**

---

### Task 4: Browser verification

Two participants, and this one genuinely needs eyes.

**Environment:** MongoDB up. `skycord-api` on **8990** (must match `API_PORT`), `skycord-dev` on 8090. Accounts `slicetest_a` / `slicetest_b`, password `SliceTest!2026`.

**The pane blocks microphone access**, so the speaking indicator cannot be driven by a real voice in the in-app browser. Either use the Chrome MCP, or drive `speaking` directly in the page to verify the rendering, and say plainly which you did — an indicator verified only by forcing the flag is a verified *style*, not a verified *feature*.

1. Click a voice channel: the stage fills the pane, headed by the voice channel's name. No text messages, no composer, no expand button.
2. Click a text channel: the stage shrinks to the bar above that channel's messages, still connected.
3. Click back to the voice channel: full again, no reconnect (watch the network tab for a second token request that should not happen).
4. Leave the call while viewing it: land on a real text channel, not an empty pane.
5. Two clients in the channel: both tiles present, and the speaking one is unmistakable at a glance.
6. The sidebar occupant rows show the indicator too.
7. Console errors and any 4xx.

---

## Carried forward

- **Chat under the voice stage** (Stoat-style) — wanted, deliberately deferred.
- Server Settings and drag-to-reorder — plan 3f.
- Statuses do not update in groups; the presence/status UI wants an overhaul.
- The deploy gate: nginx needs `servers` and `invites` in its location alternation, and `/join/<code>` must fall through to the SPA index.
- `withServerLock` is per-process; scaling past one API process needs a distributed lock.
- Deleting a channel orphans its `Message` documents.
- `vite.config.ts` hardcodes `hmr.clientPort: 5173` while the dev launch config serves 8090.

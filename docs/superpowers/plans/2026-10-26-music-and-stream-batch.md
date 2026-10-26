# Music and Screen-Share Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-select (queue or delete), multi-upload with rate-limit back-off, a reorderable queue, pause for call music, no automatic tuning into call music, join-to-watch screen shares, and a per-person stream volume.

**Architecture:**
- One pure subscription policy decides every LiveKit subscription after connecting with `autoSubscribe: false`. That fixes the auto-tune race and makes "not loaded until Join" true.
- Screen-share audio gets its own element and its own stored volume.
- Pause is a server state with music-service support, behind a `pausable` capability.
- The library features are client-side modules (a selection model, an upload scheduler, `moveManual`) under thin UI.

**Tech Stack:**
- Web: Vue 3 + TypeScript, livekit-client, Vitest (`environment: 'node'`; components are tested from source per the repo precedent).
- Server: Express + Socket.IO + Vitest.
- The music service in `music/` (Node).

**Spec:** `docs/superpowers/specs/2026-10-26-music-and-stream-batch-design.md` (binding, especially "Decided by me" 1–18).

## Global Constraints

- **Branch and commits:** branch `android-shell`. Commit with pathspecs: never `git add -A`, never push. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Exact copy:**
  - "Select", "N selected", "Add to your queue", "Delete", "Remove from playlist", "Cancel"
  - "Delete N songs? This can't be undone."
  - "Waiting for the upload limit…"
  - "Too many uploads — wait a moment"
  - "Join stream", "Leave stream", "Stream Volume"
  - "Pause", "Resume", "Paused"
- **Ranges:**
  - Stream Volume runs 0–100, default 100.
  - User Volume keeps 0–200, unless Task 3 proves amplification cannot keep the output device; then it caps at 100 and says so.
- **Compatibility:**
  - Older clients must work against the new server: new socket events and fields are additive.
  - The new client must work against an older server: Pause is hidden without `pausable`.
  - The new server must work against an older music service: no `pausable` is sent.
- **Touch and styling:**
  - Targets are ≥ 44 × 44 px on touch.
  - Use existing tokens only; no hex. The guards in `src/styles/__tests__/` must stay green.
  - Icons come from lucide-vue-next only.
  - Honour `prefers-reduced-motion`.
- **UI tasks:** load the design skills `impeccable` (primary), `apple-design` and `emil-design-eng` before building, and report what they changed.
- **Never** put the Iran instance address in copy, docs, changelog or commits.
- **Verification commands:**
  - `npx vitest run src/`
  - `npm run typecheck`
  - the server tests (`npx vitest run server/`), with the CI env vars. They are listed in `.github/workflows/ci.yml`, and the memory notes say the local `.env` lacks them.
  - the music service tests, if `music/` has them.

## Review Focus

1. **Voice still works after `autoSubscribe: false`.**
   - Cases: two people hear each other; someone who joins after you is heard; a reconnect is heard; a camera turned on later is seen.
   → Task 1: policy tests, plus the room-event wiring test.
2. **A screen share that stops and starts again** asks to be joined again. A sharer leaving removes their stream audio element, and no tile is left behind.
   → Task 2.
3. **Twenty-five files with a 20-per-minute limit:** the batch waits and finishes. A file that is too big (413) fails alone, and the rest continue.
   → Task 8.
4. **Bulk-deleting a song that is playing or queued** removes it from the queue, as single delete does. Changing the search mid-selection never deletes rows that are no longer shown or selected.
   → Task 9.
5. **Someone joins while the music is paused:** they see Paused and a frozen time. Resume continues from the paused point, not from the start.
   → Tasks 5 and 6.

---

### Task 1: Subscription policy, `autoSubscribe: false` (fixes auto-tune)

**Files:**
- Create: `src/composables/subscriptionPolicy.ts`, `src/composables/__tests__/subscriptionPolicy.test.ts`
- Modify: `src/composables/useVoice.ts`:
  - the Room connect (around line 949–954);
  - TrackPublished, Connected and ParticipantConnected (around lines 618–640);
  - `syncMusicSubscriptions` (around line 500), which this replaces.
- Test: `src/composables/__tests__/voiceSubscriptions.test.ts` (mock Room, in the style of `voiceRoomLifecycle.test.ts`)

**Interfaces:**
- Produces:
  - `export type PubKind = 'mic' | 'camera' | 'screen' | 'screen-audio' | 'music'`
  - `kindOf(pub: { source: Track.Source; trackName?: string }, identity: string): PubKind`
  - `shouldSubscribe(kind: PubKind, ctx: { identity: string; trackName?: string; listeningTo: string | null; joinedStreams: ReadonlySet<string> }): boolean`
  - `applySubscriptions(room: Room, ctx): void`, which sweeps every remote publication and sets subscribed to the policy.
  - `joinedStreams`: a reactive `Set<string>` of participant identities, exported from `useVoice.ts` for Task 2. It is cleared on leave.

- [ ] **Step 1:** Write the failing tests.
  - Policy:
    - `mic is always subscribed`
    - `camera is always subscribed`
    - `music only for the channel you are tuned into`
    - `a screen and its audio only after Join stream`
    - `the music bot's tracks are music whatever their source`
  - Wiring:
    - `connects with autoSubscribe false`
    - `on Connected, existing mic/camera are subscribed and an existing music track is not`
    - `a later TrackPublished mic is subscribed`
    - `tuning in subscribes that music track and drops the others`
    - `joining a call with music playing hears nothing until Listen (no subscribe ever sent for it)`
- [ ] **Step 2:** Run `npx vitest run src/composables/__tests__/subscriptionPolicy.test.ts src/composables/__tests__/voiceSubscriptions.test.ts`. Expect: FAIL.
- [ ] **Step 3:** Implement.
  - Connect with `r.connect(url, token, { autoSubscribe: false })`.
  - Call `applySubscriptions` on Connected, on TrackPublished, on ParticipantConnected, and in watches on `music.listeningTo` and `joinedStreams`.
  - Delete `syncMusicSubscriptions` and the music-only TrackPublished handler, and replace the comments that explained the old window.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS (`voiceRejoin` and `voiceRoomLifecycle` included).
- [ ] **Step 5:** Commit: "Voice: one subscription policy, nothing downloaded you didn't choose — and no song you didn't tune into".

### Task 2: Join stream, independent stream audio, Stream Volume (desktop)

**Files:**
- Modify:
  - `src/composables/useVoice.ts`: `attachTrack` routes ScreenShareAudio to a stream element; `UserAudioPref` gains `streamVolume`; `joinStream` / `leaveStream`.
  - `src/composables/useVoiceMedia.ts`: `media.streamsAvailable`, the identities with a screen publication.
  - `src/components/voice/CallStage.vue`: the not-joined tile and Join stream, and Leave stream once joined.
  - `src/composables/contextMenus/callMenu.ts` and `voiceOccupantMenu.ts`: the Stream Volume slider.
- Test:
  - `src/composables/__tests__/streamAudio.test.ts`
  - extend the existing callMenu and voiceOccupantMenu tests, if present
  - `src/components/voice/__tests__/callStageStreamSource.test.ts`

**Interfaces:**
- Consumes: `joinedStreams` and `applySubscriptions` (Task 1).
- Produces:
  - `joinStream(identity: string): void` and `leaveStream(identity: string): void` (exported from `useVoice.ts`)
  - `media.streamsAvailable: Set<string>`
  - `UserAudioPref.streamVolume: number` (0–100, default 100)
  - `setStreamVolume(identity: string, v: number): void`
  - `streamVolumeOf(identity): number`

- [ ] **Step 1:** Write the failing tests.
  - `screen audio uses streamVolume, not User Volume`
  - `local Mute silences the voice but not the stream`
  - `deafen silences the stream`
  - `a share that stops clears its joined state; a new share asks again`
  - `a sharer leaving removes the stream element`
  - `the menu shows Stream Volume only while that person shares a screen with audio`
  - `CallStage shows Join stream for a not-joined share and no video element for it`
- [ ] **Step 2:** Run the covering tests. Expect: FAIL.
- [ ] **Step 3:** Implement. Load the design skills before touching CallStage.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS.
- [ ] **Step 5:** Commit: "Screen share: join a stream to load it, with its own volume".

### Task 3: User Volume above 100 %

**Files:**
- Modify: `src/composables/useVoice.ts` (`applyAudioEl`, around line 401)
- Create: `src/composables/remoteGain.ts`, `src/composables/__tests__/remoteGain.test.ts`

**Interfaces:**
- Produces: `volumePlan(outputPct: number, userPct: number, canRouteSink: boolean): { elVolume: number; gain: number }`
  - `elVolume` is always in 0..1.
  - `gain` is ≥ 1 only when amplification is possible.

- [ ] **Step 1:** Reproduce.
  - Write `applyAudioEl at 150 % does not throw` in a unit test with a fake element whose `volume` setter throws above 1, mirroring the DOM.
  - Record the result in the report.
- [ ] **Step 2:** Write the failing tests:
  - `≤100 % uses the element volume only`
  - `150 % with sink routing → elVolume 1, gain 1.5`
  - `150 % without sink routing → elVolume 1, gain 1, and capped flag`
- [ ] **Step 3:** Implement.
  - Use one shared `AudioContext`: `createMediaElementSource(el)` → `GainNode` → destination.
  - Use `AudioContext.setSinkId` for the chosen output where supported.
  - Otherwise cap at 100 % and expose `userVolumeMax` (200 or 100), which the menus use for their slider max.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS.
- [ ] **Step 5:** Commit: "Voice: User Volume above 100 % amplifies instead of throwing".

### Task 4: Phone — Join stream on the stage, and a person sheet

**Files:**
- Create: `src/components/voice/phone/PhonePersonSheet.vue`
- Modify:
  - `src/components/voice/phone/PhoneStage.vue` (a not-joined screen focus shows the sharer tile and Join stream)
  - `PhoneCallSheet.vue` (people rows open the person sheet)
  - `CallBar.vue` (mount the person sheet)
- Test: `src/components/voice/__tests__/phonePersonSheetSource.test.ts`

**Interfaces:**
- Consumes:
  - `joinStream`, `leaveStream`, `setStreamVolume` and `media.streamsAvailable` (Task 2)
  - `setUserPref` and `userVolumeMax` (Task 3)
  - the phone call screen components, which come from the phone call screen plan, Tasks 5–8, and must be complete first
- Produces: `PhonePersonSheet` props `{ open: boolean; person: { id; name; avatar } | null }` and event `close`. It contains:
  - a User Volume slider;
  - a Stream Volume slider, only while that person shares a screen with audio;
  - Mute, as a ≥ 44 px switch.

- [ ] **Step 1:** Write the failing source tests:
  - `uses BottomSheet`
  - `Stream Volume only while sharing with audio`
  - `people rows open it`
  - `the stage shows Join stream for a not-joined share`
  - `the joined stream tile's long-press opens it`
- [ ] **Step 2:** Run them. Expect: FAIL.
- [ ] **Step 3:** Implement. Load the design skills first.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS.
- [ ] **Step 5:** Commit: "Phone call screen: join a stream, and a person sheet with voice and stream volume".

### Task 5: Pause and resume on the server and in the music service

**Files:**
- Modify:
  - `server/sockets/musicState.ts`: `pausedAt`; `pause` and `resume`; skip, previous and playNow clear the pause; seek keeps it; the view carries `paused` and `pausable`.
  - `server/sockets/chatSocket.ts`: `music:pause` and `music:resume`, rate-limited like `music:seek`, around lines 1625–1680.
  - `server/utils/musicService.ts`: `post('/pause')` and `post('/resume')`, plus a capability probe.
  - `music/src/server.ts` (the `/pause` and `/resume` routes) and `music/src/publisher.ts` (stop and restart frames at the held position).
- Test: `server/__tests__/musicState.test.ts` and `musicSockets.test.ts` (extend), and the music service tests if present.

**Interfaces:**
- Produces:
  - Socket events `music:pause` / `music:resume` with `{ conversationId, kind, channelId }`.
  - The `MusicChannelView` gains `paused?: boolean` and `pausable?: boolean`.
  - While paused, `elapsedMs` is the frozen position.
  - The service: `POST /pause {room, channelId}` and `POST /resume {room, channelId}` answer 200 when done. A capability (e.g. `GET /capabilities → { pause: true }`) tells the server whether to send `pausable`.

- [ ] **Step 1:** Write the failing tests:
  - `pause freezes elapsed`
  - `resume continues from the frozen point`
  - `skip while paused plays the next song unpaused`
  - `seek while paused stays paused at the new point`
  - `a refused service call refuses the pause and broadcasts nothing`
  - `an older service (no capability) → no pausable in the view`
  - `pause is rate-limited like seek`
  - `a late joiner gets paused:true and the frozen elapsed`
- [ ] **Step 2:** Run `npx vitest run server/__tests__/musicState.test.ts server/__tests__/musicSockets.test.ts`, with the CI env vars. Expect: FAIL.
- [ ] **Step 3:** Implement the server side and the service side.
- [ ] **Step 4:** Run the server suite and the music service tests. Expect: PASS.
- [ ] **Step 5:** Commit: "Music: a call's song can be paused for everyone, if the music service can".

### Task 6: Pause in every music surface, and the chat commands

**Files:**
- Modify:
  - `src/composables/useMusic.ts`: `pauseMusic` / `resumeMusic`; `channelElapsed` honours `paused`.
  - `src/composables/callMusic.ts`
  - `MusicFlyout.vue` and `PhoneMusicSheet.vue`
  - `MusicModal.vue` (the channel band)
  - `MiniPlayer.vue` and `MusicCallRail.vue` (wherever skip is offered)
  - `MessageInput.vue`: `/pause` and `/resume` pause the tuned-into channel.
- Test: extend `musicClient.test.ts` and `callMusic.test.ts`, plus source tests per surface.

**Interfaces:**
- Consumes: Task 5's events and view fields.
- Produces:
  - `pauseMusic(channelId: string): void` and `resumeMusic(channelId: string): void`
  - `isPaused(c: MusicChannelView): boolean`

- [ ] **Step 1:** Write the failing tests:
  - `pause emits music:pause`
  - `elapsed stops while paused`
  - `controls hidden without pausable`
  - `/pause pauses the tuned channel and refuses when not tuned`
- [ ] **Step 2:** Run them. Expect: FAIL.
- [ ] **Step 3:** Implement. Load the design skills.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS.
- [ ] **Step 5:** Commit: "Music: Pause and Resume wherever a call's song can be skipped".

### Task 7: Reorder the queue

**Files:**
- Modify:
  - `src/composables/musicQueue.ts`: add `moveManual`.
  - `src/composables/useMusicPlayer.ts`: add `moveInQueue`.
  - `src/components/music/MusicModal.vue`: the queue rows (around line 606) get a drag handle on the left.
- Test: `src/composables/__tests__/musicQueue.test.ts` (extend) and `src/components/music/__tests__/queueReorderSource.test.ts`

**Interfaces:**
- Produces:
  - `moveManual<T>(s: QueueState<T>, from: number, to: number): QueueState<T>`, which clamps and is a no-op for `from === to`.
  - `moveInQueue(from: number, to: number): void`

- [ ] **Step 1:** Write the failing tests.
  - `moveManual moves up and down`
  - `moveManual clamps out-of-range targets`
  - `moveManual leaves the playlist part alone`
  - A source test asserting:
    - the handle is the first control in the row;
    - the handle uses pointer capture;
    - ArrowUp/ArrowDown on the handle call `moveInQueue`;
    - the handle is ≥ 44 px under `(pointer: coarse)`.
- [ ] **Step 2:** Run them. Expect: FAIL.
- [ ] **Step 3:** Implement. Load the design skills. Auto-scroll near the list edges while dragging, and keep the drag from scrolling the list.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS.
- [ ] **Step 5:** Commit: "Music: drag a song up or down the queue".

### Task 8: Multi-upload

**Files:**
- Modify:
  - `src/composables/useMusicLibrary.ts`:
    - an upload queue, with `uploads` (reactive list), `enqueueUploads(files: File[])` and `dropUpload(id)`;
    - the scheduler;
    - `uploadTrack` returns the status and headers on failure.
  - `src/components/music/MusicModal.vue`: the file input gets `multiple`, drop accepts several files, and the upload list renders.
  - `server/middleware/rateLimit.ts`: a music limiter with "Too many uploads — wait a moment". Keep the profile limiter's message for profile routes if they share it; check usages.
  - `server/routes/music.ts`.
- Create: `src/composables/uploadScheduler.ts` (pure: the next action given the state, a 429 and its headers) and `src/composables/__tests__/uploadScheduler.test.ts`

**Interfaces:**
- Produces:
  - `type UploadItem = { id: string; name: string; state: 'waiting' | 'uploading' | 'converting' | 'done' | 'failed' | 'limited'; pct: number; error?: string }`
  - `enqueueUploads(files: File[]): void`
  - `retryAfterMs(headers: Record<string, string | undefined>, now: number): number`, which falls back to 60 000.

- [ ] **Step 1:** Write the failing tests:
  - `files upload one after another`
  - `a failure moves on to the next`
  - `a 429 waits Retry-After then retries the same file`
  - `RateLimit-Reset is honoured`
  - `no header → 60 s`
  - `a dropped waiting file is skipped`
  - `25 files under 20/min finish`, with fake timers
  - A server test: `music upload limiter says "Too many uploads — wait a moment"`.
- [ ] **Step 2:** Run them. Expect: FAIL.
- [ ] **Step 3:** Implement. Load the design skills for the list.
- [ ] **Step 4:** Run `npx vitest run src/`, `npm run typecheck`, and the server suite. Expect: PASS.
- [ ] **Step 5:** Commit: "Music: upload several files at once, and wait out the limit instead of failing".

### Task 9: Multi-select

**Files:**
- Create: `src/composables/selectionModel.ts` (pure), `src/composables/__tests__/selectionModel.test.ts`, `src/components/music/LibrarySelectionBar.vue`
- Modify: `src/components/music/MusicModal.vue`:
  - the Select button;
  - row checkboxes, plus Shift and Ctrl/Cmd clicks;
  - long-press on a phone;
  - the bar;
  - the confirmation;
  - sequential delete with progress.
- Test: `src/components/music/__tests__/librarySelectionSource.test.ts`

**Interfaces:**
- Produces:
  - `createSelection(): { ids: Set<string>; anchor: string | null }`
  - `toggle(sel, id)`
  - `range(sel, orderedIds: string[], id)`
  - `retainVisible(sel, visibleIds)`, which drops ids no longer shown
  - `clear(sel)`

- [ ] **Step 1:** Write the failing tests:
  - `toggle adds and removes`
  - `range selects between anchor and id in list order`
  - `retainVisible drops hidden rows`
  - Source tests:
    - `a row click toggles while selecting and plays otherwise`
    - `the bar offers Add to your queue / Delete in All tracks and Add to your queue / Remove from playlist in a playlist`
    - `Delete confirms with "Delete N songs? This can't be undone."`
    - `long-press on a phone row enters selection; the ⋯ button still opens the row menu`
- [ ] **Step 2:** Run them. Expect: FAIL.
- [ ] **Step 3:** Implement. Load the design skills.
  - Add to your queue enqueues in list order.
  - Delete runs one by one with progress on the bar. A failed row stays selected with its reason.
  - Remove from playlist goes highest index first.
- [ ] **Step 4:** Run `npx vitest run src/`, then `npm run typecheck`. Expect: PASS.
- [ ] **Step 5:** Commit: "Music: pick several songs, then queue them or delete them".

### Task 10: Real-browser verification and a design pass

**Files:**
- Scratch harness only, under the session scratchpad's `ui-audit-final/`, never committed. Fixes go into the files above.

- [ ] **Step 1:** Local stack.
  - Docker (`mongodb`, `livekit-server`). Check `df -h /c` first.
  - The API (`node .dev/desk-api.mjs`, port 3200) and the client (port 6200).
  - The music service only if available.
  - Use the saved session `state.local.json` and the second test account; never exceed the login limit.
- [ ] **Step 2:** Two-person call in headless Edge, with a fake media stream. Prove each of these:
  - (a) each hears the other: inbound audio bytes increase on both sides;
  - (b) a music channel playing in the call is not subscribed until Listen;
  - (c) a screen share is not received (no inbound video bytes) until Join stream;
  - (d) Stream Volume changes only the stream element.
- [ ] **Step 3:** Capture the library features at 1280 and at 360 / 412 with touch:
  - selection mode;
  - the upload list with a forced 429;
  - queue reordering with a real pointer drag and a touch drag.
- [ ] **Step 4:** Design review with `impeccable` (critique and audit), `emil-design-eng` and `apple-design` on the captures. Fix, then re-capture.
- [ ] **Step 5:** Run `npx vitest run src/`, `npm run typecheck`, and the server suite. Commit the fixes: "Music and streams: fixes from the real-browser pass".

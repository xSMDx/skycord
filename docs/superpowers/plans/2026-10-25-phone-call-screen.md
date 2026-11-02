# Phone Call Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give touch phones a FaceTime-style, full-screen call screen: one row of four big round buttons on a swipe-up sheet, a Hold-to-talk bar for push-to-talk channels, full-screen video, a return-to-call bar, and an Android speaker toggle and keep-awake.

**Architecture:**
- **Pure rules** live in small modules that are tested in isolation:
  - who fills the screen;
  - the Music card's label;
  - join-progress text;
  - auto-hide;
  - the speaker route.
- **The screen itself** is a set of phone-only components hosted by `CallBar`, which already owns the ring and callee logic. It is drawn as a fixed full-screen layer while `phoneCall.open` is true. `ChatApp` owns opening and minimising, and the return bar.
- **The Android app** adds one bridge namespace, `audio`, and one member, `keepScreenOn`, both feature-detected.
- **Desktop is untouched.**

**Tech Stack:**
- Vue 3 `<script setup>` + TypeScript.
- Vitest, which runs in `environment: 'node'`: no DOM mounting, so views are checked from source with `?raw`, as `src/views/__tests__/chatAppBackgroundSocket.test.ts` does.
- lucide-vue-next icons.
- Kotlin, minSdk 26 / targetSdk 35, with JVM unit tests in `android/app/src/test/java/xyz/skycord/android/core/`.

**Spec:** `docs/superpowers/specs/2026-10-25-phone-call-screen-design.md`. Read it before any task. Its "Decided by me" items are binding.

## Global Constraints

- "Touch phone" means `noPushToTalkKey.value === true` (`isMobile && isCoarse`, in `src/composables/useVoiceSettings.ts`). Never `isMobile` alone.
- Desktop and narrow-window behaviour stays exactly as it is. Every existing test keeps passing.
- Every target is at least 44 × 44 px.
  - The circles are 52–60 px, with gaps of 12–20 px, grouped in the centre.
  - The Hold to talk bar is at least 52 px tall and spans the sheet's width minus its padding.
- Respect the safe-area insets (`env(safe-area-inset-*)`), the `--conn-h` banner inset used by the other phone overlays, and `prefers-reduced-motion`.
- Colours come from existing tokens only. The guards in `src/styles/__tests__/` must stay green. The hang-up circle uses the danger role tokens.
- Icons come from `lucide-vue-next` only: Mic, MicOff, Volume2, Headphones, Video, VideoOff, PhoneOff, ChevronDown, ChevronRight, Music2, UserPlus, SlidersHorizontal.
- Copy is exact where the spec gives it:
  - "Swipe up: people, music, invite"
  - "In this call · N"
  - "Music"
  - "Not playing"
  - "N playing"
  - "Invite people"
  - "Voice settings"
  - "Hold to talk"
  - "Talking…"
  - "This channel uses push to talk"
  - "Muted by the server"
  - "Using headset"
  - "Ringing…"
  - "No answer"
  - "Ring again"
  - "Connecting…"
- Android bridge members are optional and are read through `appBridge()` (`src/composables/desktopBridge.ts`). Their absence means no speaker circle, and no native keep-awake.
- Commits use pathspecs (`git add <files> && git commit -m … -- <files>`). Never `git add -A` and never push. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Android work never touches the owner's emulator `emulator-6554`. Use AVD `skycord35e2e` on `-ports 6556,6557` (`ANDROID_SERIAL=emulator-6556`). Source `android/env.sh` first and point `TMP`/`TEMP` at `H:\tmp`.
- Web verification commands:
  - `npx vitest run src/`
  - `npm run typecheck`. The server half may fail only through the TS2742 "cannot be named" errors, and only in worktrees whose `node_modules` is a junction. Not in this one.

## Review Focus

1. **Leaving the call's conversation while the screen is open** (a notification tap, Android Back past the screen, an "open conversation" event): the screen must minimise and the return bar must appear. It must never stay open while invisible, leaving no way back. → Task 8.
2. **A finger sliding off Hold to talk, a second finger, or the app backgrounded mid-hold:** the mic must stop. → Task 6 (release paths) and Task 3 (`pttRelease` is idempotent).
3. **A join that fails** (no route, retries, "Couldn't connect"): the screen shows the progress text, hang-up cancels, and the screen closes when the call ends. → Task 2 (`joinProgress`), Task 8 (the open state follows `inCall`).
4. **A camera turned on and off quickly, or a speaker changing every half second:** the big slot must not flicker (1.5 s hold), and the controls come back when the last video ends. → Task 2 (`pickFocus` hold), Task 4 (auto-hide disabled when no video).
5. **A narrow desktop window** (`isMobile` true, pointer fine): it still gets the desktop `CallBar`, screen share included. → Task 8.

---

### Task 1: Android: call audio route and keep-awake (spike first)

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/core/AudioRoutePolicy.kt`
- Create: `android/app/src/test/java/xyz/skycord/android/core/AudioRoutePolicyTest.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/CallAudio.kt`
- Modify: `android/app/src/main/java/xyz/skycord/android/BridgeHost.kt` (the `Incoming.Call` `when`, around line 276)
- Modify: `android/app/src/main/java/xyz/skycord/android/MainActivity.kt`
- Modify: `android/app/src/main/assets/bridge/app-shim.js`
- Modify: `src/composables/desktopBridge.ts` (the bridge interface, around line 120)

**Interfaces:**
- Produces, in the web bridge type `AppBridge`:
  - `audio?: { state(): Promise<AudioRouteState>; setCall(active: boolean): void; setSpeaker(on: boolean): void }`
  - `onAudioRoute?(cb: (s: AudioRouteState) => void): () => void`
  - `keepScreenOn?(on: boolean): void`
  - `export interface AudioRouteState { speaker: boolean; headset: boolean }`
- Bridge wire names:
  - methods `audio.state`, `audio.setCall`, `audio.setSpeaker`, `screen.keepOn`;
  - event `audioRoute`.

- [ ] **Step 1: The spike.**
  - Write `CallAudio.kt` with:
    - `setCall(active: Boolean)`: on → start watching devices and apply the route; off → clear overrides, stop watching.
    - `setSpeaker(on: Boolean)`.
    - `state(): AudioRoute`.
  - How it routes:
    - API 31+: `AudioManager.setCommunicationDevice` with the built-in speaker or earpiece, and `clearCommunicationDevice()` on end.
    - Below 31: `isSpeakerphoneOn`.
    - Headset plug and unplug: an `AudioDeviceCallback`.
  - Wire `audio.setSpeaker` and `audio.state` into `BridgeHost`. Build:
    `source android/env.sh && cd android && ./gradlew assembleDebug`
  - Install on `emulator-6556`. Join a DM call from the page between two local test accounts. Use the `android/e2e/notify.e2e.mjs` setup for the second account and LiveKit (`adb reverse` 7880/7881).
  - Call the bridge through the page (Playwright `_android`, as `android/e2e` does), then read `adb shell dumpsys audio`. Look at the mode and the communication device or speakerphone.
  - Record in the ledger:
    - the route before your call;
    - whether `setSpeaker(true)` and `setSpeaker(false)` change it and keep it for 30 s;
    - whether Chromium resets it on its own.
- [ ] **Step 2: Rule.**
  - **GO:** the route changes and holds.
  - **NO-GO:** it does not change, or Chromium undoes it. Then remove `audio` from the shim, keep `keepScreenOn`, and record that the speaker circle is not built. The owner is told at the end.
  - **The emulator cannot run** (the PC is out of commit memory, as on 2026-10-25): build and unit-test, leave `audio` out of the shim, record "unverified, not exposed", and carry on.
- [ ] **Step 3: Write the failing test** `AudioRoutePolicyTest`:
  - `headsetWinsOverSpeaker`: `routeFor(wantSpeaker = true, headset = true) == Target.HEADSET`
  - `speakerWhenWantedAndNoHeadset`: `routeFor(true, false) == Target.SPEAKER`
  - `earpieceWhenNotWanted`: `routeFor(false, false) == Target.EARPIECE`
  - `stateReportsHeadsetAndSpeaker`: `stateOf(Target.SPEAKER, headset = false) == AudioRoute(speaker = true, headset = false)`, and `stateOf(Target.HEADSET, true) == AudioRoute(false, true)`
- [ ] **Step 4:** Run `./gradlew test --tests '*AudioRoutePolicyTest*'`. Expect: FAIL, unresolved `routeFor`.
- [ ] **Step 5: Implement** in `core/AudioRoutePolicy.kt`, as pure Kotlin:
  - `enum class Target { SPEAKER, EARPIECE, HEADSET }`
  - `data class AudioRoute(val speaker: Boolean, val headset: Boolean)`
  - `fun routeFor(wantSpeaker: Boolean, headset: Boolean): Target`
  - `fun stateOf(target: Target, headset: Boolean): AudioRoute`

  `CallAudio` decides through these.
- [ ] **Step 6: Finish the wiring.**
  - `BridgeHost`:
    - `audio.state` → reply `{speaker, headset}`;
    - `audio.setCall` (Boolean) and `audio.setSpeaker` (Boolean) → `CallAudio`;
    - `CallAudio`'s change callback → `proxy.postMessage(BridgeProtocol.event("audioRoute", json))`;
    - `screen.keepOn` (Boolean) → `activity.keepScreenOn(on)`.
  - `MainActivity.keepScreenOn(on: Boolean)` adds or clears `WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` on the UI thread, and clears it in `onDestroy`.
  - `CallAudio.setCall(false)` also runs when the page goes away: a reload or a server switch.
  - `app-shim.js`: add `audio` (on GO only), `onAudioRoute: on(audioHandlers)` with the `audioRoute` event dispatched to it, and `keepScreenOn: (on) => fire('screen.keepOn', on === true)`.
  - `desktopBridge.ts`: add the members above with one doc comment each, in the style of `androidNotifications`.
- [ ] **Step 7:** Run `./gradlew test assembleDebug` and `npx vitest run src/composables/__tests__/desktopBridge.test.ts`. Expect: BUILD SUCCESSFUL; tests PASS.
- [ ] **Step 8: Commit:** `git add` each file above → `git commit -m "Android: call audio route and keep the screen awake for the phone call screen" -- <files>`

---

### Task 2: Shared rules: join progress, who fills the screen, the Music card

**Files:**
- Create: `src/composables/callStatus.ts`, `src/composables/__tests__/callStatus.test.ts`
- Create: `src/composables/phoneCallRules.ts`, `src/composables/__tests__/phoneCallRules.test.ts`
- Modify: `src/composables/callLimits.ts` (export the ordering used by `visibleTiles`)
- Modify: `src/components/voice/VoiceConnectedPanel.vue` (around lines 33–70: use `joinProgress`)

**Interfaces:**
- Produces:
  - `joinProgress(v: Pick<VoiceState-like, 'connecting'|'connectStage'|'connectAttempt'>): { label: string; failing: boolean } | null`. It is `null` when connected and not failed. Labels are exactly today's: 'Finding server…', 'Connecting…', 'Authenticating…', 'RTC connecting…', 'No route', 'Trying again…', 'Couldn’t connect'.
  - `export const bySpeechRecency: (a: TileCandidate, b: TileCandidate) => number`, the comparator `visibleTiles` already sorts with.
  - `pickFocus(input: FocusInput, prev: FocusState | null, now: number): FocusState`, where:
    - `FocusInput = { tiles: { id: string; speaking: boolean }[]; videos: { participantId: string; source: 'camera'|'screen'; local: boolean }[]; selfId: string; lastSpokeAt: Record<string, number> }`
    - `FocusState = { kind: 'screen'|'camera'|'avatar'; id: string; since: number }`
    - `export const FOCUS_HOLD_MS = 1500`
  - `musicCardLabel(m: { available: boolean; listeningTo: string | null; channels: MusicChannelView[] }): null | { kind: 'not-playing' } | { kind: 'song'; title: string; artist: string | null; cover: string | null } | { kind: 'count'; n: number }`
  - `formatElapsed(ms: number): string`: `m:ss` below an hour, `h:mm:ss` from an hour.
  - `callSubtitle(s: { kind: 'dm'|'group'|'channel'; count: number; onCamera: string | null; elapsedMs: number | null }): string`
    - DM: the elapsed time.
    - Otherwise "N people · m:ss".
    - When someone else's camera fills the screen: "N people · <Name> on camera".
    - With no elapsed time yet: just "N people", or "" for a DM.

- [ ] **Step 1: Write the failing tests.**
  - `callStatus.test.ts`:
    - `'failed' → { label: 'Couldn’t connect', failing: true }`
    - `no-route while connecting → { label: 'No route', failing: true }`
    - `attempt 2 → 'Trying again…'`
    - `each stage maps to today's label`
    - `connected → null`
  - `phoneCallRules.test.ts`:
    - `a remote screen share wins over cameras`
    - `the most recent speaker among camera owners fills the screen`
    - `your own camera fills only when nobody else has video`
    - `no video → the most recent remote speaker's avatar`
    - `you never take the avatar slot unless alone`
    - `a new candidate replaces the current one only after FOCUS_HOLD_MS (1499 ms keeps prev, 1500 ms switches)`
    - `a screen share switches immediately (no hold)`
    - musicCardLabel:
      - `unavailable → null`;
      - `tuned in with now → song (title, artist, cover)`;
      - `tuned in, nothing queued → not-playing`;
      - `not tuned in, 2 channels with now → { kind: 'count', n: 2 }`;
      - `not tuned in, nothing playing → not-playing`;
      - `a link with no title shows the url's host as title` (MusicEntryView.title can be null).
    - `formatElapsed(0) === '0:00'`, `(61_000) === '1:01'`, `(3_661_000) === '1:01:01'`
    - callSubtitle:
      - `DM → '4:12'`;
      - `group of 3 → '3 people · 4:12'`;
      - `group with Anavuf on camera → '4 people · Anavuf on camera'`;
      - `no elapsed → '3 people'`.
- [ ] **Step 2:** Run `npx vitest run src/composables/__tests__/callStatus.test.ts src/composables/__tests__/phoneCallRules.test.ts`. Expect: FAIL, modules missing.
- [ ] **Step 3: Implement** `callStatus.ts` and `phoneCallRules.ts`.
  - Move the label table out of `VoiceConnectedPanel` into `joinProgress`. The panel keeps its own icon and colour choice and takes the label from `joinProgress`. What it renders must not change.
  - `pickFocus` uses `bySpeechRecency` for "most recent".
- [ ] **Step 4:** Run `npx vitest run src/`. Expect: all PASS, the existing panel and `callLimits` tests included.
- [ ] **Step 5: Commit:** "Call rules: join progress, who fills a phone's screen, the Music card's label"

---

### Task 3: useVoice: Hold-to-talk press and release, phone mic pre-ask, call start time

**Files:**
- Modify: `src/composables/useVoice.ts`:
  - push-to-talk around lines 744–766;
  - the connect success path around lines 905–950;
  - `teardown`/leave, which resets state around line 735.
- Create: `src/composables/__tests__/voicePtt.test.ts`, mocking `voiceRoom` and LiveKit as `voiceRoomLifecycle.test.ts` does.

**Interfaces:**
- Produces, exported from `useVoice.ts` and added to the `useVoice()` return:
  - `pttPress(): Promise<boolean>`. True when the mic went on air. False when deafened, when `permits.audio` is false, or on a publish failure. On failure it sets `voice.mic = micFailureReason(e)`.
  - `pttRelease(): void`. Idempotent; safe with no room.
  - `voice.connectedAt: number | null`:
    - set to `Date.now()` when a call first connects;
    - unchanged by a reconnect to the same `convId`;
    - `null` after leave or a final failure.
- `onPttDown` and `onPttUp` (the key) call `pttPress` and `pttRelease`. Key behaviour is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `pttPress publishes and resolves true`
  - `pttPress is false and publishes nothing while deafened`
  - `pttPress is false while permits.audio is false`
  - `a refused publish sets voice.mic to the failure reason and resolves false`
  - `pttRelease turns the mic off and is safe to call twice or with no room`
  - `connectedAt is set on connect, kept across a reconnect to the same conv, and cleared on leave`
  - `joining a push-to-talk call on a touch phone asks for the mic once and stops the tracks`. Mock `navigator.mediaDevices.getUserMedia` and assert each returned track's `stop()` was called. Not on desktop.
- [ ] **Step 2:** Run `npx vitest run src/composables/__tests__/voicePtt.test.ts`. Expect: FAIL.
- [ ] **Step 3: Implement.**
  - The pre-ask runs in the connect path's `effectiveInputMode() === 'ptt'` branch, only when `noPushToTalkKey.value`.
  - A refusal there sets `voice.mic` from `micFailureReason`.
- [ ] **Step 4:** Run `npx vitest run src/`. Expect: all PASS (`useVoiceSettings`, `voiceRejoin`, `voiceRoomLifecycle` included).
- [ ] **Step 5: Commit:** "Voice: hold-to-talk press/release that reports failure, phone mic pre-ask, call start time"

---

### Task 4: Phone call state, auto-hide, keep-awake and speaker client

**Files:**
- Create: `src/composables/phoneCall.ts`, `src/composables/__tests__/phoneCall.test.ts`

**Interfaces:**
- Produces, from `phoneCall.ts`:
  - `phoneCall: { open: boolean }` (reactive)
  - `openPhoneCall(): void`
  - `minimizePhoneCall(): void`
  - `useAutoHide(opts: { enabled: () => boolean; delayMs?: number }): { hidden: Ref<boolean>; poke(): void; stop(): void }`
    - default `delayMs` is 4000;
    - `hidden` goes true only while `enabled()` and `delayMs` have passed since the last `poke()`;
    - `enabled()` turning false shows the controls at once.
  - `useCallKeepAwake(active: () => boolean): void`
    - active → `appBridge()?.keepScreenOn?.(true)`, else `navigator.wakeLock?.request('screen')`;
    - inactive → release;
    - re-acquire the browser lock on `visibilitychange` back to visible.
  - `speaker: { supported: boolean; on: boolean; headset: boolean }` (reactive)
  - `initSpeaker(): () => void`. It reads `appBridge()?.audio`, subscribes `onAudioRoute`, and returns an unsubscribe.
  - `setSpeaker(on: boolean): void`
  - `callAudioActive(active: boolean): void`. On true it calls `audio.setCall(true)` then `setSpeaker(true)`; on false, `audio.setCall(false)`.

- [ ] **Step 1: Write the failing tests** (fake timers; stub `appBridge` with `vi.mock('@/composables/desktopBridge')`):
  - `open/minimize toggle phoneCall.open`
  - `auto-hide hides after 4000 ms with no poke and not before`
  - `poke restarts the 4000 ms`
  - `disabling shows the controls at once and never hides while disabled`
  - `keep-awake uses the bridge when present and releases on inactive`
  - `keep-awake falls back to navigator.wakeLock and re-requests on visibility`
  - `speaker unsupported without bridge.audio`
  - `callAudioActive(true) sets the call then the speaker on`
  - `an audioRoute event updates speaker.on and speaker.headset`
- [ ] **Step 2:** Run `npx vitest run src/composables/__tests__/phoneCall.test.ts`. Expect: FAIL.
- [ ] **Step 3:** Implement `phoneCall.ts`.
- [ ] **Step 4:** Run it again. Expect: PASS. Then `npx vitest run src/`. Expect: PASS.
- [ ] **Step 5: Commit:** "Phone call state: open/minimise, auto-hide, keep-awake, speaker"

---

### Task 5: Phone stage and screen frame

**Files:**
- Create: `src/components/voice/phone/PhoneStage.vue`
- Create: `src/components/voice/phone/PhoneCallScreen.vue`

**Interfaces:**
- Consumes: `pickFocus`, `FOCUS_HOLD_MS` (Task 2), `useAutoHide` (Task 4), `VideoTile` (`fit: 'cover' | 'contain'`), `Avatar`, and `CallStage`'s tile shape `{ id; name; avatar; speaking; muted; ring? }`.
- Produces:
  - `PhoneStage` props: `{ tiles: Tile[]; videos: VideoTrackInfo[]; selfId: string; focus: FocusState | null; hidden: boolean }`.
    It is presentational: `PhoneCallScreen` owns `focus` (via `pickFocus`, with its own last-spoke tracking,
    as `CallStage` does) and passes it down.
    - The focus fills the stage: a screen share uses `contain`, a camera uses `cover`, otherwise a big avatar with a talking ring.
    - Other people sit in a row of small tiles, chosen with `visibleTiles(…, perf.maxCallTiles)` minus the focus. They are hidden when `hidden`.
    - Your own camera is a small top-right tile that stays visible when hidden.
    - The ringing / no-answer avatar shows "Ringing…" / "No answer" under it.
  - `PhoneCallScreen` props:
    - `{ name: string; subtitle: string; notice: string | null; tiles; videos; selfId; ringAgain: boolean }`
    - events `minimize`, `ringAgain`
    - a default slot for the sheet.

  It is a fixed full-screen layer with `role="dialog"`, `aria-modal="true"` and `aria-label` = the call name. Escape emits `minimize`.
  - At the top left is a 44 px chevron-down button with `aria-label="Minimise call"`. Then the name, the subtitle, and the notice line (`micNotice`) when present.
  - It pokes auto-hide on any pointerdown, and the revealing tap is swallowed while hidden.
  - Auto-hide is `useAutoHide({ enabled: () => focus?.kind !== 'avatar' && !sheetExpanded })`.
    `sheetExpanded` comes from the sheet's `expanded` event (Task 6), so it is off with no video and off
    while the sheet is pulled up.
  - "Ring again" is a 44 px button under the big avatar when `ringAgain`.

- [ ] **Step 1: Write the failing test** `src/components/voice/__tests__/phoneScreenSource.test.ts`. It reads both files with `?raw`, following the source-text style of `chatAppBackgroundSocket.test.ts`, and asserts:
  - `role="dialog"` and `aria-modal="true"`;
  - an Escape handler emits `minimize`;
  - `fit="contain"` for screen and `fit="cover"` for camera;
  - the self-view is not inside the element that `hidden` hides;
  - `env(safe-area-inset-top)` and `var(--conn-h` are used;
  - `@media (prefers-reduced-motion: reduce)` exists;
  - no hex colour literals.
- [ ] **Step 2:** Run `npx vitest run src/components/voice/__tests__/phoneScreenSource.test.ts`. Expect: FAIL.
- [ ] **Step 3:** Build both components. The look follows the approved wireframes: a dark stage, a centred big avatar about 96 px, small tiles about 44 × 58.
- [ ] **Step 4:** Run `npx vitest run src/` and `npm run typecheck`. Expect: PASS.
- [ ] **Step 5: Commit:** "Phone call screen: stage (focus, tiles, self view) and frame"

---

### Task 6: The call sheet: buttons, Hold to talk, people, Music card, Invite, Voice settings

**Files:**
- Create: `src/components/voice/phone/PhoneCallSheet.vue`
- Create: `src/components/voice/phone/HoldToTalk.vue`
- Create: `src/components/voice/phone/MarqueeText.vue`
- Test: `src/components/voice/__tests__/phoneSheetSource.test.ts`

**Interfaces:**
- Consumes:
  - `pttPress`, `pttRelease`, `voice`, `toggleMute`, `leave`, `effectiveInputMode`, `permits` (Task 3);
  - `speaker` and `setSpeaker` (Task 4);
  - `musicCardLabel` (Task 2);
  - `media.localCamOn`; an `onCamera` callback prop that runs `CallBar`'s existing camera action, preview included.
- Produces:
  - `PhoneCallSheet` props: `{ participants: { id; name; avatar; speaking; muted }[]; canInvite: boolean; joined: boolean; hidden: boolean }`
  - events: `camera`, `invite`, `voiceSettings`, `music`, `leave`, `expanded: [on: boolean]`
  - `HoldToTalk` props: `{ disabled: boolean; disabledLabel: string }`
  - `MarqueeText` props: `{ text: string }`

- [ ] **Step 1: Write the failing test** (source text), asserting:
  - **HoldToTalk:**
    - listens to `pointerdown`, `pointerup`, `pointercancel` and `lostpointercapture`;
    - calls `setPointerCapture`;
    - releases on `visibilitychange` when hidden;
    - calls `navigator.vibrate?.(10)`;
    - says "Talking…" only after `pttPress()` resolves true.
  - **PhoneCallSheet:**
    - the speaker circle renders only under `speaker.supported`;
    - the mic circle is disabled with "This channel uses push to talk" when `effectiveInputMode() === 'ptt'`;
    - it reads "Muted by the server" when `voice.serverMuted`;
    - the Hold to talk bar is outside the element that `hidden` fades;
    - the Music card renders only when `musicCardLabel(...)` is non-null;
    - Invite renders only when `canInvite`;
    - the exact copy strings from Global Constraints are present;
    - no screen-share control anywhere in `phone/`: no `MonitorUp` and no `toggleScreenShare`.
  - **MarqueeText:**
    - runs an `alternate` animation only when the text overflows;
    - under `prefers-reduced-motion: reduce` has no animation and uses `text-overflow: ellipsis`.
- [ ] **Step 2:** Run `npx vitest run src/components/voice/__tests__/phoneSheetSource.test.ts`. Expect: FAIL.
- [ ] **Step 3: Build.**
  - The sheet snaps between collapsed (handle, circles, hint) and expanded. Expanded keeps the circles where they are and slides the list in beneath them.
  - The drag follows the finger and decides on release from velocity. Reuse the projection approach in `src/components/ui/BottomSheet.vue`.
  - The circle row is one centred flex row with a fixed gap. The circles never shrink (`flex: none`).
  - The speaker circle is disabled with "Using headset" and the Headphones icon when `speaker.headset`.
  - The camera circle is disabled until `joined`.
- [ ] **Step 4:** Run `npx vitest run src/` and `npm run typecheck`. Expect: PASS.
- [ ] **Step 5: Commit:** "Phone call sheet: four circles, hold to talk, people, music card, invite, settings"

---

### Task 7: Call music on a phone

**Files:**
- Create: `src/components/voice/phone/PhoneMusicSheet.vue`
- Modify: `src/components/voice/MusicFlyout.vue`, only to move its non-visual logic (the `listeners` text, the create, queue and skip handlers) into an exported helper both use, if that avoids duplication.
- Create: `src/composables/callMusic.ts` and `src/composables/__tests__/callMusic.test.ts`, if the logic moves.

**Interfaces:**
- Consumes: `music`, `createMusicChannel`, `queueMusic`, `skipMusic`, `closeMusicChannel`, `listenToMusic`, `clearMusicError` from `useMusic`; `BottomSheet` (`open`, `title`, `height`, `close`).
- Produces: `PhoneMusicSheet` props `{ open: boolean }`, with events `close` and `openLibrary`.
  - It has the same contents and actions as `MusicFlyout`, laid out as full-width rows with 44 px targets: channels, who's listening, listen/stop, queue, skip, create, close.
  - It ends with a "Your library" row.

- [ ] **Step 1: Write the failing test.**
  - If the logic moves: `listeners text names two, then "and N more"`, plus a test for each moved handler.
  - Either way, a source test that `PhoneMusicSheet` uses `BottomSheet` and has no `CallFlyout`.
- [ ] **Step 2:** Run it. Expect: FAIL.
- [ ] **Step 3:** Implement. `MusicFlyout`'s desktop rendering must stay as it is.
- [ ] **Step 4:** Run `npx vitest run src/`. Expect: PASS.
- [ ] **Step 5: Commit:** "Phone call music: the call's music channels as a phone sheet"

---

### Task 8: Wire it in: CallBar, ChatApp, the return bar

**Files:**
- Create: `src/components/voice/phone/ReturnToCallBar.vue`
- Modify: `src/components/voice/CallBar.vue`:
  - the in-call template around lines 425–526: a phone branch;
  - the not-joined join row: 44 px on a touch phone;
  - emit the `minimize` that ChatApp already handles.
- Modify: `src/views/ChatApp.vue`:
  - the `VoiceConnectedPanel` mounts around lines 5154 and 5431: not on a touch phone;
  - mount `ReturnToCallBar` beside `<ConnectionBanner />` around line 4983;
  - the open/minimise rules;
  - the invite and settings handlers.
- Test: `src/views/__tests__/chatAppPhoneCall.test.ts`, `src/components/voice/__tests__/callBarPhoneSource.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7; `returnToCall()`, `viewVoiceChannel`, `currentCall`, `voiceStageOpen`, `showInviteGroup` and the `InviteToVoice` modal state in ChatApp; `noPushToTalkKey`; `joinProgress`; `micNotice`; `voice.connectedAt`.
- Produces: `ReturnToCallBar` props `{ name: string; talking: boolean; startedAt: number | null }`, with event `open`.
  - 44 px tall, in the layout flow so content moves down.
  - The timer shows `m:ss`, and `h:mm:ss` from an hour.

- [ ] **Step 1: Write the failing tests** (source text):
  - **CallBar:**
    - the phone branch renders `PhoneCallScreen` only when `noPushToTalkKey` and `inCall` and `phoneCall.open`;
    - the desktop `.cb-bar` is not rendered on a touch phone while in a call;
    - minimising emits `minimize`;
    - the screen's subtitle uses `joinProgress` while connecting;
    - "Ring again" calls the existing `ringAgain`.
  - **ChatApp:**
    - joining or connecting calls `openPhoneCall()` on a touch phone;
    - opening the voice channel you are in calls `openPhoneCall()`;
    - a change of the viewed conversation away from `voice.activeConvId || voice.connectingConvId` calls `minimizePhoneCall()`;
    - `ReturnToCallBar` shows when `noPushToTalkKey && (voice.connected || voice.connecting) && !phoneCall.open`, and its `open` runs `returnToCall()` then `openPhoneCall()`;
    - `VoiceConnectedPanel` is behind `!noPushToTalkKey`;
    - `useCallKeepAwake` is given `() => voice.connected || voice.connecting`;
    - `callAudioActive` follows `voice.connected`;
    - Invite opens `InviteToVoice` for a channel and `showInviteGroup` for a group, and is absent for a DM;
    - `voiceSettings` opens Settings › Voice & Video (`openSettings('voice')`, which `CallBar` already
      emits as `openSettings`);
    - `inCall` going false calls `minimizePhoneCall()`;
    - the screen's subtitle is `joinProgress(...)?.label` while connecting, else `callSubtitle(...)` with
      `voice.connectedAt`.
  - **Narrow desktop window:** the phone branch is keyed on `noPushToTalkKey`, never on `isMobile` alone.
- [ ] **Step 2:** Run `npx vitest run src/views/__tests__/chatAppPhoneCall.test.ts src/components/voice/__tests__/callBarPhoneSource.test.ts`. Expect: FAIL.
- [ ] **Step 3: Implement.**
  - The call's own conversation is the only place the screen draws. That is the spec's "Where it lives"; the minimise-on-navigate watch keeps it true.
  - In a voice channel, minimising clears `viewedVoiceId`.
  - Android Back reaches the screen through `role="dialog"` with no change to `androidBack.ts`.
- [ ] **Step 4:** Run `npx vitest run src/` and `npm run typecheck`. Expect: PASS.
- [ ] **Step 5: Commit:** "Phone call screen: wired into CallBar and ChatApp, with the return-to-call bar"

---

### Task 9: Look at it on a phone (and on desktop)

**Files:**
- Modify: the capture harness copy at `C:/Users/SMD/AppData/Local/Temp/claude/H--projects/8f493fd6-a7a8-43bf-8478-4232d7a5a1e4/scratchpad/ui-audit-final/run.mjs`, adding call screens. Scratch only, never committed.
- Modify: phone call components as the captures demand.

- [ ] **Step 1: Bring up the local stack.**
  - Mongo and LiveKit in Docker. Check free space on C: first; never use "Reset to factory defaults".
  - The API on 3200 and the client on 6200.
  - Join a DM call from two headless Edge contexts, using `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and the saved session `state.local.json`. Never log in more than the rate limit allows.
- [ ] **Step 2: Capture at 360 × 780 and 412 × 892**, with touch and a mobile user agent:
  - audio call, collapsed;
  - sheet pulled up, with a music channel playing so the Music card shows a long title;
  - a push-to-talk channel;
  - the far side's camera on;
  - controls hidden;
  - minimised with the return bar;
  - connecting;
  - DM ringing.
- [ ] **Step 3: Look at every capture.** Every control must be fully visible, at least 44 px, with nothing overlapping. Fix what fails, re-capture, and repeat until clean.
- [ ] **Step 4: Capture desktop at 1280 × 800** in the same call and compare it with a capture of the base commit. The `CallBar` must look the same.
- [ ] **Step 5:** Run `npx vitest run src/` and `npm run typecheck`. Then commit the fixes: "Phone call screen: fixes from the phone captures".

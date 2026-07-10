# Video Calls + Screen Share — Phase 1 Design Spec

**Date:** 2026-07-10
**Status:** Approved (design) — ready to plan
**Scope:** Phase 1 of 3. Camera + screen share publishing/subscribing with a working
tile grid. Phases 2 and 3 are recorded under [Roadmap](#roadmap-p2--p3) as future specs.

---

## 1. Context & Goal

Skycord already has audio-only voice calls over LiveKit (`useVoice.ts`, ~363 lines):
mint a token from `voiceController`, join one `Room`, publish the mic, subscribe to
remote audio, and keep server presence in sync (`call:join` / `call:leave`). The call
surface (`CallBar.vue`) renders circular avatar tiles + a Discord-style control pill,
but its camera and screen-share buttons are placeholders ("coming soon").

**Goal (P1):** make camera and screen share actually work end-to-end. A participant can
turn on their webcam and/or share their screen; every other participant sees those as
live tiles in a grid. No new server route, no new signalling channel — video is just
more LiveKit tracks in the room the call already uses.

The user's prior standalone app at `H:\projects\webrtc-share` is the **pattern donor**
(also LiveKit-based, same VPS): its `setVideoEncoding` quality approach, its
`Share Stream Audio` toggle (→ LiveKit screenshare `audio: true`), and its track
subscribe/attach lifecycle inform this design. Its vanilla-JS `LiveKitManager` class is
not ported; Skycord's composables stay the media layer.

---

## 2. Approach

**Extend the existing LiveKit voice path.** Camera and screen are published into the
*same* `Room` as audio via LiveKit's `setCameraEnabled()` / `setScreenShareEnabled()`.
The server token already grants `canPublish: true` (`voiceController` →
`at.addGrant({ roomJoin: true, canPublish: true, canSubscribe: true })`), so no server
change is needed. LiveKit negotiates new tracks over the existing peer connection, so
the retry / self-heal machinery in `useVoice` protects video for free.

Rejected alternatives: porting webrtc-share wholesale as a parallel "streams" subsystem
(two rooms per call, duplicated state, unwanted host/presenter model); or replacing
`useVoice`'s core with the vanilla `LiveKitManager` class (re-litigates battle-tested
connection code for no user-visible gain).

---

## 3. Architecture & Data Flow

### Track identity
LiveKit tags each publication with a `Track.Source`: `Microphone`, `Camera`,
`ScreenShare`, `ScreenShareAudio`. This is how we distinguish a participant's webcam
from their screen from their mic — no custom track names, no guessing.

### Publishing (local)
`useVoiceMedia.toggleCamera()` → `room.localParticipant.setCameraEnabled(true, opts)`.
`useVoiceMedia.toggleScreenShare()` → `setScreenShareEnabled(true, { audio, resolution })`.
The browser's native picker is the screen-source chooser. Local camera/screen tracks
attach locally too, so the user sees their own tile.

### Subscribing (remote)
`useVoice.wireRoom()` already listens to `RoomEvent.TrackSubscribed` /
`TrackUnsubscribed` but early-returns on anything that isn't audio (`useVoice.ts:114`).
P1 extends this: audio tracks keep their current path (attach hidden `<audio>`); **video**
tracks are routed into `useVoiceMedia`'s reactive `videoTracks` map instead of being
dropped. `CallStage` renders from that map.

P1 **auto-subscribes** all video (camera and screen show inline in the grid). The
"Watch Stream" opt-in gating is deliberately deferred to P2.

### Shared room handle
Both composables drive the same `Room`. Today `room` is a module-scoped `let` inside
`useVoice.ts`. P1 lifts it into a tiny internal module `voiceRoom.ts` (just the ref +
`getRoom()` / `setRoom()`), which both composables import. `useVoice` keeps owning the
lifecycle; `useVoiceMedia` only reads the handle to publish/unpublish. No import cycle:
`useVoice` → imports `stopMedia` from `useVoiceMedia`; `useVoiceMedia` → imports
`voiceRoom` + `useVoiceSettings`. One clean direction.

---

## 4. State & Actions

New composable `useVoiceMedia.ts` exposes a `media` reactive object (kept **separate**
from `useVoice`'s `voice` object, so the audio/connection authority stays clean and each
file stays holdable and independently testable):

```ts
interface VideoTrackInfo {
  participantId: string
  name:          string
  source:        'camera' | 'screen'
  track:         RemoteTrack | LocalVideoTrack
  muted:         boolean
}

interface MediaState {
  localCamOn:    boolean
  localScreenOn: boolean
  screenAudio:   boolean   // "Share Stream Audio" (persisted, default true)
  // key = `${identity}:${source}` — one entry per video publication
  videoTracks:   Map<string, VideoTrackInfo>
}
```

**Actions (P1):**

| Action | Behavior |
|---|---|
| `toggleCamera()` | `setCameraEnabled(!on, { deviceId })` at 720p default. On failure (no device / denied) revert `localCamOn`, toast, stay in call. |
| `toggleScreenShare()` | `setScreenShareEnabled(!on, { audio: screenAudio, resolution: 1080p30 })`. Native picker chooses source. Picker cancelled → no-op. |
| `addRemoteVideo(track, pub, participant)` | called from `wireRoom`; inserts into `videoTracks` keyed by identity+source. |
| `removeRemoteVideo(track, participant)` | removes the matching entry. |
| `stopMedia()` | unpublish local camera + screen, clear `videoTracks`, reset flags. Called by `useVoice.cleanup()` and `teardownRoom()`. |

**Quality is fixed in P1** (screenshare 1080p30, camera 720p). The picker + persisted
`screenQuality` land in P2 alongside the ▾ flyouts.

**Persistence:** `screenAudio` lives in `useVoiceSettings` (localStorage), consistent
with the other voice prefs.

**Self-heal:** on `RoomEvent.Disconnected` self-heal reconnect, video is **not**
auto-republished — the user returns dark (matches Discord; avoids surprise re-sharing a
screen). `stopMedia()` runs as part of the existing teardown before reconnect.

---

## 5. Stage Layouts (P1)

`CallStage.vue` renders two layouts, switching automatically on whether any video track
(local or remote) is present.

**Layout 1 — Centered avatars** (no video anywhere): today's look, preserved — circular
avatar tiles, speaking rings, mute badges.

**Layout 2 — Grid** (≥1 video track): rectangular 16:9 tiles, near-black stage that
flex-grows to fill the area above the composer. Auto-arrange by tile count (1 = full,
2 = side by side, 3–4 = grid, then wrap). Each tile is one of:

- **Camera tile** — live webcam feed (`VideoTile`)
- **Screen tile** — live screen feed (`VideoTile`), red `LIVE` badge top-right
- **Avatar tile** — participant in call with no video: avatar centered on a per-user
  accent background derived from the existing `useAvatar` palette
  (`colorForUsername`)

Per-tile chrome (P1): name pill bottom-left; **green border = speaking**; hover reveals
username/tooltip. A participant sharing screen **and** camera produces **two** tiles
(two publications).

Platform/source glyphs in the name pill (monitor = screensharing) are P1 for the screen
case; mobile/game glyphs are cosmetic and may slip to P2.

---

## 6. Components & File Manifest

| File | Change | Purpose |
|---|---|---|
| `src/composables/voiceRoom.ts` | **new** | Shared `Room` handle (`getRoom`/`setRoom`). |
| `src/composables/useVoice.ts` | modify | Use shared `room`; `cleanup()` + `teardownRoom()` call `stopMedia()`; route video tracks to `useVoiceMedia` in `wireRoom`. |
| `src/composables/useVoiceMedia.ts` | **new** | `media` state + camera/screen actions + `videoTracks` map + `stopMedia`. |
| `src/composables/useVoiceSettings.ts` | modify | Add persisted `screenAudio`. |
| `src/components/voice/VideoTile.vue` | **new** | Attach one LiveKit video track to a `<video>` (ref + `track.attach()`), handle detach on unmount. Reusable for local/remote, camera/screen. |
| `src/components/voice/CallStage.vue` | **new** | Render Layout 1 + Layout 2 from participants + `videoTracks`. |
| `src/components/voice/CallBar.vue` | modify | Slim orchestrator (incall/ongoing/connecting decision); compose `CallStage`; wire camera + screen-share control buttons to `useVoiceMedia`. |
| `src/views/ChatApp.vue` | modify | Let the stage region flex-grow when video is present (Layout 2). |

`CallControls` extraction (splitting the pill bar out of `CallBar`) is **optional in P1**
and becomes worthwhile in P2 when the ▾ flyouts arrive; P1 may keep controls inline in
`CallBar` to limit blast radius. Decision left to the plan.

**Recurring gotcha:** any new SFC with `<button>`s needs a `.scope button { border: none }`
reset to kill the UA bevel (same pattern already in `CallBar`).

---

## 7. Control Bar Wiring (P1)

- **Camera button** — toggles `media.localCamOn` via `toggleCamera()`; icon reflects
  on/off (green when on, `PhVideoCamera` / `PhVideoCameraSlash`).
- **Screen-share button** — toggles `media.localScreenOn` via `toggleScreenShare()`;
  active (green) while sharing.
- The ▾ chevrons stay present but **inert in P1** (device/quality menus are P2); they
  keep their disabled styling rather than being removed, so the layout doesn't shift
  when P2 fills them.
- Mic / deafen / leave behavior is unchanged.

---

## 8. Error Handling & Edge Cases

- **Camera/mic denied or no device** → revert the toggle, toast, stay in the call.
  Mirrors the existing listen-only mic fallback in `attemptConnect`.
- **Screen-share picker cancelled** → LiveKit rejects; swallow it, leave button off.
- **`getDisplayMedia` secure-context requirement** → works on `localhost` / HTTPS, not
  plain http-over-IP. Same constraint as mic capture. Surface a clear "screen share
  needs HTTPS" toast instead of throwing (a throw would orphan the room → reconnect
  loop, the exact failure `useVoice` was hardened against).
- **Self-heal reconnect** → do not auto-republish camera/screen (return dark).
- **Deafen** → audio-only; leaves video untouched.
- **Group scaling** → `Room` is already `{ adaptiveStream: true, dynacast: true }`
  (`useVoice.ts:261`), so unviewed/unsized video isn't sent full-res; the grid stays
  cheap even with several sharers.
- **Leaving / hang-up** → `stopMedia()` in `cleanup()` guarantees the local camera light
  and screen capture stop (no orphaned green indicator).

---

## 9. Testing & Verification

No test runner in the project. Verification is:

1. `npm run build` completes clean (type-check + bundle).
2. Manual 2-account test via the local preview (`npm run dev:client` on `:5173`
   + API on `:3001`):
   - Account A turns on camera → Account B sees A's camera tile; and vice versa.
   - Account A shares screen → Account B sees A's screen tile with the `LIVE` badge.
   - A shares screen **and** camera simultaneously → B sees **two** A tiles.
   - Hang up → local camera light + screen capture stop; both drop from B's grid.
   - Kill the network briefly mid-call → self-heal rejoins audio; user returns dark
     (video not auto-republished).

**Verification gate:** a second account sees the first account's camera *and* screen
tile at the same time, and both vanish on hang-up.

---

## Roadmap (P2 & P3)

Recorded here for continuity; each gets its own spec when picked up.

**Phase 2 — Rich viewing.**
- Watch-stream opt-in: screen tiles show a "Watch Stream" button and are only
  subscribed on demand (not auto-subscribed as in P1).
- Spotlight layout: promote a stream/video to fill the stage with header
  "· <name>'s Screen" + `720p 30FPS` `LIVE`, others collapse into a bottom filmstrip.
- Quality picker (▾ flyouts): screenshare resolution (720/1080/source) + framerate
  (15/30/60) via the `setVideoEncoding` pattern; camera device select; persisted
  `screenQuality`. "Share Stream Audio" toggle surfaced in the menu.
- Pop-out / fullscreen affordances; collapse chevron to shrink the stage.

**Phase 3 — Context menus (serves the broader "context menus for everything" backlog).**
- Extract a generic `ContextMenu` shell from today's message-specific
  `ContextMenu.vue` (backdrop, viewport-clamped positioning, pop animation, rows /
  separators / sliders / checkboxes / submenus).
- **Stream context menu**: Stop Watching, Mute, Stream Volume, Pop Out Stream, Stream
  Attenuation (+ strength), More Options.
- **User context menu** (Skycord-relevant items only): Profile, Message, Start a Call,
  Add Note, User Volume, Mute, Mute Soundboard, Disable Video, Block, Ignore, Add
  Friend, Pop Out User, Show Non-Video Participants, Copy User ID. Drop Discord
  server-only items (Invite to Server, Role, View Verification Code).
- Re-point the existing message menu at the generic shell.

---

## Locked Decisions

- Extend the existing LiveKit voice path; no new server route or signalling.
- Video state lives in a **separate** `useVoiceMedia` / `media` object; shared `room`
  via `voiceRoom.ts`.
- Free-for-all sharing (any participant, no host/presenter approval).
- P1 auto-subscribes video (inline grid); watch-stream opt-in is P2.
- P1 fixed quality (screenshare 1080p30, camera 720p); picker is P2.
- Self-heal reconnect returns dark (no auto-republish).
- Verification = `npm run build` + 2-account manual preview test.

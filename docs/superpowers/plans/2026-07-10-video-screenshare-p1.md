# Video + Screen Share (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any call participant turn on their camera and/or share their screen, and have every other participant see those as live tiles in a grid — built on Skycord's existing LiveKit voice room.

**Architecture:** Camera and screen are published as extra LiveKit tracks into the *same* `Room` the audio call already uses (the server token already grants `canPublish`). A shared room handle (`voiceRoom.ts`) lets a new `useVoiceMedia` composable publish/subscribe video without `useVoice` exposing internals. A new `CallStage` renders two layouts (centered avatars when no video; a rectangular grid when any video is present) from `voice.participants` + `media.videoTracks`.

**Tech Stack:** Vue 3 (`<script setup>`, composables), TypeScript, `livekit-client` ^2.20, Phosphor icons.

## Global Constraints

- **No test runner in this project.** Per-task verification = `npm run build` completes clean (Vite build + `tsc -p tsconfig.server.json`), plus targeted manual checks in the local preview. There are no unit tests to write; each task's "test cycle" is build + manual verify + commit.
- **Preview setup:** client on `http://127.0.0.1:5173` (`npm run dev:client`), API on `:3001` (`npm run dev:server`). `getUserMedia`/`getDisplayMedia` need a secure context — `localhost`/`127.0.0.1` qualifies, so camera + screen work in the preview.
- **Branch:** do this work on a new branch `video-screenshare` off `call-overhaul`. First commit also adds the already-written spec `docs/superpowers/specs/2026-07-10-video-screenshare-p1-design.md`.
- **UA button-bevel gotcha:** any new SFC containing `<button>`s must include a `button { border: none }` reset in its scoped styles (existing pattern in `CallBar.vue`).
- **Fixed P1 quality:** camera 1280×720, screenshare 1920×1080. No picker (that's P2).
- **Self-heal:** video is never auto-republished after a reconnect (handled by `stopMedia()` running in teardown).
- **livekit-client APIs used (verbatim):** `room.localParticipant.setCameraEnabled(enabled, VideoCaptureOptions?)`, `setScreenShareEnabled(enabled, ScreenShareCaptureOptions?)`, `participant.getTrackPublication(Track.Source)`, `Track.Source.Camera` / `Track.Source.ScreenShare`, `Track.Kind.Video` / `Track.Kind.Audio`, `track.attach(HTMLMediaElement)`, `track.detach()`, `RoomEvent.TrackSubscribed`/`TrackUnsubscribed` callbacks `(track, publication, participant)`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/composables/voiceRoom.ts` (new) | Holds the single shared `Room` reference; `getRoom()` / `setRoom()`. |
| `src/composables/useVoice.ts` (modify) | Owns connection lifecycle; now stores its room via `voiceRoom`; routes remote video to `useVoiceMedia`; calls `stopMedia()` on teardown. |
| `src/composables/useVoiceSettings.ts` (modify) | Add persisted `screenAudio` preference. |
| `src/composables/useVoiceMedia.ts` (new) | `media` reactive state; camera/screen publish toggles; `videoTracks` map; `stopMedia()`. |
| `src/components/voice/VideoTile.vue` (new) | Attaches one LiveKit video track to a `<video>` element. |
| `src/components/voice/CallStage.vue` (new) | Renders Layout 1 (avatars) + Layout 2 (grid) from tiles + videos. |
| `src/components/voice/CallBar.vue` (modify) | Compose `CallStage`; wire camera + screen-share buttons; grow when video present. |
| `src/views/ChatApp.vue` (modify) | Let the call stage flex-grow above the message list when video is present. |

---

### Task 1: Shared room handle + refactor `useVoice` to use it

Introduce `voiceRoom.ts` and move `useVoice`'s module-scoped `room` behind it, with **zero behavior change**. This unblocks `useVoiceMedia` sharing the same `Room`.

**Files:**
- Create: `src/composables/voiceRoom.ts`
- Modify: `src/composables/useVoice.ts` (remove `let room` at line 57; replace reads/writes)

**Interfaces:**
- Produces: `getRoom(): Room | null`, `setRoom(r: Room | null): void` from `voiceRoom.ts`.

- [ ] **Step 1: Create the shared handle**

Create `src/composables/voiceRoom.ts`:

```ts
/**
 * The one active LiveKit Room, shared by useVoice (owns its lifecycle) and
 * useVoiceMedia (reads it to publish/subscribe camera + screen). Kept in its
 * own module so the two composables reference the same Room without useVoice
 * having to export its internals.
 */
import type { Room } from 'livekit-client'

let _room: Room | null = null
export const getRoom = (): Room | null => _room
export const setRoom = (r: Room | null): void => { _room = r }
```

- [ ] **Step 2: Import the handle and delete the local `room` in `useVoice.ts`**

At the top of `src/composables/useVoice.ts`, add to the imports (below the existing `useApi` import):

```ts
import { getRoom, setRoom } from './voiceRoom'
```

Delete line 57 (`let room: Room | null = null`). Keep the other module-scoped `let`s.

- [ ] **Step 3: Convert each `room` user to the shared handle**

The rule: functions that **read** `room` add a local snapshot `const room = getRoom()` at the top and keep their body unchanged; the three **assignment** sites use `setRoom(...)`. Apply exactly:

`teardownRoom()` — change the first two lines:
```ts
const teardownRoom = () => {
  const r = getRoom(); setRoom(null)
  if (r) r.disconnect().catch(() => {})
  audioEls.forEach(el => el.remove()); audioEls.clear()
  unbindPtt()
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
}
```

`readRtt()` — first line inside `try`:
```ts
  try {
    const eng: any = (getRoom() as any)?.engine
```

`syncParticipants()` — add snapshot at top:
```ts
const syncParticipants = () => {
  const room = getRoom()
  if (!room) { voice.participants = []; return }
  // ...unchanged body...
}
```

`onPttDown` / `onPttUp` — add snapshot:
```ts
const onPttDown = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey || e.repeat) return
  const room = getRoom()
  if (room && !voice.localDeafened) room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
}
const onPttUp = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey) return
  const room = getRoom()
  if (room) room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
}
```

`connect()` — the guard reads `room`:
```ts
  const connect = async (convId: string, kind: 'dm' | 'group', name: string) => {
    if (voice.connecting && voice.connectingConvId === convId) return
    if (voice.connected  && voice.activeConvId     === convId && voice.activeKind === kind) return
    if (getRoom() || voice.connected || voice.connecting) await leave()
    void attemptConnect(convId, kind, name, 1)
  }
```

`attemptConnect()` — the success path assigns the room. Change `room = r` (currently line 268) to `setRoom(r)`:
```ts
      if (seq !== connectSeq) { r.disconnect().catch(() => {}); return }
      setRoom(r)
```

`cleanup()` — first two lines of the body:
```ts
const cleanup = () => {
  const r = getRoom()
  setRoom(null)
  if (r) r.disconnect().catch(() => {})
  // ...unchanged body...
}
```

`leave()` — the disconnect call:
```ts
    try { await getRoom()?.disconnect() } catch { /* ignore */ }
```

`toggleMute()` and `toggleDeafen()` — add a snapshot at the top of each:
```ts
  const toggleMute = () => {
    const room = getRoom()
    if (!room) return
    // ...unchanged body...
  }

  const toggleDeafen = () => {
    const room = getRoom()
    if (!room) return
    // ...unchanged body...
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: completes with no TypeScript errors. (An unused-import or missing-symbol error here means a `room` reference was missed — grep `useVoice.ts` for a bare `room` not preceded by `const room = getRoom()` or `setRoom`.)

- [ ] **Step 5: Manual regression — voice still works**

With the preview running (client `:5173` + API `:3001`), sign in on two browser profiles, start a DM call between them. Verify: both connect, mute/unmute toggles, and hang-up leaves cleanly (no ghost participant). This proves the room-handle refactor changed nothing.

- [ ] **Step 6: Commit** (first commit on the branch — include the spec)

```bash
git checkout -b video-screenshare
git add docs/superpowers/specs/2026-07-10-video-screenshare-p1-design.md \
        src/composables/voiceRoom.ts src/composables/useVoice.ts
git commit -m "refactor(voice): share LiveKit Room via voiceRoom handle (P1 groundwork)"
```

---

### Task 2: `useVoiceMedia` composable (state + publish toggles)

Create the media composable that publishes camera/screen and tracks video publications. Also add the `screenAudio` preference it needs.

**Files:**
- Modify: `src/composables/useVoiceSettings.ts` (add `screenAudio`)
- Create: `src/composables/useVoiceMedia.ts`

**Interfaces:**
- Consumes: `getRoom()` (Task 1); `voiceSettings` (Task 2 addition).
- Produces:
  - `media` reactive: `{ localCamOn: boolean; localScreenOn: boolean; videoTracks: Map<string, VideoTrackInfo> }`
  - `VideoTrackInfo = { participantId: string; name: string; source: 'camera' | 'screen'; track: RemoteTrack | LocalVideoTrack; local: boolean }`
  - `toggleCamera(): Promise<void>`, `toggleScreenShare(): Promise<void>`
  - `addRemoteVideo(track: RemoteTrack, participant: RemoteParticipant): void`
  - `removeRemoteVideo(track: RemoteTrack, participant?: Participant): void`
  - `stopMedia(): void`
  - `useVoiceMedia()` returning all of the above.

- [ ] **Step 1: Add `screenAudio` to voice settings**

In `src/composables/useVoiceSettings.ts`, add the field to the `VoiceSettings` interface (after `echoCancellation`):
```ts
  echoCancellation: boolean
  screenAudio:      boolean   // capture system/tab audio when screen sharing
```
And to `DEFAULTS`:
```ts
  noiseSuppression: true, echoCancellation: true,
  screenAudio: true,
```

- [ ] **Step 2: Create `useVoiceMedia.ts`**

Create `src/composables/useVoiceMedia.ts`:

```ts
/**
 * useVoiceMedia — camera + screen-share for the active voice call. Publishes
 * local video tracks into the shared LiveKit Room (voiceRoom) and keeps a
 * reactive map of every video publication (local + remote) for the call stage.
 * useVoice stays the audio/connection authority; this file owns video only.
 */
import { reactive } from 'vue'
import {
  Track,
  type RemoteTrack, type LocalVideoTrack,
  type Participant, type RemoteParticipant,
} from 'livekit-client'
import { getRoom } from './voiceRoom'
import { voiceSettings } from './useVoiceSettings'

export interface VideoTrackInfo {
  participantId: string
  name:          string
  source:        'camera' | 'screen'
  track:         RemoteTrack | LocalVideoTrack
  local:         boolean
}

interface MediaState {
  localCamOn:    boolean
  localScreenOn: boolean
  videoTracks:   Map<string, VideoTrackInfo>   // key = `${identity}:${source}`
}

export const media = reactive<MediaState>({
  localCamOn: false,
  localScreenOn: false,
  videoTracks: new Map(),
})

// Fixed P1 encodings (picker is P2).
const CAM_RES    = { width: 1280, height: 720 }
const SCREEN_RES = { width: 1920, height: 1080 }

const keyFor = (identity: string, source: 'camera' | 'screen') => `${identity}:${source}`
const srcOf  = (s: Track.Source): 'camera' | 'screen' | null =>
  s === Track.Source.Camera ? 'camera' : s === Track.Source.ScreenShare ? 'screen' : null

// After a local publish resolves, read the freshly-created publication's track
// and register it so the local user sees their own tile.
const registerLocalVideo = (source: Track.Source) => {
  const room = getRoom(); if (!room) return
  const s = srcOf(source); if (!s) return
  const pub = room.localParticipant.getTrackPublication(source)
  const track = pub?.track as LocalVideoTrack | undefined
  if (!track) return
  media.videoTracks.set(keyFor(room.localParticipant.identity, s), {
    participantId: room.localParticipant.identity,
    name: room.localParticipant.name || 'You',
    source: s, track, local: true,
  })
}
const unregisterLocalVideo = (source: 'camera' | 'screen') => {
  const room = getRoom(); if (!room) return
  media.videoTracks.delete(keyFor(room.localParticipant.identity, source))
}

export const toggleCamera = async () => {
  const room = getRoom(); if (!room) return
  const next = !media.localCamOn
  try {
    await room.localParticipant.setCameraEnabled(next, {
      deviceId: voiceSettings.cameraDeviceId || undefined,
      resolution: CAM_RES,
    })
    media.localCamOn = next
    next ? registerLocalVideo(Track.Source.Camera) : unregisterLocalVideo('camera')
  } catch (e) {
    console.warn('[voice-media] camera toggle failed', e)
    media.localCamOn = false   // revert; no device / permission denied
  }
}

export const toggleScreenShare = async () => {
  const room = getRoom(); if (!room) return
  const next = !media.localScreenOn
  try {
    await room.localParticipant.setScreenShareEnabled(next, {
      audio: voiceSettings.screenAudio,
      resolution: SCREEN_RES,
    })
    media.localScreenOn = next
    next ? registerLocalVideo(Track.Source.ScreenShare) : unregisterLocalVideo('screen')
  } catch (e) {
    // Cancelling the OS picker rejects here — treat as a no-op.
    console.warn('[voice-media] screen share toggle cancelled/failed', e)
    media.localScreenOn = false
  }
}

export const addRemoteVideo = (track: RemoteTrack, participant: RemoteParticipant) => {
  if (track.kind !== Track.Kind.Video) return
  const s = srcOf(track.source); if (!s) return
  media.videoTracks.set(keyFor(participant.identity, s), {
    participantId: participant.identity,
    name: participant.name || participant.identity,
    source: s, track, local: false,
  })
}

export const removeRemoteVideo = (track: RemoteTrack, participant?: Participant) => {
  if (!participant) return
  const s = srcOf(track.source); if (!s) return
  media.videoTracks.delete(keyFor(participant.identity, s))
}

// State-only reset for teardown/cleanup. The Room disconnect (in useVoice)
// tears down the actual tracks; we just clear flags + the map, and never
// auto-republish on reconnect.
export const stopMedia = () => {
  media.localCamOn = false
  media.localScreenOn = false
  media.videoTracks.clear()
}

export const useVoiceMedia = () => ({
  media, toggleCamera, toggleScreenShare, addRemoteVideo, removeRemoteVideo, stopMedia,
})
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no TypeScript errors. (If `getTrackPublication` or `Track.Source` types complain, confirm `livekit-client` is ^2.20 in `package.json`.)

- [ ] **Step 4: Commit**

```bash
git add src/composables/useVoiceSettings.ts src/composables/useVoiceMedia.ts
git commit -m "feat(voice): useVoiceMedia — camera/screen publish + video track map"
```

---

### Task 3: Route remote video in `useVoice`, and stop media on teardown

Wire the subscribe events to `useVoiceMedia` and ensure hang-up/cleanup clears video state.

**Files:**
- Modify: `src/composables/useVoice.ts` (`wireRoom`, `teardownRoom`, `cleanup`)

**Interfaces:**
- Consumes: `addRemoteVideo`, `removeRemoteVideo`, `stopMedia` (Task 2).

- [ ] **Step 1: Import the media hooks**

In `src/composables/useVoice.ts`, add to imports:
```ts
import { addRemoteVideo, removeRemoteVideo, stopMedia } from './useVoiceMedia'
```

- [ ] **Step 2: Route video tracks in `wireRoom`**

Replace the two lines (currently `useVoice.ts:140-141`):
```ts
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => { attachTrack(track); syncParticipants() })
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { detachTrack(track); syncParticipants() })
```
with (note the added `publication` + `participant` callback args):
```ts
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Video) addRemoteVideo(track, participant)
    else attachTrack(track)
    syncParticipants()
  })
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
    if (track.kind === Track.Kind.Video) removeRemoteVideo(track, participant)
    else detachTrack(track)
    syncParticipants()
  })
```
(`RemoteParticipant` is already imported in `useVoice.ts`; `attachTrack` keeps its own audio-only guard, so it's safe.)

- [ ] **Step 3: Clear video state on teardown and cleanup**

In `teardownRoom()`, add `stopMedia()` as the last line before the closing brace:
```ts
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
  stopMedia()
}
```
In `cleanup()`, add `stopMedia()` right after the `intentionalLeave = false` line:
```ts
  intentionalLeave = false
  stopMedia()
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manual — remote video registers**

Two profiles in a call. In profile A's devtools console, run `await navigator.mediaDevices.getUserMedia({video:true})` is NOT needed — instead, temporarily verify plumbing: in A, from the app you don't yet have a button, so check the map indirectly after Task 6. For now, confirm the build is clean and audio call still connects (no regression from the callback-signature change).

- [ ] **Step 6: Commit**

```bash
git add src/composables/useVoice.ts
git commit -m "feat(voice): subscribe remote video into media map; stop media on teardown"
```

---

### Task 4: `VideoTile` component

A leaf component that binds one LiveKit video track to a `<video>` element.

**Files:**
- Create: `src/components/voice/VideoTile.vue`

**Interfaces:**
- Consumes: a `RemoteTrack | LocalVideoTrack` via the `track` prop.
- Produces: `<VideoTile :track :fit />` renderable by `CallStage` (Task 5). Prop `fit?: 'cover' | 'contain'` (default `'cover'`).

- [ ] **Step 1: Create the component**

Create `src/components/voice/VideoTile.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { RemoteTrack, LocalVideoTrack } from 'livekit-client'

const props = withDefaults(defineProps<{
  track: RemoteTrack | LocalVideoTrack
  fit?: 'cover' | 'contain'
}>(), { fit: 'cover' })

const el = ref<HTMLVideoElement | null>(null)

const attach = () => { if (el.value) props.track.attach(el.value) }

onMounted(attach)
onBeforeUnmount(() => { try { props.track.detach() } catch { /* ignore */ } })
// If the track object itself is swapped (e.g. camera restart), rebind.
watch(() => props.track, (next, prev) => {
  try { prev?.detach() } catch { /* ignore */ }
  attach()
})
</script>

<template>
  <!-- muted: audio arrives via separate LiveKit audio tracks, not the video el -->
  <video ref="el" class="vtile" autoplay playsinline muted
         :style="{ objectFit: fit }"></video>
</template>

<style scoped>
.vtile { width: 100%; height: 100%; display: block; background: #000; }
</style>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/voice/VideoTile.vue
git commit -m "feat(voice): VideoTile — bind a LiveKit video track to a <video>"
```

---

### Task 5: `CallStage` component

Render the two stage layouts from a tile list + a video list.

**Files:**
- Create: `src/components/voice/CallStage.vue`

**Interfaces:**
- Consumes: `VideoTile` (Task 4); `colorForUsername` from `useAvatar`; `VideoTrackInfo` type (Task 2).
- Produces:
  - Prop `tiles: { id: string; name: string; avatar: string; speaking: boolean; muted: boolean }[]`
  - Prop `videos: VideoTrackInfo[]`
  - Renders Layout 1 when `videos.length === 0`, else Layout 2 (grid). Root element carries class `stage` and, in grid mode, `stage--grid` (consumed by CallBar/ChatApp for flex sizing).

- [ ] **Step 1: Create the component**

Create `src/components/voice/CallStage.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { PhMicrophoneSlash, PhMonitor } from '@phosphor-icons/vue'
import VideoTile from './VideoTile.vue'
import { colorForUsername } from '@/composables/useAvatar'
import type { VideoTrackInfo } from '@/composables/useVoiceMedia'

const props = defineProps<{
  tiles:  { id: string; name: string; avatar: string; speaking: boolean; muted: boolean }[]
  videos: VideoTrackInfo[]
}>()

const hasVideo = computed(() => props.videos.length > 0)
const initial  = (n: string) => (n || '?').charAt(0).toUpperCase()

// One grid cell per participant: their video publication(s) if any, else an
// avatar cell. A participant sharing screen + camera yields two video cells.
type Cell =
  | { kind: 'video'; key: string; name: string; speaking: boolean; source: 'camera' | 'screen'; video: VideoTrackInfo }
  | { kind: 'avatar'; key: string; name: string; speaking: boolean; muted: boolean; avatar: string }

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  for (const t of props.tiles) {
    const mine = props.videos.filter(v => v.participantId === t.id)
    if (mine.length) {
      for (const v of mine) {
        out.push({ kind: 'video', key: `${t.id}:${v.source}`, name: t.name, speaking: t.speaking, source: v.source, video: v })
      }
    } else {
      out.push({ kind: 'avatar', key: t.id, name: t.name, speaking: t.speaking, muted: t.muted, avatar: t.avatar })
    }
  }
  return out
})
</script>

<template>
  <!-- Layout 1: centered circular avatars (no video anywhere) -->
  <div v-if="!hasVideo" class="stage">
    <div v-for="t in tiles" :key="t.id" class="s-tile">
      <div class="s-av" :class="{ speaking: t.speaking }">
        <img v-if="t.avatar" :src="t.avatar" :alt="t.name" />
        <template v-else>{{ initial(t.name) }}</template>
        <span v-if="t.muted" class="s-mute"><PhMicrophoneSlash :size="13" weight="fill" /></span>
      </div>
      <span class="s-name">{{ t.name }}</span>
    </div>
  </div>

  <!-- Layout 2: rectangular grid (any video present) -->
  <div v-else class="stage stage--grid">
    <div v-for="c in cells" :key="c.key" class="g-cell" :class="{ speaking: c.speaking }">
      <template v-if="c.kind === 'video'">
        <VideoTile :track="c.video.track" :fit="c.source === 'screen' ? 'contain' : 'cover'" />
        <span v-if="c.source === 'screen'" class="g-live">LIVE</span>
      </template>
      <template v-else>
        <div class="g-avwrap" :style="{ background: colorForUsername(c.name) }">
          <div class="g-av">
            <img v-if="c.avatar" :src="c.avatar" :alt="c.name" />
            <template v-else>{{ initial(c.name) }}</template>
          </div>
        </div>
        <span v-if="c.muted" class="g-mute"><PhMicrophoneSlash :size="13" weight="fill" /></span>
      </template>
      <span class="g-name">
        <PhMonitor v-if="c.kind === 'video' && c.source === 'screen'" :size="13" weight="fill" />
        {{ c.name }}
      </span>
    </div>
  </div>
</template>

<style scoped>
button { border: none; }

/* Layout 1 — circular avatar tiles */
.stage { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; align-content: center; }
.s-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.s-av {
  width: 72px; height: 72px; border-radius: 50%; position: relative;
  background: var(--accent); color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700; box-shadow: 0 0 0 0 rgba(35,165,90,0); transition: box-shadow .15s;
}
.s-av img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.s-av.speaking { box-shadow: 0 0 0 3px #23a55a; }
.s-mute {
  position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%;
  background: #f23f43; color: #fff; display: flex; align-items: center; justify-content: center; border: 3px solid var(--bg-floor);
}
.s-name { font-size: 13px; color: var(--text-1); font-weight: 600; }

/* Layout 2 — rectangular grid */
.stage--grid {
  display: grid; gap: 10px; padding: 8px; width: 100%; height: 100%;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  align-content: center; justify-content: center; overflow: auto;
}
.g-cell {
  position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden;
  background: #0b0b0f; border: 2px solid transparent;
  display: flex; align-items: center; justify-content: center;
}
.g-cell.speaking { border-color: #23a55a; }
.g-avwrap { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.g-av {
  width: 72px; height: 72px; border-radius: 50%; overflow: hidden;
  background: rgba(0,0,0,.35); color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700;
}
.g-av img { width: 100%; height: 100%; object-fit: cover; }
.g-name {
  position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 5px;
  max-width: calc(100% - 16px); padding: 3px 8px; border-radius: 6px;
  background: rgba(0,0,0,.65); color: #fff; font-size: 12px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.g-live {
  position: absolute; right: 8px; top: 8px; padding: 2px 7px; border-radius: 5px;
  background: #f23f43; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: .04em;
}
.g-mute {
  position: absolute; right: 8px; bottom: 8px; width: 22px; height: 22px; border-radius: 50%;
  background: #f23f43; color: #fff; display: flex; align-items: center; justify-content: center;
}
</style>
```

- [ ] **Step 2: Confirm `colorForUsername` is exported**

Run: `grep -n "export const colorForUsername" src/composables/useAvatar.ts`
Expected: one match. If it's not a named export, adjust the import in `CallStage.vue` to match its actual export (it is used as `colorForUsername(username)` returning a CSS color string).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/voice/CallStage.vue
git commit -m "feat(voice): CallStage — avatar layout + video grid"
```

---

### Task 6: Wire `CallBar` — compose `CallStage`, activate camera/screen buttons

Replace the inline in-call stage markup with `CallStage`, and make the camera + screen-share buttons real.

**Files:**
- Modify: `src/components/voice/CallBar.vue`

**Interfaces:**
- Consumes: `useVoiceMedia` (Task 2), `CallStage` (Task 5).

- [ ] **Step 1: Import media + CallStage and add computed video list**

In the `<script setup>` of `src/components/voice/CallBar.vue`:

Add to the icon import, `PhVideoCamera`:
```ts
import { PhMicrophone, PhMicrophoneSlash, PhPhoneX, PhVideoCamera, PhVideoCameraSlash, PhScreencast, PhDotsThree, PhCaretDown, PhPhoneCall, PhX } from '@phosphor-icons/vue'
```
Add imports:
```ts
import CallStage from './CallStage.vue'
import { useVoiceMedia } from '@/composables/useVoiceMedia'
```
Add to the destructure:
```ts
const { voice, connect, leave, toggleMute } = useVoice()
const { media, toggleCamera, toggleScreenShare } = useVoiceMedia()
```
Add a computed for the video list (place near `stageTiles`):
```ts
import { computed } from 'vue'   // already imported; keep single import
const videoList = computed(() => [...media.videoTracks.values()])
```
(`computed` is already imported at the top of the file — do not add a duplicate import; reuse the existing one.)

- [ ] **Step 2: Replace the in-call stage markup with `CallStage`**

In the template, replace the in-call stage block (currently):
```html
      <div class="cb-stage">
        <div v-for="p in stageTiles" :key="p.id" class="cb-tile">
          <div class="cb-av" :class="{ speaking: p.speaking }">
            <img v-if="p.avatar" :src="p.avatar" :alt="p.name" />
            <template v-else>{{ initial(p.name) }}</template>
            <span v-if="p.muted" class="cb-mute"><PhMicrophoneSlash :size="13" weight="fill" /></span>
          </div>
          <span class="cb-name">{{ p.name }}</span>
        </div>
      </div>
```
with:
```html
      <CallStage class="cb-callstage" :tiles="stageTiles" :videos="videoList" />
```
(Leave the **ongoing** block's `cb-stage` markup untouched — only the in-call stage changes.)

- [ ] **Step 3: Wire the camera and screen-share buttons**

Replace the camera button + chevron (currently the `cb-cam` button and its chevron):
```html
          <button class="cb-b cb-cam" title="Camera — coming soon"><PhVideoCameraSlash :size="20" weight="fill" /></button>
          <button class="cb-chev" disabled title="Video settings — coming soon"><PhCaretDown :size="12" weight="bold" /></button>
```
with:
```html
          <button class="cb-b cb-cam" :class="{ on: media.localCamOn }" :title="media.localCamOn ? 'Turn off camera' : 'Turn on camera'" @click="toggleCamera">
            <component :is="media.localCamOn ? PhVideoCamera : PhVideoCameraSlash" :size="20" weight="fill" />
          </button>
          <button class="cb-chev" disabled title="Video settings — coming soon"><PhCaretDown :size="12" weight="bold" /></button>
```
Replace the screen-share button (currently `cb-share`):
```html
          <button class="cb-b cb-share" title="Screen share — coming soon"><PhScreencast :size="20" weight="fill" /></button>
```
with:
```html
          <button class="cb-b cb-share" :class="{ on: media.localScreenOn }" :title="media.localScreenOn ? 'Stop sharing' : 'Share your screen'" @click="toggleScreenShare">
            <PhScreencast :size="20" weight="fill" />
          </button>
```

- [ ] **Step 4: Add active-state + grow styles**

In the scoped `<style>` of `CallBar.vue`, add:
```css
/* Active camera / screen share — green like Discord */
.cb-b.on { background: #248046; color: #fff; }
.cb-b.on:hover:not(:disabled) { background: #1a6334; }

/* When video is on the stage, let the call bar grow to fill the chat column */
.callbar.has-video { flex: 1 1 auto; min-height: 0; }
.cb-callstage { width: 100%; }
.callbar.has-video .cb-callstage { flex: 1 1 auto; min-height: 0; }
```
And make `.callbar` a growable flex context by binding the class. Change the root element:
```html
  <div v-if="visible" class="callbar" :class="{ 'has-video': inCall && videoList.length }">
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Manual — self camera + screen tiles**

In the preview, start a call (single account is fine here). Click the camera button: it turns green and your own camera tile appears in the grid. Click screen share: pick a window/screen → your screen tile appears with a `LIVE` badge (two tiles if camera is also on). Click each again to turn off; tiles disappear and the green clears. Cancel the screen picker → button stays off, no error toast in console beyond the expected warning.

- [ ] **Step 7: Commit**

```bash
git add src/components/voice/CallBar.vue
git commit -m "feat(voice): wire camera + screen share buttons; render CallStage"
```

---

### Task 7: `ChatApp` stage layout + end-to-end verification

Ensure the growing stage and the message list share the chat column sensibly, then run the two-account verification gate.

**Files:**
- Modify: `src/views/ChatApp.vue` (CSS only)

**Interfaces:**
- Consumes: the `.callbar.has-video` growth from Task 6.

- [ ] **Step 1: Let the message list yield space to the stage**

The chat column is `.chat { display:flex; flex-direction:column }` with children: `.chat-header` (fixed 48px), `CallBar` (`.callbar`), and `MessageList` (`.ml { flex:1 }`). When the call bar grows (`has-video`), the message list must be allowed to shrink rather than force a scroll war.

In `src/views/ChatApp.vue`, in the `<style>` where `.chat` rules live (near line 2151), add:
```css
/* With video on the call stage, split the column: stage takes the majority,
   messages keep a usable minimum and stay scrollable. */
.chat:has(.callbar.has-video) .ml { flex: 0 1 34%; min-height: 120px; }
```
(`:has()` is supported in all current evergreen browsers Skycord targets. The rule only applies while a video call is on-screen; otherwise the message list keeps its normal `flex:1`.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Two-account verification gate**

Preview running (client `:5173`, API `:3001`). Two signed-in profiles, in a DM call together:

1. A turns on **camera** → B sees A's camera tile live; B turns on camera → A sees B's. **Both directions.**
2. A **shares screen** → B sees A's screen tile with the `LIVE` badge.
3. A has **camera + screen at once** → B sees **two** A tiles (camera cover-fit, screen contain-fit).
4. A **hangs up** → A's local camera light and screen capture stop; both A tiles vanish from B's grid; B is still in the call.
5. Non-video participant shows an **avatar tile** on an accent background; **speaking** shows a green border.
6. Briefly disable A's network mid-call, restore it → A self-heals back into the audio call and returns **dark** (camera/screen NOT auto-republished).

**Gate:** step 1 (both-way camera) and step 3 (simultaneous camera + screen on one person) both pass. If any step fails, debug before marking the plan complete — do not paper over a failing step.

- [ ] **Step 4: Commit**

```bash
git add src/views/ChatApp.vue
git commit -m "feat(voice): grow call stage over messages when video is present"
```

---

## Self-Review

- **Spec coverage:** §2 approach (extend LiveKit) → Tasks 1–3. §3 track identity/subscribe/shared handle → Tasks 1–3. §4 state & actions → Task 2. §5 layouts → Task 5. §6 file manifest → all tasks (1:1 with the table). §7 control wiring → Task 6. §8 error handling (camera denied revert, picker cancel no-op, self-heal no-republish, deafen audio-only, adaptiveStream/dynacast already on) → Tasks 2, 3, 6. §9 testing → per-task build + Task 7 gate. `getDisplayMedia` HTTPS constraint: surfaced via the `console.warn` + no-throw catch in Task 2; a user-facing toast is not yet wired (no toast utility confirmed in-repo) — acceptable for P1 since the preview is a secure context; note left for P2. Screen-audio pref → Task 2.
- **Placeholders:** none — every code step carries full code; Task 3 Step 5 intentionally defers live-map inspection to Task 6 (where a UI button exists) rather than inventing a throwaway harness.
- **Type consistency:** `VideoTrackInfo` shape identical in Task 2 (definition), Task 5 (import + `cells`), Task 6 (`videoList`). `media` fields (`localCamOn`, `localScreenOn`, `videoTracks`) consistent across Tasks 2/6. `getRoom`/`setRoom` consistent across Tasks 1/2/3. `toggleCamera`/`toggleScreenShare`/`stopMedia`/`addRemoteVideo`/`removeRemoteVideo` names identical between definition (Task 2) and use (Tasks 3/6).

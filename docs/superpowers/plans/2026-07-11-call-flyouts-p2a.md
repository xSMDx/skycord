# Call Flyouts + Speaking Latency (P2-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working Discord-style flyout menus on the call bar (mic ▾, camera ▾, ⋯) with live device switching, plus a near-instant local speaking ring.

**Architecture:** One anchored popover shell (`CallFlyout.vue`) + three content flyouts composed on it. A new `useCallDevices` composable owns device enumeration and LIVE switching (LiveKit `room.switchActiveDevice`). The local speaking ring runs a WebAudio analyser over the existing LiveKit mic track inside `useVoice`. View prefs (`showOwnCamera`, `showNonVideo`) persist in `useVoiceSettings` and filter `CallStage`'s grid.

**Tech Stack:** Vue 3 `<script setup>` + TS, livekit-client ^2.20, Phosphor icons, WebAudio API.

## Global Constraints

- **No test runner.** Per-task verification = `npm run build` clean from `H:\projects\sykord` + targeted manual preview checks. Commit per task.
- **Branch:** continue committing on `video-screenshare` (P1 lives there, unmerged; user approved continuing).
- Working tree has unrelated dirty files (`graphify-out/*`, `.env`) — never touch or commit them.
- **UA button-bevel gotcha:** any new SFC with `<button>`s needs a `button { border: none; }` (or per-class) reset in its styles.
- **No nested `<button>` elements** (invalid HTML): interactive rows that contain a toggle render the row as a `<div class="fr">` with `@click`, and the visual toggle as a `<span class="fr-tog">`.
- **Existing semantics preserved:** the settings-page Mic Test (monitor + deafen side-effects) is untouched; `inputVolume` still only affects the Mic Test (audio-pipeline wave later); mic capture options still come from `micCaptureOptions()` at enable time.
- Flyout device "▸" submenus are **inline expanding sections**, not nested popovers.
- Empty deviceId (`''` = Default) → persist only, never call `switchActiveDevice` with it.
- livekit-client APIs used: `room.switchActiveDevice('audioinput'|'audiooutput'|'videoinput', deviceId)`, `localParticipant.getTrackPublication(Track.Source.Microphone|Camera)`, `.track.mediaStreamTrack`, `Track.Source`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/composables/useCallDevices.ts` (new) | Device lists (`mics/speakers/cameras`), `refreshDevices`, live-switch helpers. |
| `src/components/voice/CallFlyout.vue` (new) | Anchored popover shell: fixed backdrop, upward panel, Esc/outside close; global `.fr*` row primitives. |
| `src/components/voice/MicFlyout.vue` (new) | Input/Output device sections, volumes, live level meter, Deafen, Voice Settings row. |
| `src/components/voice/CameraFlyout.vue` (new) | Camera device section, inline Preview, Video Settings row. |
| `src/components/voice/MoreFlyout.vue` (new) | Show My Own Camera / Show Non-Video Participants toggles, Voice & Video Settings row. |
| `src/components/voice/CallBar.vue` (modify) | Chevrons/⋯ open the flyouts; `open-settings` emit. |
| `src/views/ChatApp.vue` (modify) | `@open-settings` → `showSettings = true`. |
| `src/composables/useVoiceSettings.ts` (modify) | + `showOwnCamera: true`, `showNonVideo: true`. |
| `src/composables/useVoice.ts` (modify) | Local speaking analyser (start on connect, stop on teardown/cleanup); ActiveSpeakersChanged preserves local. |
| `src/composables/useVoiceMedia.ts` (modify) | `export` keyFor. |
| `src/components/voice/CallStage.vue` (modify) | Grid filters from prefs; import `keyFor`; ring transition. |

---

### Task 1: `useCallDevices` composable + `CallFlyout` shell

**Files:**
- Create: `src/composables/useCallDevices.ts`
- Create: `src/components/voice/CallFlyout.vue`

**Interfaces:**
- Consumes: `getRoom()` (voiceRoom), `setVoiceSettings` (useVoiceSettings), `useVoice().applyOutput`.
- Produces:
  - `useCallDevices()` → `{ devices, mics, speakers, cameras, supportsSinkId, refreshDevices, deviceLabel, setMicDevice, setSpeakerDevice, setCameraDevice }`
  - `<CallFlyout @close>` — slot-based panel; global row classes `.fr`, `.fr.static`, `.fr-sep`, `.fr-label`, `.fr-sub`, `.fr-slider`, `.fr-check`, `.fr-tog` available to slotted content.

- [ ] **Step 1: Create `src/composables/useCallDevices.ts`**

```ts
/**
 * useCallDevices — device enumeration + LIVE switching for the call flyouts.
 * Persists choices via useVoiceSettings and applies them to the active LiveKit
 * room immediately (switchActiveDevice), unlike the settings page which only
 * applies at the next capture.
 */
import { ref, computed } from 'vue'
import { getRoom } from './voiceRoom'
import { setVoiceSettings } from './useVoiceSettings'
import { useVoice } from './useVoice'

const { applyOutput } = useVoice()

export const devices = ref<MediaDeviceInfo[]>([])
export const mics     = computed(() => devices.value.filter(d => d.kind === 'audioinput'))
export const speakers = computed(() => devices.value.filter(d => d.kind === 'audiooutput'))
export const cameras  = computed(() => devices.value.filter(d => d.kind === 'videoinput'))
export const supportsSinkId = typeof (HTMLMediaElement.prototype as any).setSinkId === 'function'

export const refreshDevices = async () => {
  try { devices.value = await navigator.mediaDevices.enumerateDevices() } catch { /* denied */ }
}
export const deviceLabel = (d: MediaDeviceInfo, fallback: string) => d.label || fallback

// Persist + live-switch. Empty id = "Default": persist only — the default
// device is whatever the next capture resolves; LiveKit needs a concrete id.
export const setMicDevice = async (id: string) => {
  setVoiceSettings({ inputDeviceId: id })
  const r = getRoom()
  if (r && id) await r.switchActiveDevice('audioinput', id).catch(() => {})
}
export const setSpeakerDevice = (id: string) => {
  setVoiceSettings({ outputDeviceId: id })
  applyOutput()
}
export const setCameraDevice = async (id: string) => {
  setVoiceSettings({ cameraDeviceId: id })
  const r = getRoom()
  if (r?.localParticipant.isCameraEnabled && id) await r.switchActiveDevice('videoinput', id).catch(() => {})
}

export const useCallDevices = () => ({
  devices, mics, speakers, cameras, supportsSinkId,
  refreshDevices, deviceLabel, setMicDevice, setSpeakerDevice, setCameraDevice,
})
```

- [ ] **Step 2: Create `src/components/voice/CallFlyout.vue`**

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
// Anchored popover for call-bar controls. The parent wraps the anchor button in
// a position:relative container and v-if's this component inside it. The panel
// opens UPWARD, centered on the anchor. A fixed backdrop catches outside
// clicks; Esc closes too.
const emit = defineEmits<{ close: [] }>()
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div>
    <div class="fly-backdrop" @mousedown="emit('close')" @contextmenu.prevent />
    <div class="fly" @click.stop>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.fly-backdrop { position: fixed; inset: 0; z-index: 8000; }
.fly {
  position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%);
  z-index: 8001; min-width: 236px; max-height: 62vh; overflow-y: auto;
  background: var(--bg-floor); border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 6px;
  box-shadow: 0 8px 32px rgba(0,0,0,.85);
  animation: fly-pop .12s cubic-bezier(.4,0,.2,1);
}
@keyframes fly-pop {
  from { opacity: 0; transform: translateX(-50%) scale(.94) translateY(4px); }
  to   { opacity: 1; transform: translateX(-50%) scale(1)   translateY(0); }
}
</style>

<!-- Row primitives are intentionally UNSCOPED (global): slot content belongs to
     each flyout's own scope, so shared row styles can't live in a scoped block
     here. Prefixed classes keep the global footprint safe. -->
<style>
.fly .fr {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; padding: 8px 10px; border: none; background: none; text-align: left;
  font-size: 13.5px; font-weight: 500; color: var(--text-1); border-radius: 5px;
  cursor: pointer; box-sizing: border-box;
}
.fly .fr:hover { background: var(--accent); color: #fff; }
.fly .fr:hover .fr-sub { color: rgba(255,255,255,.8); }
.fly .fr:disabled { opacity: .45; cursor: not-allowed; }
.fly .fr:disabled:hover { background: none; color: var(--text-1); }
.fly .fr.static, .fly .fr.static:hover { background: none; color: var(--text-1); cursor: default; }
.fly .fr-sep   { height: 1px; background: rgba(255,255,255,.08); margin: 4px 2px; }
.fly .fr-label {
  display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3); padding: 6px 10px 2px;
}
.fly .fr-sub {
  display: block; font-size: 11.5px; font-weight: 400; color: var(--text-3);
  margin-top: 1px; max-width: 190px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fly .fr-slider { width: 100%; accent-color: var(--accent); cursor: pointer; }
.fly .fr-check  { color: #23a55a; flex-shrink: 0; }
.fly .fr:hover .fr-check { color: #fff; }
.fly .fr-tog {
  flex-shrink: 0; width: 38px; height: 20px; border-radius: 10px;
  background: rgba(128,132,142,.5); position: relative; transition: background .15s; display: inline-block;
}
.fly .fr-tog.on { background: #23a55a; }
.fly .fr-tog > span {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform .15s;
}
.fly .fr-tog.on > span { transform: translateX(18px); }
</style>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useCallDevices.ts src/components/voice/CallFlyout.vue
git commit -m "feat(voice): CallFlyout shell + useCallDevices (live device switching)"
```

---

### Task 2: `MicFlyout` + CallBar mic-chevron wiring + ChatApp open-settings

**Files:**
- Create: `src/components/voice/MicFlyout.vue`
- Modify: `src/components/voice/CallBar.vue`
- Modify: `src/views/ChatApp.vue` (one attribute)

**Interfaces:**
- Consumes: `CallFlyout`, `useCallDevices` (Task 1), `useVoice` (`voice`, `toggleDeafen`, `applyOutput`), `useVoiceSettings`, `getRoom`, `Track.Source.Microphone`.
- Produces: `<MicFlyout @close @open-settings />`; CallBar emits `openSettings: []` (kebab `open-settings` in templates); ChatApp handles it.

- [ ] **Step 1: Create `src/components/voice/MicFlyout.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { PhCaretRight, PhCheck, PhGear } from '@phosphor-icons/vue'
import { Track } from 'livekit-client'
import CallFlyout from './CallFlyout.vue'
import { useCallDevices } from '@/composables/useCallDevices'
import { useVoiceSettings } from '@/composables/useVoiceSettings'
import { useVoice } from '@/composables/useVoice'
import { getRoom } from '@/composables/voiceRoom'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const { mics, speakers, supportsSinkId, refreshDevices, deviceLabel, setMicDevice, setSpeakerDevice } = useCallDevices()
const { voiceSettings, setVoiceSettings } = useVoiceSettings()
const { voice, toggleDeafen, applyOutput } = useVoice()

const openSection = ref<'' | 'input' | 'output'>('')
const toggleSection = (s: 'input' | 'output') => { openSection.value = openSection.value === s ? '' : s }

const onInputVolume  = (e: Event) => setVoiceSettings({ inputVolume: +(e.target as HTMLInputElement).value })
const onOutputVolume = (e: Event) => { setVoiceSettings({ outputVolume: +(e.target as HTMLInputElement).value }); applyOutput() }

const currentMicLabel = () => {
  const d = mics.value.find(x => x.deviceId === voiceSettings.inputDeviceId)
  return d ? deviceLabel(d, 'Microphone') : 'Default'
}
const currentSpkLabel = () => {
  const d = speakers.value.find(x => x.deviceId === voiceSettings.outputDeviceId)
  return d ? deviceLabel(d, 'Speaker') : 'Default'
}

// Live input level — reads the EXISTING LiveKit mic track through an analyser.
// No second getUserMedia, no monitor loopback, no deafen side effects (that's
// the settings page's Mic Test, deliberately untouched).
const level = ref(0)
let ctx: AudioContext | null = null
let raf = 0
onMounted(async () => {
  await refreshDevices()
  const t = getRoom()?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
  if (!t) return
  try {
    ctx = new AudioContext()
    await ctx.resume()
    const src = ctx.createMediaStreamSource(new MediaStream([t]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    src.connect(analyser)   // analysis only — never connect to destination
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
      level.value = Math.min(1, (peak / 128) * 1.6)
      raf = requestAnimationFrame(tick)
    }
    tick()
  } catch { /* meter stays idle */ }
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}) })
</script>

<template>
  <CallFlyout @close="emit('close')">
    <button class="fr" @click="toggleSection('input')">
      <span>Input Device<span class="fr-sub">{{ currentMicLabel() }}</span></span>
      <PhCaretRight :size="13" weight="bold" :style="openSection==='input' ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="openSection==='input'">
      <button class="fr" @click="setMicDevice('')">
        <span>Default</span><PhCheck v-if="!voiceSettings.inputDeviceId" class="fr-check" :size="15" weight="bold" />
      </button>
      <button v-for="(d,i) in mics" :key="d.deviceId" class="fr" @click="setMicDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Microphone ${i+1}`) }}</span>
        <PhCheck v-if="voiceSettings.inputDeviceId===d.deviceId" class="fr-check" :size="15" weight="bold" />
      </button>
    </template>

    <button class="fr" :disabled="!supportsSinkId" @click="toggleSection('output')">
      <span>Output Device<span class="fr-sub">{{ currentSpkLabel() }}</span></span>
      <PhCaretRight :size="13" weight="bold" :style="openSection==='output' ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="openSection==='output'">
      <button class="fr" @click="setSpeakerDevice('')">
        <span>Default</span><PhCheck v-if="!voiceSettings.outputDeviceId" class="fr-check" :size="15" weight="bold" />
      </button>
      <button v-for="(d,i) in speakers" :key="d.deviceId" class="fr" @click="setSpeakerDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Speaker ${i+1}`) }}</span>
        <PhCheck v-if="voiceSettings.outputDeviceId===d.deviceId" class="fr-check" :size="15" weight="bold" />
      </button>
    </template>

    <div class="fr-sep" />
    <span class="fr-label">Input Volume — {{ voiceSettings.inputVolume }}%</span>
    <div class="fr static"><input class="fr-slider" type="range" min="0" max="100" :value="voiceSettings.inputVolume" @input="onInputVolume" /></div>
    <span class="fr-label">Input Level</span>
    <div class="fr static"><div class="mf-meter"><div class="mf-fill" :style="{ width: (level*100).toFixed(0) + '%' }" /></div></div>
    <span class="fr-label">Output Volume — {{ voiceSettings.outputVolume }}%</span>
    <div class="fr static"><input class="fr-slider" type="range" min="0" max="100" :value="voiceSettings.outputVolume" @input="onOutputVolume" /></div>

    <div class="fr-sep" />
    <div class="fr" role="button" @click="toggleDeafen()">
      <span>Deafen</span>
      <span class="fr-tog" :class="{ on: voice.localDeafened }"><span /></span>
    </div>
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Voice Settings</span><PhGear :size="15" weight="fill" />
    </button>
  </CallFlyout>
</template>

<style scoped>
.mf-meter { width: 100%; height: 8px; border-radius: 4px; background: var(--bg-input); overflow: hidden; }
.mf-fill  { height: 100%; background: linear-gradient(90deg, #23a55a, #f0b232 70%, #ed4245); transition: width .05s linear; }
</style>
```

- [ ] **Step 2: Wire the mic chevron in `CallBar.vue`**

In `<script setup>` add imports + menu state (place after the `onShare` handler):

```ts
import MicFlyout from './MicFlyout.vue'

const openMenu = ref<'' | 'mic' | 'cam' | 'more'>('')
const toggleMenu = (m: 'mic' | 'cam' | 'more') => { openMenu.value = openMenu.value === m ? '' : m }
```

(`ref` must be added to the existing vue import: `import { computed, ref } from 'vue'`.)

Extend the emits declaration:
```ts
const emit = defineEmits<{ dismiss: []; toast: [msg: string]; openSettings: [] }>()
```

In the template, replace the mic split (the first `.cb-split` div) with:

```html
          <div class="cb-split" :class="{ menuopen: openMenu === 'mic' }">
            <button class="cb-b cb-mic" :class="{ off: voice.localMuted }" :title="voice.localMuted ? 'Unmute' : 'Mute'" @click="toggleMute">
              <component :is="voice.localMuted ? PhMicrophoneSlash : PhMicrophone" :size="20" weight="fill" />
            </button>
            <button class="cb-chev" title="Audio settings" @click="toggleMenu('mic')"><PhCaretDown :size="12" weight="bold" /></button>
            <MicFlyout v-if="openMenu === 'mic'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
```

Add to the scoped styles (after the `.cb-split` rules):
```css
.cb-split { position: relative; }
.cb-split.menuopen { background: rgba(255,255,255,.08); }
```
(The first declaration merges with the existing `.cb-split` rule — add `position: relative;` to that existing rule instead of duplicating the selector.)

- [ ] **Step 3: ChatApp handles `open-settings`**

In `src/views/ChatApp.vue`, on the `<CallBar … @toast="showToast" />` usage, add:
```html
            @open-settings="showSettings = true"
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Manual check**

Preview (`127.0.0.1:5173`, in a call): mic ▾ opens the flyout upward; device sections expand inline with green checks; level meter moves when speaking; Deafen toggles; Voice Settings opens the settings modal; Esc and outside-click close.

- [ ] **Step 6: Commit**

```bash
git add src/components/voice/MicFlyout.vue src/components/voice/CallBar.vue src/views/ChatApp.vue
git commit -m "feat(voice): mic flyout — devices, volumes, live meter, deafen"
```

---

### Task 3: `CameraFlyout` + camera-chevron wiring

**Files:**
- Create: `src/components/voice/CameraFlyout.vue`
- Modify: `src/components/voice/CallBar.vue`

**Interfaces:**
- Consumes: `CallFlyout`, `useCallDevices` (`cameras`, `setCameraDevice`, `refreshDevices`, `deviceLabel`), `useVoiceMedia().media`, `getRoom`, `Track.Source.Camera`.
- Produces: `<CameraFlyout @close @open-settings />`.

- [ ] **Step 1: Create `src/components/voice/CameraFlyout.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { PhCaretRight, PhCheck, PhGear, PhEye, PhEyeSlash } from '@phosphor-icons/vue'
import { Track } from 'livekit-client'
import CallFlyout from './CallFlyout.vue'
import { useCallDevices } from '@/composables/useCallDevices'
import { useVoiceSettings } from '@/composables/useVoiceSettings'
import { useVoiceMedia } from '@/composables/useVoiceMedia'
import { getRoom } from '@/composables/voiceRoom'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const { cameras, refreshDevices, deviceLabel, setCameraDevice } = useCallDevices()
const { voiceSettings } = useVoiceSettings()
const { media } = useVoiceMedia()

const showDevices = ref(false)
const currentCamLabel = () => {
  const d = cameras.value.find(x => x.deviceId === voiceSettings.cameraDeviceId)
  return d ? deviceLabel(d, 'Camera') : 'Default'
}

// Inline preview: reuse the LIVE camera track when publishing; otherwise open a
// temporary capture that is stopped when the preview or flyout closes.
const previewing = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)
let tempStream: MediaStream | null = null

const startPreview = async () => {
  const live = getRoom()?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack
  try {
    if (live) {
      if (videoEl.value) videoEl.value.srcObject = new MediaStream([live])
    } else {
      tempStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: voiceSettings.cameraDeviceId || undefined },
      })
      if (videoEl.value) videoEl.value.srcObject = tempStream
    }
    await videoEl.value?.play().catch(() => {})
    previewing.value = true
  } catch { previewing.value = false }
}
const stopPreview = () => {
  tempStream?.getTracks().forEach(t => t.stop()); tempStream = null
  if (videoEl.value) videoEl.value.srcObject = null
  previewing.value = false
}
const togglePreview = () => { previewing.value ? stopPreview() : startPreview() }

onMounted(refreshDevices)
onBeforeUnmount(stopPreview)
</script>

<template>
  <CallFlyout @close="emit('close')">
    <button class="fr" @click="showDevices = !showDevices">
      <span>Camera<span class="fr-sub">{{ currentCamLabel() }}</span></span>
      <PhCaretRight :size="13" weight="bold" :style="showDevices ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="showDevices">
      <button class="fr" @click="setCameraDevice('')">
        <span>Default</span><PhCheck v-if="!voiceSettings.cameraDeviceId" class="fr-check" :size="15" weight="bold" />
      </button>
      <button v-for="(d,i) in cameras" :key="d.deviceId" class="fr" @click="setCameraDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Camera ${i+1}`) }}</span>
        <PhCheck v-if="voiceSettings.cameraDeviceId===d.deviceId" class="fr-check" :size="15" weight="bold" />
      </button>
    </template>

    <div class="fr-sep" />
    <button class="fr" @click="togglePreview">
      <span>{{ previewing ? 'Hide Preview' : 'Preview Camera' }}<span v-if="media.localCamOn" class="fr-sub">Showing your live camera</span></span>
      <component :is="previewing ? PhEyeSlash : PhEye" :size="15" weight="fill" />
    </button>
    <div v-show="previewing" class="cf-prevbox">
      <video ref="videoEl" class="cf-video" muted playsinline />
    </div>

    <div class="fr-sep" />
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Video Settings</span><PhGear :size="15" weight="fill" />
    </button>
  </CallFlyout>
</template>

<style scoped>
.cf-prevbox {
  margin: 4px 2px; border-radius: 6px; overflow: hidden;
  background: #000; aspect-ratio: 16 / 9;
}
.cf-video { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
```

- [ ] **Step 2: Wire the camera chevron in `CallBar.vue`**

Add the import next to MicFlyout's:
```ts
import CameraFlyout from './CameraFlyout.vue'
```

Replace the camera split (the second `.cb-split` div) with:

```html
          <div class="cb-split" :class="{ menuopen: openMenu === 'cam' }">
            <button class="cb-b cb-cam" :disabled="!joinedHere" :class="{ on: media.localCamOn }" :title="!joinedHere ? 'Connecting…' : (media.localCamOn ? 'Turn off camera' : 'Turn on camera')" @click="onCamera">
              <component :is="media.localCamOn ? PhVideoCamera : PhVideoCameraSlash" :size="20" weight="fill" />
            </button>
            <button class="cb-chev" :disabled="!joinedHere" title="Video settings" @click="toggleMenu('cam')"><PhCaretDown :size="12" weight="bold" /></button>
            <CameraFlyout v-if="openMenu === 'cam'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Manual check**

In a call: camera ▾ opens; device list expands; Preview shows the temp capture when the camera is off, and the live feed when it's on; closing the flyout stops any temp capture (no lingering camera light).

- [ ] **Step 5: Commit**

```bash
git add src/components/voice/CameraFlyout.vue src/components/voice/CallBar.vue
git commit -m "feat(voice): camera flyout — device picker, inline preview"
```

---

### Task 4: `MoreFlyout` + view prefs + CallStage filters

**Files:**
- Modify: `src/composables/useVoiceSettings.ts`
- Create: `src/components/voice/MoreFlyout.vue`
- Modify: `src/components/voice/CallBar.vue`
- Modify: `src/components/voice/CallStage.vue`

**Interfaces:**
- Consumes: `CallFlyout`; `voiceSettings.showOwnCamera` / `.showNonVideo` (added here).
- Produces: `<MoreFlyout @close @open-settings />`; CallStage grid respects both prefs.

- [ ] **Step 1: Add the prefs to `useVoiceSettings.ts`**

Interface (after `screenAudio`):
```ts
  screenAudio:      boolean   // capture system/tab audio when screen sharing
  showOwnCamera:    boolean   // render your own camera tile in the grid
  showNonVideo:     boolean   // render avatar tiles for participants without video
```
DEFAULTS:
```ts
  screenAudio: true,
  showOwnCamera: true, showNonVideo: true,
```

- [ ] **Step 2: Create `src/components/voice/MoreFlyout.vue`**

```vue
<script setup lang="ts">
import { PhGear } from '@phosphor-icons/vue'
import CallFlyout from './CallFlyout.vue'
import { useVoiceSettings } from '@/composables/useVoiceSettings'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const { voiceSettings, setVoiceSettings } = useVoiceSettings()
</script>

<template>
  <CallFlyout @close="emit('close')">
    <div class="fr" role="button" @click="setVoiceSettings({ showOwnCamera: !voiceSettings.showOwnCamera })">
      <span>Show My Own Camera</span>
      <span class="fr-tog" :class="{ on: voiceSettings.showOwnCamera }"><span /></span>
    </div>
    <div class="fr" role="button" @click="setVoiceSettings({ showNonVideo: !voiceSettings.showNonVideo })">
      <span>Show Non-Video Participants</span>
      <span class="fr-tog" :class="{ on: voiceSettings.showNonVideo }"><span /></span>
    </div>
    <div class="fr-sep" />
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Voice &amp; Video Settings</span><PhGear :size="15" weight="fill" />
    </button>
  </CallFlyout>
</template>
```

- [ ] **Step 3: Wire the ⋯ button in `CallBar.vue`**

Add the import:
```ts
import MoreFlyout from './MoreFlyout.vue'
```

Replace the ⋯ button:
```html
          <button class="cb-b cb-more" title="More"><PhDotsThree :size="20" weight="bold" /></button>
```
with a relative wrapper:
```html
          <div class="cb-split" :class="{ menuopen: openMenu === 'more' }">
            <button class="cb-b cb-more" title="More" @click="toggleMenu('more')"><PhDotsThree :size="20" weight="bold" /></button>
            <MoreFlyout v-if="openMenu === 'more'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
```

- [ ] **Step 4: CallStage grid filters**

In `src/components/voice/CallStage.vue`:

Add the import:
```ts
import { voiceSettings } from '@/composables/useVoiceSettings'
```

In the `cells` computed, apply the prefs **in grid composition only** (Layout 1 is untouched because it renders from `tiles`, not `cells`):
- Where per-tile videos are collected: `const mine = props.videos.filter(v => v.participantId === t.id)`, filter out the local camera when hidden:
```ts
    const mine = props.videos.filter(v =>
      v.participantId === t.id &&
      !(v.local && v.source === 'camera' && !voiceSettings.showOwnCamera))
```
- In the `else` branch (avatar cell), only push when allowed:
```ts
    } else if (voiceSettings.showNonVideo) {
      out.push({ kind: 'avatar', key: t.id, name: t.name, speaking: t.speaking, muted: t.muted, avatar: t.avatar })
    }
```
- In the presence-lag fallback loop, add the same own-camera guard:
```ts
    if (!used.has(v) && !(v.local && v.source === 'camera' && !voiceSettings.showOwnCamera)) {
```
Note: a participant whose ONLY video is your hidden own camera then yields no cell for you — that is the intended Discord behavior of "Show My Own Camera: off".

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Manual check**

In a call with your camera on: ⋯ opens; toggling "Show My Own Camera" hides/shows your tile instantly; toggling "Show Non-Video Participants" hides/shows avatar cells; both persist across reload (localStorage).

- [ ] **Step 7: Commit**

```bash
git add src/composables/useVoiceSettings.ts src/components/voice/MoreFlyout.vue src/components/voice/CallBar.vue src/components/voice/CallStage.vue
git commit -m "feat(voice): more-menu flyout — own-camera + non-video visibility prefs"
```

---

### Task 5: Local speaking analyser + ring polish + keyFor carry-in

**Files:**
- Modify: `src/composables/useVoice.ts`
- Modify: `src/composables/useVoiceMedia.ts` (one-word change)
- Modify: `src/components/voice/CallStage.vue`

**Interfaces:**
- Consumes: existing `voice.participants`, `voiceSettings.sensitivity`, `getRoom`, `Track.Source.Microphone`.
- Produces: local participant's `speaking` flag updates near-instantly; `keyFor` exported from useVoiceMedia and imported in CallStage.

- [ ] **Step 1: Export `keyFor`**

In `src/composables/useVoiceMedia.ts` change:
```ts
const keyFor = (identity: string, source: 'camera' | 'screen') => `${identity}:${source}`
```
to:
```ts
export const keyFor = (identity: string, source: 'camera' | 'screen') => `${identity}:${source}`
```

- [ ] **Step 2: Local speaking analyser in `useVoice.ts`**

Add after the `readRtt` function (module scope):

```ts
// ── Local speaking detection ────────────────────────────────────────────────
// LiveKit's ActiveSpeakersChanged round-trips through the server (~300ms+),
// which makes your own ring feel laggy. Run a local analyser over the mic
// track instead: your ring reacts within a frame; remote rings keep the
// server-driven path. Rebinds automatically when the mic track is replaced
// (device switch), and goes quiet when muted/deafened.
let levelCtx: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSrc: MediaStreamAudioSourceNode | null = null
let levelData: Uint8Array | null = null
let levelTrack: MediaStreamTrack | null = null
let levelRaf = 0
let lastLoudAt = 0
const SPEAK_HANGOVER_MS = 250

const setLocalSpeaking = (on: boolean) => {
  const me = voice.participants.find(p => p.local)
  if (me && me.speaking !== on)
    voice.participants = voice.participants.map(p => (p.local ? { ...p, speaking: on } : p))
}

const bindLevelSource = async (t: MediaStreamTrack | null) => {
  levelSrc?.disconnect(); levelSrc = null
  levelAnalyser = null; levelData = null
  levelTrack = t
  if (!t) return
  try {
    if (!levelCtx) levelCtx = new AudioContext()
    await levelCtx.resume()
    levelSrc = levelCtx.createMediaStreamSource(new MediaStream([t]))
    levelAnalyser = levelCtx.createAnalyser()
    levelAnalyser.fftSize = 512
    levelSrc.connect(levelAnalyser)   // analysis only — never to destination
    levelData = new Uint8Array(levelAnalyser.frequencyBinCount)
  } catch { /* ring falls back to server-driven state */ }
}

const levelTick = () => {
  levelRaf = requestAnimationFrame(levelTick)
  const room = getRoom(); if (!room) return
  const t = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack ?? null
  if (t !== levelTrack) { void bindLevelSource(t) }
  if (!levelAnalyser || !levelData) { setLocalSpeaking(false); return }
  levelAnalyser.getByteTimeDomainData(levelData)
  let peak = 0
  for (const v of levelData) peak = Math.max(peak, Math.abs(v - 128))
  // sensitivity 0..100 → byte-peak threshold ~4..44 (higher setting = less sensitive)
  const threshold = 4 + (voiceSettings.sensitivity / 100) * 40
  const now = performance.now()
  if (peak >= threshold) lastLoudAt = now
  setLocalSpeaking(!voice.localMuted && !voice.localDeafened && now - lastLoudAt < SPEAK_HANGOVER_MS)
}

const startLocalLevel = () => { if (!levelRaf) levelTick() }
const stopLocalLevel = () => {
  cancelAnimationFrame(levelRaf); levelRaf = 0
  levelSrc?.disconnect(); levelSrc = null
  levelAnalyser = null; levelData = null; levelTrack = null
  levelCtx?.close().catch(() => {}); levelCtx = null
}
```

- [ ] **Step 3: Start/stop wiring in `useVoice.ts`**

- In `attemptConnect`'s success path, after `statsTimer = setInterval(readRtt, 3000)`, add:
```ts
      startLocalLevel()
```
- In `teardownRoom()`, add `stopLocalLevel()` immediately before `stopMedia()`.
- In `cleanup()`, add `stopLocalLevel()` immediately before its `stopMedia()` line.
- In the `ActiveSpeakersChanged` handler, preserve the analyser-driven local flag — replace:
```ts
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    const ids = new Set(speakers.map(s => s.identity))
    voice.participants = voice.participants.map(p => ({ ...p, speaking: ids.has(p.id) }))
  })
```
with:
```ts
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    const ids = new Set(speakers.map(s => s.identity))
    // Local ring is analyser-driven (instant); server list only updates remotes.
    voice.participants = voice.participants.map(p => (p.local ? p : { ...p, speaking: ids.has(p.id) }))
  })
```

- [ ] **Step 4: CallStage ring polish + keyFor import**

In `src/components/voice/CallStage.vue`:
- Add to the useVoiceMedia type import line: `import { keyFor, type VideoTrackInfo } from '@/composables/useVoiceMedia'` (replacing the existing type-only import).
- Replace the two inline key template literals in the `cells` computed:
  - `key: \`${t.id}:${v.source}\`` → `key: keyFor(t.id, v.source)`
  - `key: \`${v.participantId}:${v.source}\`` → `key: keyFor(v.participantId, v.source)`
- In the styles, add a border transition to grid cells — extend `.g-cell` with:
```css
  transition: border-color .15s;
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Manual check**

In a call: your own ring lights while you speak with no perceptible delay and drops ~250ms after you stop; muting kills it instantly; remote rings unchanged; grid ring fades instead of snapping.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useVoice.ts src/composables/useVoiceMedia.ts src/components/voice/CallStage.vue
git commit -m "feat(voice): instant local speaking ring via analyser; ring transition; keyFor export"
```

---

## Self-Review

- **Spec coverage:** flyout shell + inline submenus (T1), mic menu incl. meter/deafen/settings row (T2), camera menu incl. preview + live switch (T1/T3), ⋯ menu + prefs + grid filters (T4), speaking latency + ring transition + keyFor carry-in (T5), chevron enablement (T2/T3 wiring), `open-settings` (T2). Out-of-scope items match the spec's list.
- **Placeholders:** none — full code in every create/modify step.
- **Type consistency:** `useCallDevices()` return shape matches consumers (T2/T3); `fr-tog` is a `span` everywhere (no nested buttons); `openMenu`/`toggleMenu` names consistent across T2/T3/T4; `keyFor(identity, source)` signature matches both call sites; emits `openSettings: []` consistently kebab-cased `@open-settings` in templates.
- **Known trade-offs recorded:** analyser threshold heuristic (4–44 byte-peak) is a first cut — tunable later; `switchActiveDevice` on the default ('') id is deliberately skipped.

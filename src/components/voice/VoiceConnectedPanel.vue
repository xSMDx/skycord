<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import {
  PhoneOff, Camera, MonitorUp, Phone,
  SignalZero, SignalLow, SignalMedium, SignalHigh, Bug,
} from 'lucide-vue-next'
import { useVoice } from '@/composables/useVoice'
import { useVoiceMedia } from '@/composables/useVoiceMedia'
import { voiceSettings } from '@/composables/useVoiceSettings'
import Sparkline from '@/components/ui/Sparkline.vue'
import { rtc, retainRtcStats, releaseRtcStats, avgPing, outLossPct } from '@/composables/useRtcStats'
import { useApi, type WireMyVoiceServer } from '@/composables/useApi'

// Persistent "Voice Connected" strip above the user panel — stays put while you
// browse other chats, so the call survives navigation. Mute/deafen live in the
// user panel below; this row carries the call-media actions (camera, screen
// share) plus the way back to the call view.
const { voice, leave, switchVoiceServer } = useVoice()
const { media, toggleCamera, toggleScreenShare } = useVoiceMedia()

const emit = defineEmits<{
  returnToCall: []; previewCamera: []; openDebug: []; toast: [msg: string]
}>()

// The popover graphs ping, so stats have to be collecting whenever the panel is
// mounted — not only while hovering, or the graph would be empty every time you
// look at it.
onMounted(retainRtcStats)
onBeforeUnmount(releaseRtcStats)

// Connecting steps, surfaced from the real join lifecycle (useVoice.connectStage).
const STAGE_LABEL: Record<string, string> = {
  'finding-server': 'Finding server…',
  'connecting':     'Connecting…',
  'authenticating': 'Authenticating…',
  'rtc-connecting': 'RTC connecting…',
  'connected':      'Voice Connected',
}

// Quality → Lucide signal icon + colour:
//   signal-high   green  (≤150ms)
//   signal-medium yellow (150–250ms)
//   signal-low    orange (>250ms) / blue while reconnecting
//   signal-zero   red    (no route / failed)
const GREEN = '#23a55a', YELLOW = '#f0b232', ORANGE = '#f0662c', RED = '#f23f43', BLUE = 'var(--accent)'
const q = computed(() => {
  if (voice.connectStage === 'failed') return { icon: SignalZero, color: RED, label: 'Couldn’t connect' }
  if (voice.connecting) {
    // Auto-retry cycle: red "No route" flash, then blue "Trying again…", repeat.
    if (voice.connectStage === 'no-route') return { icon: SignalZero, color: RED,  label: 'No route' }
    if (voice.connectAttempt > 1)          return { icon: SignalLow,  color: BLUE, label: 'Trying again…' }
    return { icon: SignalLow, color: BLUE, label: STAGE_LABEL[voice.connectStage ?? 'connecting'] ?? 'Connecting…' }
  }
  if (voice.quality === 'lost') return { icon: SignalZero, color: RED, label: 'No route' }
  const p = voice.ping
  if (p === null) return { icon: SignalMedium, color: YELLOW, label: 'Voice Connected' }
  if (p > 250)    return { icon: SignalLow,    color: ORANGE, label: 'Voice Connected' }
  if (p > 150)    return { icon: SignalMedium, color: YELLOW, label: 'Voice Connected' }
  return { icon: SignalHigh, color: GREEN, label: 'Voice Connected' }
})

const pingText = computed(() => (voice.ping !== null ? `${voice.ping} ms` : '—'))
const avgText  = computed(() => { const a = avgPing(); return a === null ? '—' : `${a} ms` })
const lossText = computed(() => { const l = outLossPct(); return l === null ? '—' : `${l}%` })
const lossBad  = computed(() => (outLossPct() ?? 0) > 10)
const pingBad  = computed(() => (voice.ping ?? 0) >= 250)

// Media actions only make sense once the room is actually up — publishing
// during the connecting window races the join.
const ready = computed(() => voice.connected)

const onCamera = async () => {
  if (!ready.value) return
  if (!media.localCamOn && voiceSettings.alwaysPreviewVideo) { emit('previewCamera'); return }
  const err = await toggleCamera(); if (err) emit('toast', err)
}
const onShare = async () => {
  if (!ready.value) return
  const err = await toggleScreenShare(); if (err) emit('toast', err)
}

// ── Popover open state ──────────────────────────────────────────────────────
// Hover alone couldn't hold this open long enough to click Debug. Pure
// :hover meant the popover was only alive while the cursor was inside .vcp or
// .vcp-pop, and there's a gap between them — cross it and BOTH selectors fail
// for a frame, so the popover vanished out from under the cursor on its way up.
//
// So: explicit state, with a grace period on the way out (pointer-events stay
// live during it, or moving back in couldn't re-open it), plus a bridge element
// covering the gap. Clicking the strip pins it open, for anyone who'd rather
// not hold a hover at all.
const popOpen   = ref(false)
const popPinned = ref(false)
let popTimer: ReturnType<typeof setTimeout> | null = null
const CLOSE_GRACE_MS = 260

const clearPopTimer = () => { if (popTimer) { clearTimeout(popTimer); popTimer = null } }
const openPop  = () => { clearPopTimer(); popOpen.value = true; void loadVoiceServers() }
const closePop = () => {
  clearPopTimer()
  if (popPinned.value) return
  popTimer = setTimeout(() => { popOpen.value = false; popTimer = null }, CLOSE_GRACE_MS)
}
// ── Which media server this call is on ───────────────────────────────────────
// Fetched when the popover is first opened rather than on mount: most calls
// never have this looked at, and on an instance where nobody has registered a
// server the answer is always the same one.
const myVoiceServers = ref<WireMyVoiceServer[]>([])
const vsLoaded = ref(false)
const { listMyVoiceServers } = useApi()
const loadVoiceServers = async () => {
  if (vsLoaded.value) return
  vsLoaded.value = true
  try { myVoiceServers.value = (await listMyVoiceServers()).voiceServers }
  catch { vsLoaded.value = false }   // let the next open try again
}

// A voice channel's server is a setting of the CHANNEL — moving it from here
// would hand every occupant an edit they were never granted, and would move
// people who are not even in the call yet. A DM or group belongs to the people
// in it, so anyone in one may move it.
const canMove = computed(() => voice.activeKind === 'dm' || voice.activeKind === 'group')

// Hidden entirely when nothing is registered anywhere: there is exactly one
// server the call could be on, and naming it tells nobody anything.
const showVoiceServer = computed(() => myVoiceServers.value.length > 0)

const moving = ref(false)
const onMoveServer = async (id: string) => {
  if (moving.value) return
  moving.value = true
  // Nothing is applied locally. The server announces the move to everyone in
  // the call, US INCLUDED, and the rejoin happens on that single path — so the
  // person who pressed the button and the people who did not take exactly the
  // same route, and a failure leaves nobody moved.
  try { await switchVoiceServer(id || null) }
  catch { emit('toast', 'Could not move the call') }
  finally { moving.value = false }
}

/** Click the strip to pin, click again to release. */
const togglePin = () => {
  popPinned.value = !popPinned.value
  if (popPinned.value) openPop()
  else closePop()
}
const onDebug = () => { popPinned.value = false; popOpen.value = false; clearPopTimer(); emit('openDebug') }

// A pinned popover needs a way out that isn't "find the strip again".
const onDocClick = (e: MouseEvent) => {
  if (!popPinned.value) return
  const el = e.target as HTMLElement
  if (el.closest('.vcp')) return
  popPinned.value = false; popOpen.value = false
}
const onEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && popPinned.value) { popPinned.value = false; popOpen.value = false }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  clearPopTimer()
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <div
    v-if="voice.connected || voice.connecting || voice.connectStage === 'failed'"
    class="vcp" :class="{ 'pop-open': popOpen }"
    @mouseenter="openPop" @mouseleave="closePop"
  >
    <!-- Connection readout, Discord-style. Hover to peek, click the strip to pin. -->
    <div class="vcp-pop" @mouseenter="openPop" @mouseleave="closePop">
      <div class="vcp-pop-tab">Connection</div>

      <Sparkline class="vcp-pop-graph" :data="rtc.series.ping" :height="62"
                 :color="q.color" :fmt-tick="v => String(Math.round(v))" />

      <div class="vcp-pop-server">{{ voice.activeName || 'Voice' }}</div>

      <div v-if="showVoiceServer" class="vcp-pop-row vcp-pop-vs">
        <span>Voice server</span>
        <select v-if="canMove" class="vcp-pop-select" :disabled="moving"
                :value="voice.voiceServer?.id ?? ''"
                @click.stop
                @change="onMoveServer(($event.target as HTMLSelectElement).value)">
          <option value="">Automatic</option>
          <option v-for="v in myVoiceServers" :key="v.id" :value="v.id">{{ v.name }} — {{ v.serverName }}</option>
        </select>
        <!-- A channel call names its server but does not offer to move it. -->
        <strong v-else>{{ voice.voiceServer?.name || '—' }}</strong>
      </div>

      <div class="vcp-pop-row"><span>Average ping</span><strong>{{ avgText }}</strong></div>
      <div class="vcp-pop-row"><span>Last ping</span><strong :class="{ bad: pingBad }">{{ pingText }}</strong></div>
      <div class="vcp-pop-row"><span>Outbound packet loss rate</span><strong :class="{ bad: lossBad }">{{ lossText }}</strong></div>

      <p class="vcp-pop-help">
        You may notice delayed audio at 250 ms or higher. You may sound robotic if your packet
        loss rate is over 10%. If the problem persists, disconnect and try again.
      </p>

      <button class="vcp-pop-btn" @click.stop="onDebug">
        <Bug :size="16" :stroke-width="2" /> Debug
      </button>

      <!-- Discord says "End-to-end encrypted" here. We can't: LiveKit runs as an
           SFU with no e2ee configured, so the server decrypts and re-encrypts
           every stream. Transport encryption is real and is what this claims.
           Swap the wording once E2EE actually ships — see
           docs/superpowers/specs/2026-08-09-e2ee-design.md -->
      <div class="vcp-pop-foot">Encrypted in transit (DTLS-SRTP)</div>
    </div>

    <div class="vcp-top" @click="togglePin">
      <div class="vcp-sig" :class="{ pulse: voice.connecting }" v-tip="q.label" :style="{ color: q.color }">
        <component :is="q.icon" :size="18" :stroke-width="2.5" />
      </div>
      <div class="vcp-meta">
        <span class="vcp-status" :style="{ color: q.color }">{{ q.label }}</span>
        <span v-if="voice.micBlocked && voice.connected" class="vcp-name vcp-warn">Listen-only · mic needs HTTPS</span>
        <span v-else class="vcp-name">{{ voice.connecting ? voice.activeName : `${pingText} · ${voice.activeName}` }}</span>
      </div>
      <button class="vcp-leave" v-tip="voice.connecting ? 'Cancel' : 'Disconnect'" @click.stop="leave"><PhoneOff :size="18" :stroke-width="2.25" /></button>
    </div>

    <!-- Camera · back to call · screen share. The middle slot used to be a
         button crammed into the user panel below, where it squeezed the
         username; this row already had the space for it. -->
    <div class="vcp-controls">
      <button class="vcp-btn" :class="{ on: media.localCamOn }" :disabled="!ready"
              v-tip="media.localCamOn ? 'Turn off camera' : 'Turn on camera'" @click="onCamera">
        <Camera :size="18" :stroke-width="2.25" />
      </button>
      <button class="vcp-btn vcp-back" v-tip="voice.connecting ? 'Connecting…' : 'Back to call'"
              @click="emit('returnToCall')">
        <Phone :size="18" :stroke-width="2.25" />
      </button>
      <button class="vcp-btn" :class="{ on: media.localScreenOn }" :disabled="!ready"
              v-tip="media.localScreenOn ? 'Stop sharing' : 'Share your screen'" @click="onShare">
        <MonitorUp :size="18" :stroke-width="2.25" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.vcp {
  position: relative;
  background: var(--bg-deep); border-top: 1px solid var(--border);
  padding: 8px 8px 6px; display: flex; flex-direction: column; gap: 6px;
  animation: vcp-in .22s cubic-bezier(.4,0,.2,1);
}
/* Kill the default browser button border (the ugly bevel) on every control */
.vcp button { border: none; cursor: pointer; box-sizing: border-box; }
@keyframes vcp-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.vcp-top { display: flex; align-items: center; gap: 8px; cursor: pointer; }
/* Buttons inside the strip keep their own cursor — only the empty space pins. */
.vcp-top button { cursor: pointer; }

/* Signal icon. The bars grow in on connect and lift on hover — a static icon
   in a panel that's reporting a live measurement reads as a dead indicator. */
.vcp-sig {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0;
  transition: color var(--dur-3) var(--ease-out), transform .16s cubic-bezier(.34,1.56,.64,1);
}
.vcp-sig :deep(svg) { overflow: visible; }
/* Lucide draws the bars shortest-first, so staggering by child index animates
   them left-to-right the way a signal meter fills. */
.vcp-sig :deep(path) {
  transform-origin: bottom;
  animation: vcp-bar .34s cubic-bezier(.34,1.56,.64,1) backwards;
}
.vcp-sig :deep(path:nth-child(1)) { animation-delay: 0s; }
.vcp-sig :deep(path:nth-child(2)) { animation-delay: .06s; }
.vcp-sig :deep(path:nth-child(3)) { animation-delay: .12s; }
.vcp-sig :deep(path:nth-child(4)) { animation-delay: .18s; }
@keyframes vcp-bar { from { transform: scaleY(.2); opacity: 0 } to { transform: none; opacity: 1 } }
.vcp:hover .vcp-sig { transform: scale(1.12); }
/* While connecting, whatever's on screen is stale by definition — keep it
   moving so it doesn't read as a settled measurement. */
.vcp-sig.pulse :deep(path) { animation: vcp-bar-loop 1.3s ease-in-out infinite; }
@keyframes vcp-bar-loop { 0%,100% { opacity: .35 } 50% { opacity: 1 } }

.vcp-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.vcp-status { font-size: 13px; font-weight: 700; }
.vcp-name { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vcp-warn { color: #f0b232; }
.vcp-leave {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  background: var(--hover, rgba(255,255,255,.06)); color: var(--text-1);
  display: flex; align-items: center; justify-content: center; transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.vcp-leave:hover { background: #f23f43; color: #fff; transform: translateY(-1px); }

.vcp-controls { display: flex; gap: 6px; }
.vcp-btn {
  flex: 1; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,.06); color: var(--text-2);
  display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.vcp-btn:hover:not(:disabled) { background: rgba(255,255,255,.11); color: var(--text-1); }
.vcp-btn:active:not(:disabled) { transform: scale(.96); }
.vcp-btn.on { background: #248046; color: #fff; }
.vcp-btn:disabled { opacity: .45; cursor: not-allowed; }
.vcp-back { color: #3ba55d; }
.vcp-back:hover { background: rgba(35,165,90,.18); color: #4ade80; }

/* Hover popover — appears above the strip */
.vcp-pop {
  position: absolute; left: 8px; right: 8px; bottom: calc(100% + 6px);
  background: var(--bg-floor); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.5); z-index: 50;
  opacity: 0; transform: translateY(6px); pointer-events: none;
  transition: opacity var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
/* The gap between strip and popover is unhoverable, and crossing it used to
   drop both :hover targets for a frame and close the popover mid-travel. This
   bridges it so the cursor never leaves the component. */
.vcp-pop::after {
  content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 10px;
}
.vcp.pop-open .vcp-pop { opacity: 1; transform: none; pointer-events: auto; }
/* Pointer-events stay live through the closing grace period — otherwise moving
   back toward the popover during the fade can't re-open it. */

.vcp-pop-tab {
  font-size: 13px; font-weight: 700; color: var(--text-1);
  padding-bottom: 8px; margin-bottom: 10px;
  border-bottom: 2px solid var(--accent); display: inline-block;
}
.vcp-pop-graph { margin-bottom: 10px; }
.vcp-pop-server {
  font-size: 12px; font-weight: 700; color: var(--text-1); margin-bottom: 8px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vcp-pop-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--text-3); padding: 2px 0; }
.vcp-pop-row strong { color: var(--text-1); font-weight: 600; font-variant-numeric: tabular-nums; }
.vcp-pop-row strong.bad { color: #f23f43; }
.vcp-pop-vs { align-items: center; }
.vcp-pop-select {
  flex: 1; min-width: 0; max-width: 60%;
  padding: 3px 6px; border-radius: 4px;
  background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-1); font-size: 12px; font-weight: 600;
  outline: none; cursor: pointer;
  text-overflow: ellipsis;
}
.vcp-pop-select:focus { border-color: var(--accent); }
.vcp-pop-select:disabled { opacity: .6; cursor: default; }
.vcp-pop-select option { background: var(--bg-panel); color: var(--text-1); }
.vcp-pop-help { font-size: 11px; line-height: 1.45; color: var(--text-faint); margin: 10px 0 0; }
.vcp-pop-btn {
  width: 100%; margin-top: 10px; height: 38px; border-radius: 8px;
  font-weight: 600;
  background: rgba(255,255,255,.06); color: var(--text-2); font-size: 12px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.vcp-pop-btn:hover { background: var(--accent); color: #fff; }
.vcp-pop-btn:active { transform: scale(.98); }
.vcp-pop-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 10px; color: var(--text-faint); }

@media (prefers-reduced-motion: reduce) {
  .vcp-sig :deep(path) { animation: none; }
  .vcp:hover .vcp-sig { transform: none; }
}
</style>

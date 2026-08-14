<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import {
  PhoneOff, Camera, MonitorUp, Phone,
  SignalZero, SignalLow, SignalMedium, SignalHigh, Bug,
} from 'lucide-vue-next'
import { useVoice } from '@/composables/useVoice'
import { useVoiceMedia } from '@/composables/useVoiceMedia'
import { voiceSettings } from '@/composables/useVoiceSettings'
import Sparkline from '@/components/ui/Sparkline.vue'
import { rtc, retainRtcStats, releaseRtcStats, avgPing, outLossPct } from '@/composables/useRtcStats'

// Persistent "Voice Connected" strip above the user panel — stays put while you
// browse other chats, so the call survives navigation. Mute/deafen live in the
// user panel below; this row carries the call-media actions (camera, screen
// share) plus the way back to the call view.
const { voice, leave } = useVoice()
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
</script>

<template>
  <div v-if="voice.connected || voice.connecting || voice.connectStage === 'failed'" class="vcp">
    <!-- Hover popover: the connection readout, Discord-style -->
    <div class="vcp-pop">
      <div class="vcp-pop-tab">Connection</div>

      <Sparkline class="vcp-pop-graph" :data="rtc.series.ping" :height="62"
                 :color="q.color" :fmt-tick="v => String(Math.round(v))" />

      <div class="vcp-pop-server">{{ voice.activeName || 'Voice' }}</div>

      <div class="vcp-pop-row"><span>Average ping</span><strong>{{ avgText }}</strong></div>
      <div class="vcp-pop-row"><span>Last ping</span><strong :class="{ bad: pingBad }">{{ pingText }}</strong></div>
      <div class="vcp-pop-row"><span>Outbound packet loss rate</span><strong :class="{ bad: lossBad }">{{ lossText }}</strong></div>

      <p class="vcp-pop-help">
        You may notice delayed audio at 250 ms or higher. You may sound robotic if your packet
        loss rate is over 10%. If the problem persists, disconnect and try again.
      </p>

      <button class="vcp-pop-btn" @click.stop="emit('openDebug')">
        <Bug :size="14" :stroke-width="2" /> Debug
      </button>

      <!-- Discord says "End-to-end encrypted" here. We can't: LiveKit runs as an
           SFU with no e2ee configured, so the server decrypts and re-encrypts
           every stream. Transport encryption is real and is what this claims.
           Swap the wording once E2EE actually ships — see
           docs/superpowers/specs/2026-08-09-e2ee-design.md -->
      <div class="vcp-pop-foot">Encrypted in transit (DTLS-SRTP)</div>
    </div>

    <div class="vcp-top">
      <div class="vcp-sig" :class="{ pulse: voice.connecting }" v-tip="q.label" :style="{ color: q.color }">
        <component :is="q.icon" :size="18" :stroke-width="2.5" />
      </div>
      <div class="vcp-meta">
        <span class="vcp-status" :style="{ color: q.color }">{{ q.label }}</span>
        <span v-if="voice.micBlocked && voice.connected" class="vcp-name vcp-warn">Listen-only · mic needs HTTPS</span>
        <span v-else class="vcp-name">{{ voice.connecting ? voice.activeName : `${pingText} · ${voice.activeName}` }}</span>
      </div>
      <button class="vcp-leave" v-tip="voice.connecting ? 'Cancel' : 'Disconnect'" @click="leave"><PhoneOff :size="18" :stroke-width="2.25" /></button>
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

.vcp-top { display: flex; align-items: center; gap: 8px; }

/* Signal icon. The bars grow in on connect and lift on hover — a static icon
   in a panel that's reporting a live measurement reads as a dead indicator. */
.vcp-sig {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex-shrink: 0;
  transition: color .2s, transform .16s cubic-bezier(.34,1.56,.64,1);
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
  display: flex; align-items: center; justify-content: center; transition: background .12s, color .12s, transform .1s;
}
.vcp-leave:hover { background: #f23f43; color: #fff; transform: translateY(-1px); }

.vcp-controls { display: flex; gap: 6px; }
.vcp-btn {
  flex: 1; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,.06); color: var(--text-2);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s, transform .1s;
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
  transition: opacity .14s, transform .14s;
}
/* pointer-events flip so the Debug button inside is actually clickable */
.vcp:hover .vcp-pop, .vcp-pop:hover { opacity: 1; transform: none; pointer-events: auto; }

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
.vcp-pop-help { font-size: 11px; line-height: 1.45; color: var(--text-faint); margin: 10px 0 0; }
.vcp-pop-btn {
  width: 100%; margin-top: 10px; height: 30px; border-radius: 6px;
  background: rgba(255,255,255,.06); color: var(--text-2); font-size: 12px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: background .12s, color .12s;
}
.vcp-pop-btn:hover { background: rgba(255,255,255,.12); color: var(--text-1); }
.vcp-pop-btn:active { transform: scale(.98); }
.vcp-pop-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 10px; color: var(--text-faint); }

@media (prefers-reduced-motion: reduce) {
  .vcp-sig :deep(path) { animation: none; }
  .vcp:hover .vcp-sig { transform: none; }
}
</style>

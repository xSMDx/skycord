<script setup lang="ts">
import { computed } from 'vue'
import { PhPhoneX, PhVideoCamera, PhScreencast } from '@phosphor-icons/vue'
import { useVoice } from '@/composables/useVoice'

// Persistent "Voice Connected" strip above the user panel — stays put while you
// browse other chats, so the call survives navigation. Mute/deafen live in the
// user panel below; this row carries the call-media actions (camera/screenshare),
// matching Discord's voice panel.
const { voice, leave } = useVoice()

// Connection quality → colour + human label. Drives the signal bars + popup.
const QUALITY = {
  excellent: { color: '#23a55a', label: 'Excellent', bars: 4 },
  good:      { color: '#23a55a', label: 'Good',      bars: 3 },
  poor:      { color: '#f0b232', label: 'Poor',      bars: 2 },
  lost:      { color: '#f23f43', label: 'Lost',      bars: 1 },
  unknown:   { color: '#80848e', label: 'Connecting…', bars: 1 },
} as const
const q = computed(() => QUALITY[voice.quality] ?? QUALITY.unknown)
const pingText = computed(() => (voice.ping !== null ? `${voice.ping} ms` : '—'))
</script>

<template>
  <div v-if="voice.connected || voice.connecting" class="vcp">
    <!-- Hover popup (Discord-style connection readout) -->
    <div class="vcp-pop">
      <div class="vcp-pop-head">
        <span class="vcp-pop-dot" :style="{ background: q.color }" />
        <span class="vcp-pop-title" :style="{ color: q.color }">{{ q.label }}</span>
      </div>
      <div class="vcp-pop-row"><span>Ping</span><strong>{{ pingText }}</strong></div>
      <div class="vcp-pop-row"><span>Region</span><strong>{{ voice.activeName || 'Voice' }}</strong></div>
      <div class="vcp-pop-foot">LiveKit · end-to-end media</div>
    </div>

    <div class="vcp-top">
      <!-- Animated signal bars, height + colour reflect quality -->
      <div class="vcp-bars" :title="q.label">
        <i v-for="n in 4" :key="n" :class="{ on: n <= q.bars }" :style="{ background: n <= q.bars ? q.color : undefined, animationDelay: (n * 0.12) + 's' }" />
      </div>
      <div class="vcp-meta">
        <span class="vcp-status" :style="{ color: q.color }">{{ voice.connecting ? 'Connecting…' : 'Voice Connected' }}</span>
        <span v-if="voice.micBlocked && voice.connected" class="vcp-name vcp-warn">Listen-only · mic needs HTTPS</span>
        <span v-else class="vcp-name">{{ voice.connecting ? voice.activeName : `${pingText} · ${voice.activeName}` }}</span>
      </div>
      <button class="vcp-leave" :title="voice.connecting ? 'Cancel' : 'Disconnect'" @click="leave"><PhPhoneX :size="18" weight="fill" /></button>
    </div>

    <div class="vcp-controls">
      <button class="vcp-btn" disabled title="Camera — coming soon">
        <PhVideoCamera :size="18" weight="fill" />
      </button>
      <button class="vcp-btn" disabled title="Screen share — coming soon">
        <PhScreencast :size="18" weight="fill" />
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
@keyframes vcp-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.vcp-top { display: flex; align-items: center; gap: 8px; }

/* Signal bars */
.vcp-bars { display: flex; align-items: flex-end; gap: 2px; height: 18px; flex-shrink: 0; }
.vcp-bars i {
  width: 3px; border-radius: 2px; background: var(--text-faint);
  height: 40%; transition: background .2s;
}
.vcp-bars i:nth-child(1) { height: 35%; }
.vcp-bars i:nth-child(2) { height: 55%; }
.vcp-bars i:nth-child(3) { height: 78%; }
.vcp-bars i:nth-child(4) { height: 100%; }
.vcp-bars i.on { animation: vcp-pulse 1.4s ease-in-out infinite; }
@keyframes vcp-pulse { 0%,100% { transform: scaleY(.78); } 50% { transform: scaleY(1); } }

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

.vcp-controls { display: flex; gap: 8px; }
.vcp-btn {
  flex: 1; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,.06); color: var(--text-2);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s;
}
.vcp-btn:hover:not(:disabled) { background: rgba(255,255,255,.11); color: var(--text-1); }
.vcp-btn:active:not(:disabled) { transform: scale(.96); }
.vcp-btn.on { background: #248046; color: #fff; }
.vcp-btn:disabled { opacity: .45; cursor: not-allowed; }

/* Hover popup — appears above the strip */
.vcp-pop {
  position: absolute; left: 8px; right: 8px; bottom: calc(100% + 6px);
  background: var(--bg-floor); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.5); z-index: 50;
  opacity: 0; transform: translateY(6px); pointer-events: none;
  transition: opacity .14s, transform .14s;
}
.vcp:hover .vcp-pop { opacity: 1; transform: none; }
.vcp-pop-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.vcp-pop-dot { width: 9px; height: 9px; border-radius: 50%; }
.vcp-pop-title { font-size: 13px; font-weight: 700; }
.vcp-pop-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-3); padding: 2px 0; }
.vcp-pop-row strong { color: var(--text-1); font-weight: 600; }
.vcp-pop-foot { margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--border); font-size: 10px; color: var(--text-faint); }
</style>

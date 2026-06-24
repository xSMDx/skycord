<script setup lang="ts">
import { PhMicrophone, PhMicrophoneSlash, PhHeadphones, PhPhoneX, PhVideoCamera, PhScreencast } from '@phosphor-icons/vue'
import { useVoice } from '@/composables/useVoice'

// Shown at the top of the chat when this conversation's call is the active one.
const props = defineProps<{ convId: string }>()
const { voice, leave, toggleMute, toggleDeafen } = useVoice()
const showFor = (id: string) => voice.connected && voice.activeConvId === id
</script>

<template>
  <div v-if="showFor(props.convId)" class="callbar">
    <div class="cb-stage">
      <div v-for="p in voice.participants" :key="p.id" class="cb-tile" :class="{ speaking: p.speaking && !p.muted }">
        <div class="cb-av">{{ (p.name || '?').charAt(0).toUpperCase() }}</div>
        <span class="cb-name">{{ p.name }}<span v-if="p.local"> (you)</span></span>
        <PhMicrophoneSlash v-if="p.muted" class="cb-muted" :size="14" weight="fill" />
      </div>
    </div>

    <div class="cb-controls">
      <button class="cb-btn" :class="{ off: voice.localMuted }" :title="voice.localMuted ? 'Unmute' : 'Mute'" @click="toggleMute">
        <component :is="voice.localMuted ? PhMicrophoneSlash : PhMicrophone" :size="20" weight="fill" />
      </button>
      <button class="cb-btn" :class="{ off: voice.localDeafened }" :title="voice.localDeafened ? 'Undeafen' : 'Deafen'" @click="toggleDeafen">
        <PhHeadphones :size="20" weight="fill" />
      </button>
      <button class="cb-btn" disabled title="Video — coming soon"><PhVideoCamera :size="20" weight="fill" /></button>
      <button class="cb-btn" disabled title="Screen share — coming soon"><PhScreencast :size="20" weight="fill" /></button>
      <button class="cb-btn leave" title="Leave call" @click="leave"><PhPhoneX :size="20" weight="fill" /></button>
    </div>
  </div>
</template>

<style scoped>
.callbar {
  background: var(--bg-floor); border-bottom: 1px solid var(--border);
  padding: 18px 16px 14px; display: flex; flex-direction: column; align-items: center; gap: 16px;
}
.cb-stage { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; }
.cb-tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 18px; border-radius: 12px; background: var(--bg-chat);
  border: 2px solid transparent; min-width: 120px; position: relative;
}
.cb-tile.speaking { border-color: #23a55a; animation: cb-speak 1.2s ease-in-out infinite; }
@keyframes cb-speak { 0%,100% { box-shadow: 0 0 0 0 rgba(35,165,90,.45); } 50% { box-shadow: 0 0 0 6px rgba(35,165,90,0); } }
.cb-av {
  width: 56px; height: 56px; border-radius: 50%; background: var(--accent);
  color: var(--text-on-accent); display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 700;
}
.cb-name { font-size: 13px; color: var(--text-1); font-weight: 600; }
.cb-muted { position: absolute; top: 10px; right: 10px; color: #f23f43; }

.cb-controls { display: flex; gap: 10px; }
.cb-btn {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--bg-chat); color: var(--text-1);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, transform .1s;
}
.cb-btn:hover:not(:disabled) { background: var(--hover-strong); transform: translateY(-1px); }
.cb-btn:active:not(:disabled) { transform: scale(.92); }
.cb-btn:disabled { opacity: .45; cursor: not-allowed; }
.cb-btn.off { background: #f23f43; color: #fff; }
.cb-btn.leave { background: #f23f43; color: #fff; }
.cb-btn.leave:hover { background: #d83c3f; }
</style>

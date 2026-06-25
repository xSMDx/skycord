<script setup lang="ts">
import { computed } from 'vue'
import { PhMicrophone, PhMicrophoneSlash, PhHeadphones, PhPhoneX, PhVideoCamera, PhScreencast, PhPhoneCall, PhCircleNotch, PhX } from '@phosphor-icons/vue'
import { useVoice } from '@/composables/useVoice'

// Persistent call surface at the top of the chat. Shows whenever a call is active
// in THIS conversation — whether or not you've joined — mirroring Discord:
//   • joined      → live participant tiles + full controls
//   • connecting  → "Connecting…" spinner
//   • ongoing     → who's in the call (presence) + a Join button (+ Dismiss for DM)
const props = defineProps<{
  convId: string
  kind: 'dm' | 'group'
  name: string
  // Server-presence participants resolved to display info (incl. you, if joined).
  participants: { id: string; name: string; avatar: string; local: boolean }[]
  dismissed?: boolean
}>()
const emit = defineEmits<{ dismiss: [] }>()

const { voice, connect, leave, toggleMute, toggleDeafen } = useVoice()

const joinedHere     = computed(() => voice.connected  && voice.activeConvId     === props.convId)
const connectingHere = computed(() => voice.connecting && voice.connectingConvId === props.convId)
const callActive     = computed(() => props.participants.length > 0)
// Ongoing call you haven't joined (and haven't dismissed).
const showOngoing    = computed(() => callActive.value && !joinedHere.value && !connectingHere.value && !props.dismissed)
const visible        = computed(() => joinedHere.value || connectingHere.value || showOngoing.value)

// Tiles for the not-joined banner: the others already in the call.
const others = computed(() => props.participants.filter(p => !p.local))
const initial = (n: string) => (n || '?').charAt(0).toUpperCase()
// id → avatar, so joined-mode tiles (driven by live LiveKit participants, which
// don't carry avatars) can show real avatars from server presence.
const avatarById = computed(() => {
  const m: Record<string, string> = {}
  for (const p of props.participants) if (p.avatar) m[p.id] = p.avatar
  return m
})

const join = () => { connect(props.convId, props.kind, props.name).catch(() => {}) }
</script>

<template>
  <div v-if="visible" class="callbar">
    <!-- ── Joined: live tiles + controls ─────────────────────────────────── -->
    <template v-if="joinedHere">
      <div class="cb-stage">
        <div v-for="p in voice.participants" :key="p.id" class="cb-tile" :class="{ speaking: p.speaking && !p.muted }">
          <div class="cb-av"><img v-if="avatarById[p.id]" :src="avatarById[p.id]" :alt="p.name" /><template v-else>{{ initial(p.name) }}</template></div>
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
    </template>

    <!-- ── Connecting: spinner ───────────────────────────────────────────── -->
    <template v-else-if="connectingHere">
      <div class="cb-connecting">
        <PhCircleNotch class="cb-spin" :size="22" weight="bold" />
        <span>Connecting…</span>
        <button class="cb-btn leave cb-cancel" title="Cancel" @click="leave"><PhPhoneX :size="18" weight="fill" /></button>
      </div>
    </template>

    <!-- ── Ongoing call you haven't joined ───────────────────────────────── -->
    <template v-else>
      <div class="cb-stage">
        <div v-for="p in others" :key="p.id" class="cb-tile">
          <div class="cb-av"><img v-if="p.avatar" :src="p.avatar" :alt="p.name" /><template v-else>{{ initial(p.name) }}</template></div>
          <span class="cb-name">{{ p.name }}</span>
        </div>
      </div>
      <div class="cb-ongoing-label">
        {{ others.length === 1 ? `${others[0].name} is in a call` : `${others.length} people in a call` }}
      </div>
      <div class="cb-join-row">
        <button class="cb-join" @click="join"><PhPhoneCall :size="18" weight="fill" /> Join Call</button>
        <button v-if="kind === 'dm'" class="cb-btn cb-dismiss" title="Dismiss" @click="emit('dismiss')"><PhX :size="18" weight="bold" /></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.callbar {
  background: var(--bg-floor); border-bottom: 1px solid var(--border);
  padding: 18px 16px 14px; display: flex; flex-direction: column; align-items: center; gap: 14px;
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
  font-size: 22px; font-weight: 700; overflow: hidden;
}
.cb-av img { width: 100%; height: 100%; object-fit: cover; }
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

/* Connecting state */
.cb-connecting { display: flex; align-items: center; gap: 12px; color: var(--text-2); font-size: 14px; font-weight: 600; }
.cb-spin { color: var(--accent); animation: cb-rotate 0.9s linear infinite; }
@keyframes cb-rotate { to { transform: rotate(360deg); } }
.cb-cancel { width: 36px; height: 36px; }

/* Ongoing (not joined) */
.cb-ongoing-label { font-size: 13px; color: var(--text-3); font-weight: 600; }
.cb-join-row { display: flex; align-items: center; gap: 10px; }
.cb-join {
  display: flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 22px; border-radius: 8px;
  background: #23a55a; color: #fff; font-size: 14px; font-weight: 700;
  transition: background .12s, transform .1s;
}
.cb-join:hover { background: #1f9450; transform: translateY(-1px); }
.cb-join:active { transform: scale(.96); }
.cb-dismiss { width: 40px; height: 40px; border-radius: 8px; }
</style>

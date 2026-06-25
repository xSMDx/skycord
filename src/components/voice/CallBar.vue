<script setup lang="ts">
import { computed } from 'vue'
import { PhMicrophone, PhMicrophoneSlash, PhHeadphones, PhPhoneX, PhVideoCamera, PhScreencast, PhPhoneCall, PhX } from '@phosphor-icons/vue'
import { useVoice } from '@/composables/useVoice'

// Persistent call surface at the top of the chat. Shows whenever a call is active
// in THIS conversation — joined, connecting, or ongoing-not-joined.
//   • in call (joined OR connecting) → participant tiles + Discord-style controls.
//     Starting a call shows YOUR tile immediately; the "connecting" state lives
//     only in the bottom-left Voice panel.
//   • ongoing (not joined)           → who's in the call + a Join button.
const props = defineProps<{
  convId: string
  kind: 'dm' | 'group'
  name: string
  // Server-presence participants resolved to display info (incl. you, if joined).
  participants: { id: string; name: string; avatar: string; local: boolean }[]
  // The local user, for the optimistic self-tile shown while connecting.
  me?: { name: string; avatar: string }
  dismissed?: boolean
}>()
const emit = defineEmits<{ dismiss: [] }>()

const { voice, connect, leave, toggleMute, toggleDeafen } = useVoice()

const joinedHere     = computed(() => voice.connected  && voice.activeConvId     === props.convId)
const connectingHere = computed(() => voice.connecting && voice.connectingConvId === props.convId)
const inCall         = computed(() => joinedHere.value || connectingHere.value)
const callActive     = computed(() => props.participants.length > 0)
// Ongoing call you haven't joined (and haven't dismissed).
const showOngoing    = computed(() => callActive.value && !inCall.value && !props.dismissed)
const visible        = computed(() => inCall.value || showOngoing.value)

const others = computed(() => props.participants.filter(p => !p.local))
const initial = (n: string) => (n || '?').charAt(0).toUpperCase()
// id → avatar, so joined-mode tiles (live LiveKit participants don't carry
// avatars) can show real avatars from server presence.
const avatarById = computed(() => {
  const m: Record<string, string> = {}
  for (const p of props.participants) if (p.avatar) m[p.id] = p.avatar
  return m
})

// Tiles for the in-call stage. Joined → live LiveKit participants. Connecting →
// an optimistic self tile (so you "land" in the call instantly) plus anyone
// already present.
type Tile = { id: string; name: string; avatar: string; speaking: boolean; muted: boolean }
const stageTiles = computed<Tile[]>(() => {
  if (joinedHere.value) {
    return voice.participants.map(p => ({
      id: p.id,
      name: p.local ? (props.me?.name || p.name) : p.name,
      avatar: avatarById.value[p.id] || (p.local ? (props.me?.avatar || '') : ''),
      speaking: p.speaking && !p.muted,
      muted: p.muted,
    }))
  }
  const meTile: Tile = { id: 'me', name: props.me?.name || 'You', avatar: props.me?.avatar || '', speaking: false, muted: voice.localMuted }
  return [meTile, ...others.value.map(o => ({ id: o.id, name: o.name, avatar: o.avatar, speaking: false, muted: false }))]
})

const join = () => { connect(props.convId, props.kind, props.name).catch(() => {}) }
</script>

<template>
  <div v-if="visible" class="callbar">
    <!-- ── In a call (joined or connecting): stage + controls ────────────── -->
    <template v-if="inCall">
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

      <!-- Discord-style grouped pill controls -->
      <div class="cb-bar">
        <div class="cb-group">
          <button class="cb-b" :class="{ off: voice.localMuted }" :title="voice.localMuted ? 'Unmute' : 'Mute'" @click="toggleMute">
            <component :is="voice.localMuted ? PhMicrophoneSlash : PhMicrophone" :size="20" weight="fill" />
          </button>
          <button class="cb-b" disabled title="Video — coming soon"><PhVideoCamera :size="20" weight="fill" /></button>
        </div>
        <div class="cb-group">
          <button class="cb-b" disabled title="Screen share — coming soon"><PhScreencast :size="20" weight="fill" /></button>
          <button class="cb-b" :class="{ off: voice.localDeafened }" :title="voice.localDeafened ? 'Undeafen' : 'Deafen'" @click="toggleDeafen">
            <PhHeadphones :size="20" weight="fill" />
          </button>
        </div>
        <button class="cb-leave" :title="connectingHere ? 'Cancel' : 'Leave Call'" @click="leave"><PhPhoneX :size="20" weight="fill" /></button>
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
        <button v-if="kind === 'dm'" class="cb-dismiss" title="Dismiss" @click="emit('dismiss')"><PhX :size="18" weight="bold" /></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.callbar {
  background: var(--bg-floor); border-bottom: 1px solid var(--border);
  padding: 20px 16px 16px; display: flex; flex-direction: column; align-items: center; gap: 18px;
}

/* Stage — circular avatar tiles, Discord voice-call style */
.cb-stage { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; }
.cb-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cb-av {
  width: 72px; height: 72px; border-radius: 50%; position: relative;
  background: var(--accent); color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700; overflow: hidden;
  box-shadow: 0 0 0 0 rgba(35,165,90,0); transition: box-shadow .15s;
}
.cb-av img { width: 100%; height: 100%; object-fit: cover; }
.cb-av.speaking { box-shadow: 0 0 0 3px #23a55a; }
.cb-mute {
  position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px;
  border-radius: 50%; background: #f23f43; color: #fff;
  display: flex; align-items: center; justify-content: center; border: 3px solid var(--bg-floor);
}
.cb-name { font-size: 13px; color: var(--text-1); font-weight: 600; }

/* Discord-style grouped pill control bar */
.cb-bar { display: flex; align-items: center; gap: 8px; }
.cb-group {
  display: flex; align-items: center; gap: 2px;
  background: rgba(0,0,0,.4); border-radius: 26px; padding: 4px;
}
.cb-b {
  width: 44px; height: 44px; border-radius: 50%;
  background: transparent; color: var(--text-1);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, transform .1s, color .12s;
}
.cb-b:hover:not(:disabled) { background: rgba(255,255,255,.1); }
.cb-b:active:not(:disabled) { transform: scale(.9); }
.cb-b:disabled { opacity: .4; cursor: not-allowed; }
.cb-b.off { background: #f23f43; color: #fff; }
.cb-b.off:hover:not(:disabled) { background: #d83c3f; }
.cb-leave {
  width: 52px; height: 44px; border-radius: 26px; flex-shrink: 0;
  background: #f23f43; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, transform .1s;
}
.cb-leave:hover { background: #d83c3f; }
.cb-leave:active { transform: scale(.94); }

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
.cb-dismiss {
  width: 40px; height: 40px; border-radius: 8px;
  background: var(--hover, rgba(255,255,255,.06)); color: var(--text-1);
  display: flex; align-items: center; justify-content: center; transition: background .12s;
}
.cb-dismiss:hover { background: var(--hover-strong, rgba(255,255,255,.12)); }
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhMicrophone, PhMicrophoneSlash, PhPhoneX, PhVideoCamera, PhVideoCameraSlash, PhScreencast, PhDotsThree, PhCaretDown, PhPhoneCall, PhX } from '@phosphor-icons/vue'
import { useVoice } from '@/composables/useVoice'
import CallStage from './CallStage.vue'
import MicFlyout from './MicFlyout.vue'
import CameraFlyout from './CameraFlyout.vue'
import MoreFlyout from './MoreFlyout.vue'
import { useVoiceMedia } from '@/composables/useVoiceMedia'

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
const emit = defineEmits<{ dismiss: []; toast: [msg: string]; openSettings: [] }>()

const { voice, connect, leave, toggleMute } = useVoice()
const { media, toggleCamera, toggleScreenShare } = useVoiceMedia()

// Media toggles return a user-facing error message on failure (e.g. camera
// held by another app) — bubble it up to ChatApp's toast instead of failing
// silently.
const onCamera = async () => { const err = await toggleCamera(); if (err) emit('toast', err) }
const onShare  = async () => { const err = await toggleScreenShare(); if (err) emit('toast', err) }

const openMenu = ref<'' | 'mic' | 'cam' | 'more'>('')
const toggleMenu = (m: 'mic' | 'cam' | 'more') => { openMenu.value = openMenu.value === m ? '' : m }

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
// Camera/screen buttons are disabled until joinedHere: publishing during the
// connecting window would register under the real LiveKit identity while the
// optimistic stage tile still uses the 'me' placeholder id → duplicate self-cells.
const videoList = computed(() => [...media.videoTracks.values()])

const join = () => { connect(props.convId, props.kind, props.name).catch(() => {}) }
</script>

<template>
  <div v-if="visible" class="callbar" :class="{ 'has-video': inCall && videoList.length }">
    <!-- ── In a call (joined or connecting): stage + controls ────────────── -->
    <template v-if="inCall">
      <CallStage class="cb-callstage" :tiles="stageTiles" :videos="videoList" />

      <!-- Discord-style grouped pill controls -->
      <div class="cb-bar">
        <div class="cb-group">
          <!-- mic/camera + their ▾ read as ONE control: hovering either lights the pair -->
          <div class="cb-split" :class="{ menuopen: openMenu === 'mic' }">
            <button class="cb-b cb-mic" :class="{ off: voice.localMuted }" :title="voice.localMuted ? 'Unmute' : 'Mute'" @click="toggleMute">
              <component :is="voice.localMuted ? PhMicrophoneSlash : PhMicrophone" :size="20" weight="fill" />
            </button>
            <button class="cb-chev" title="Audio settings" @click="toggleMenu('mic')"><PhCaretDown :size="12" weight="bold" /></button>
            <MicFlyout v-if="openMenu === 'mic'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
          <div class="cb-split" :class="{ menuopen: openMenu === 'cam' }">
            <button class="cb-b cb-cam" :disabled="!joinedHere" :class="{ on: media.localCamOn }" :title="!joinedHere ? 'Connecting…' : (media.localCamOn ? 'Turn off camera' : 'Turn on camera')" @click="onCamera">
              <component :is="media.localCamOn ? PhVideoCamera : PhVideoCameraSlash" :size="20" weight="fill" />
            </button>
            <button class="cb-chev" :disabled="!joinedHere" title="Video settings" @click="toggleMenu('cam')"><PhCaretDown :size="12" weight="bold" /></button>
            <CameraFlyout v-if="openMenu === 'cam'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
        </div>
        <div class="cb-group">
          <button class="cb-b cb-share" :disabled="!joinedHere" :class="{ on: media.localScreenOn }" :title="!joinedHere ? 'Connecting…' : (media.localScreenOn ? 'Stop sharing' : 'Share your screen')" @click="onShare">
            <PhScreencast :size="20" weight="fill" />
          </button>
          <div class="cb-split" :class="{ menuopen: openMenu === 'more' }">
            <button class="cb-b cb-more" title="More" @click="toggleMenu('more')"><PhDotsThree :size="20" weight="bold" /></button>
            <MoreFlyout v-if="openMenu === 'more'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
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
/* Kill the default browser button border (the ugly 2-tone bevel) on every control */
.callbar button { border: none; cursor: pointer; box-sizing: border-box; }

/* Stage — circular avatar tiles, Discord voice-call style */
.cb-stage { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; }
.cb-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cb-av {
  width: 72px; height: 72px; border-radius: 50%; position: relative;
  background: var(--accent); color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700;
  box-shadow: 0 0 0 0 rgba(35,165,90,0); transition: box-shadow .15s;
}
/* Clip the image to the circle on the IMAGE itself, NOT the container — the
   container must stay un-clipped so the .cb-mute badge can overhang the corner. */
.cb-av img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.cb-av.speaking { box-shadow: 0 0 0 3px #23a55a; }
.cb-mute {
  position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px;
  border-radius: 50%; background: #f23f43; color: #fff;
  display: flex; align-items: center; justify-content: center; border: 3px solid var(--bg-floor);
}
.cb-name { font-size: 13px; color: var(--text-1); font-weight: 600; }

/* Discord-style controls — no container shape, buttons float on the call bg */
.cb-bar { display: flex; align-items: center; gap: 8px; }
.cb-group { display: flex; align-items: center; gap: 2px; background: var(--bg-input); border-radius: 16px; padding: 4px; }
.cb-b {
  width: 40px; height: 40px; border-radius: 8px;
  background: transparent; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s;
}
.cb-b:hover:not(:disabled) { background: rgba(255,255,255,.08); }
.cb-b:disabled { opacity: .45; cursor: not-allowed; }
/* No ugly browser focus ring — a subtle bg highlight stands in for keyboard focus */
.cb-b:focus, .cb-chev:focus, .cb-leave:focus { outline: none; }
.cb-b:focus-visible, .cb-chev:focus-visible { background: rgba(255,255,255,.16); }
.cb-b.off { background: #f23f43; color: #fff; }
.cb-b.off:hover:not(:disabled) { background: #d83c3f; }
/* device-picker chevron — slim split-button next to mic/camera */
.cb-chev {
  width: 18px; height: 40px; border-radius: 6px;
  background: transparent; color: #b5bac1;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s;
}
.cb-chev:hover:not(:disabled) { background: rgba(255,255,255,.08); color: #fff; }
.cb-chev:disabled { opacity: .45; cursor: not-allowed; }
/* mic/cam + ▾ pair highlight: the split wrapper takes the hover bg so both
   halves light together (Discord behavior). Individual bg hovers inside the
   split go transparent; red .off / green .on states keep their own fills. */
.cb-split { position: relative; display: flex; align-items: center; gap: 2px; border-radius: 8px; transition: background .12s; }
.cb-split:hover:has(.cb-b:not(:disabled)) { background: rgba(255,255,255,.08); }
.cb-split .cb-b:hover:not(:disabled):not(.on):not(.off) { background: transparent; }
.cb-split.menuopen { background: rgba(255,255,255,.08); }
.cb-leave {
  width: 56px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: #f23f43; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s;
}
.cb-leave:hover { background: #d83c3f; }

/* Per-icon hover animations — each control has its own personality */
@keyframes cb-wiggle { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-14deg); } 45% { transform: rotate(11deg); } 70% { transform: rotate(-6deg); } }
@keyframes cb-pop    { 0%,100% { transform: scale(1); } 45% { transform: scale(1.3); } }
@keyframes cb-lift   { 0%,100% { transform: translateY(0); } 45% { transform: translateY(-3px) scale(1.12); } }
@keyframes cb-swing  { 0%,100% { transform: rotate(0); } 30% { transform: rotate(20deg); } 65% { transform: rotate(-12deg); } }
.cb-mic:hover:not(:disabled)   svg { animation: cb-wiggle .5s ease; }
.cb-cam:hover:not(:disabled)   svg { animation: cb-pop .4s ease; }
.cb-share:hover:not(:disabled) svg { animation: cb-lift .45s ease; }
.cb-more:hover:not(:disabled)  svg { animation: cb-pop .4s ease; }
.cb-chev:hover:not(:disabled)  svg { animation: cb-pop .35s ease; }
.cb-leave:hover                svg { animation: cb-swing .5s ease; }

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

/* Active camera / screen share — green like Discord */
.cb-b.on { background: #248046; color: #fff; }
.cb-b.on:hover:not(:disabled) { background: #1a6334; }

/* When video is on the stage, let the call bar grow to fill the chat column */
.callbar.has-video { flex: 1 1 auto; min-height: 0; }
.cb-callstage { width: 100%; }
.callbar.has-video .cb-callstage { flex: 1 1 auto; min-height: 0; }
</style>

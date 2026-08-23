<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Mic, MicOff, PhoneOff, Video, VideoOff, MonitorUp, Ellipsis, ChevronDown, Phone, X, Maximize2, Minimize2 } from 'lucide-vue-next'
import { useVoice } from '@/composables/useVoice'
import CallStage from './CallStage.vue'
import MicFlyout from './MicFlyout.vue'
import CameraFlyout from './CameraFlyout.vue'
import MoreFlyout from './MoreFlyout.vue'
import { useVoiceMedia, type VideoTrackInfo } from '@/composables/useVoiceMedia'
import { voiceSettings, setVoiceSettings } from '@/composables/useVoiceSettings'
import { userPref, setUserPref } from '@/composables/useVoice'
import { soundDialStart, soundDialStop } from '@/composables/useSocket'
// Aliased: this component already has its own `openMenu` ref for the flyouts.
import { openMenu as openCtxMenu } from '@/composables/useContextMenu'
import { ownTileMenu, participantMenu, calleeMenu } from '@/composables/contextMenus/callMenu'

// Persistent call surface at the top of the chat. Shows whenever a call is active
// in THIS conversation — joined, connecting, or ongoing-not-joined.
//   • in call (joined OR connecting) → participant tiles + Discord-style controls.
//     Starting a call shows YOUR tile immediately; the "connecting" state lives
//     only in the bottom-left Voice panel.
//   • ongoing (not joined)           → who's in the call + a Join button.
//
// A voice CHANNEL is the third kind. It reaches this component only once you're
// in it (ChatApp only calls a channel "the call in view" when you're connected
// to one in the open server), so the ongoing/not-joined half is unreachable for
// a channel today — but the labels below still branch for it rather than
// calling a room of people "a call" if that ever changes.
const props = defineProps<{
  convId: string
  kind: 'dm' | 'group' | 'channel'
  name: string
  // Server-presence participants resolved to display info (incl. you, if joined).
  participants: { id: string; name: string; avatar: string; local: boolean }[]
  // The local user, for the optimistic self-tile shown while connecting.
  me?: { name: string; avatar: string | null }
  // Who we're calling, in a DM. They aren't a call participant until they
  // answer, so without this there is nothing on the stage to ring — the caller
  // stares at their own tile with no sign anyone is being called.
  callee?: { id: string; name: string; avatar: string }
  dismissed?: boolean
}>()
const emit = defineEmits<{
  dismiss: []; toast: [msg: string]; openSettings: [page?: 'voice']
  expand: [on: boolean]; profile: [u: { id: string; displayName: string; avatar: string }]
  previewCamera: []
}>()

const { voice, connect, leave, toggleMute, toggleDeafen } = useVoice()
const { media, toggleCamera, toggleScreenShare } = useVoiceMedia()

// Media toggles return a user-facing error message on failure (e.g. camera
// held by another app) — bubble it up to ChatApp's toast instead of failing
// silently.
// Preview gates turning the camera ON only. Turning it off is never something
// you want a confirmation dialog for.
const onCamera = async () => {
  if (!media.localCamOn && voiceSettings.alwaysPreviewVideo) { emit('previewCamera'); return }
  const err = await toggleCamera(); if (err) emit('toast', err)
}
const onShare  = async () => { const err = await toggleScreenShare(); if (err) emit('toast', err) }

const openMenu = ref<'' | 'mic' | 'cam' | 'more'>('')
const toggleMenu = (m: 'mic' | 'cam' | 'more') => { openMenu.value = openMenu.value === m ? '' : m }

const joinedHere     = computed(() => voice.connected  && voice.activeConvId     === props.convId)
const connectingHere = computed(() => voice.connecting && voice.connectingConvId === props.convId)
const inCall         = computed(() => joinedHere.value || connectingHere.value)

// Leaving the call (or it ending) must not leave a flyout open for next join,
// must not strand the user in fullscreen (the ongoing/not-joined view has no ⛶
// button), and must hand the chat column back to the message list.
watch(inCall, (v) => {
  if (!v) {
    openMenu.value = ''
    if (isFullscreen.value) document.exitFullscreen?.().catch(() => {})
    if (expanded.value) { expanded.value = false; emit('expand', false) }
  }
})

const callActive     = computed(() => props.participants.length > 0)
// Ongoing call you haven't joined (and haven't dismissed).
const showOngoing    = computed(() => callActive.value && !inCall.value && !props.dismissed)
const visible        = computed(() => inCall.value || showOngoing.value)

const others = computed(() => props.participants.filter(p => !p.local))
// "in a call" is a DM/group phrase — you are being called. Nobody calls a voice
// channel; people are simply in it.
const ongoingLabel = computed(() => {
  const n = others.value.length
  if (props.kind === 'channel') return n === 1 ? `${others.value[0].name} is in voice` : `${n} people in voice`
  return n === 1 ? `${others.value[0].name} is in a call` : `${n} people in a call`
})
const initial = (n: string) => (n || '?').charAt(0).toUpperCase()
// id → avatar, so joined-mode tiles (live LiveKit participants don't carry
// avatars) can show real avatars from server presence.
//
// Sticky for the life of the call, and that is the whole point. Socket presence
// and the LiveKit room are two independent connections that can disagree: if
// someone's socket drops while their media session is still up, they fall out
// of `participants` while you can still hear them talking. Deriving this map
// fresh each tick meant their photo silently became a grey initial mid-sentence.
// LiveKit decides who is IN the call; presence only ever adds detail to that.
const avatarCache = ref<Record<string, string>>({})
watch(() => props.participants, (list) => {
  let next: Record<string, string> | null = null
  for (const p of list) {
    if (p.avatar && avatarCache.value[p.id] !== p.avatar) {
      next ??= { ...avatarCache.value }
      next[p.id] = p.avatar
    }
  }
  if (next) avatarCache.value = next
}, { immediate: true, deep: true })
// A new call must not inherit the last one's faces.
watch(inCall, (on) => { if (!on) avatarCache.value = {} })
const avatarById = computed(() => avatarCache.value)

// Tiles for the in-call stage. Joined → live LiveKit participants. Connecting →
// an optimistic self tile (so you "land" in the call instantly) plus anyone
// already present.
type Tile = { id: string; name: string; avatar: string; speaking: boolean; muted: boolean; ring?: 'ringing' | 'no-answer' }
const stageTiles = computed<Tile[]>(() => {
  if (joinedHere.value) {
    const live = voice.participants.map(p => ({
      id: p.id,
      name: p.local ? (props.me?.name || p.name) : p.name,
      avatar: avatarById.value[p.id] || (p.local ? (props.me?.avatar || '') : ''),
      speaking: p.speaking && !p.muted,
      muted: p.muted,
    }))
    // Nobody has answered yet — show who we're calling, ringing, beside you.
    // The tile stays after the ring times out (as "no answer") so the call
    // doesn't silently become a room with one person in it, and so there's
    // something to right-click for "Ring Again".
    if (dialing.value && props.callee) {
      live.push({
        id: 'ringing', name: props.callee.name, avatar: props.callee.avatar,
        speaking: false, muted: false, ring: rangOut.value ? 'no-answer' : 'ringing',
      } as Tile)
    }
    return live
  }
  const meTile: Tile = { id: 'me', name: props.me?.name || 'You', avatar: props.me?.avatar || '', speaking: false, muted: voice.localMuted }
  return [meTile, ...others.value.map(o => ({ id: o.id, name: o.name, avatar: o.avatar, speaking: false, muted: false }))]
})
// Camera/screen buttons are disabled until joinedHere: publishing during the
// connecting window would register under the real LiveKit identity while the
// optimistic stage tile still uses the 'me' placeholder id → duplicate self-cells.
const videoList = computed(() => [...media.videoTracks.values()] as VideoTrackInfo[])

/** Anything on the stage at all — a camera or a screen. */
const hasVideo = computed(() => videoList.value.length > 0)
/** Screen share specifically. A shared screen is mostly small text, so it needs
 *  far more room than a face does to be worth looking at. */
const hasScreen = computed(() => videoList.value.some(v => v.source === 'screen'))

const join = () => { connect(props.convId, props.kind, props.name).catch(() => {}) }

// ── Fullscreen ──────────────────────────────────────────────────────────────
// Fullscreen the whole call surface (stage + control pill), so it becomes the
// theater view with the message list hidden behind. isFullscreen tracks the
// fullscreenchange event so the icon stays correct even when the user exits
// with Esc rather than the button.
// ── Expand ("hide chat") ────────────────────────────────────────────────────
// Grows the call to fill the chat column by hiding the message list + composer
// (ChatApp applies that via the `expand` event). Rails stay visible — this is
// the in-app expanded view, distinct from browser fullscreen.
const expanded = ref(false)
const toggleExpand = () => { expanded.value = !expanded.value; emit('expand', expanded.value) }

const callbarRef  = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
// Filmstrip of non-focused tiles only earns its space once the call has room.
const showFilmstrip = computed(() => expanded.value || isFullscreen.value)

// ── Vertical resize ─────────────────────────────────────────────────────────
// Drag the call bar's bottom edge to size it. Stored as a FRACTION of the chat
// column so it stays proportional across window sizes. Dragging past EXPAND_AT
// slides straight into hide-chat; dragging back down leaves it again.
/*
 * Minimum height depends on what's on the stage.
 *
 * An audio call is avatars and a control row — 212px holds that comfortably. A
 * shared screen is mostly small text, and below roughly 500px it's present but
 * unreadable, which is worse than not showing it: the space is spent and the
 * content still can't be used. So the floor rises when a screen appears, and
 * the bar grows to meet it rather than leaving the user to drag.
 */
const MIN_AUDIO_PX  = 212
const MIN_SCREEN_PX = 500
const minPx = computed(() => (hasScreen.value ? MIN_SCREEN_PX : MIN_AUDIO_PX))

const EXPAND_AT = 0.9    // fraction of the column past which we flip to hide-chat
const heightPx  = ref(voiceSettings.callHeightPx ?? 220)

// Grow to meet the new floor the moment a screen appears, and don't shrink back
// when it ends — the user's own sizing is remembered, and yanking the layout
// out from under them the instant someone stops sharing is worse than leaving
// the extra room.
watch(hasScreen, on => {
  if (on && heightPx.value < MIN_SCREEN_PX) heightPx.value = MIN_SCREEN_PX
})
const dragging  = ref(false)
let stopDrag: (() => void) | null = null

// Explicit height only while the call shares the column — expanded/fullscreen
// have their own fill rules.
const barStyle = computed(() => {
  // Resizable in ANY call — audio-only too, not just when video is on the stage.
  if (!(inCall.value && !expanded.value && !isFullscreen.value)) return {}
  // Clamp on read too: a hand-edited or legacy value must never render the bar
  // unusably small.
  return { flex: '0 0 auto', height: Math.max(heightPx.value, minPx.value) + 'px' }
})

const onResizeDown = (e: PointerEvent) => {
  const column = callbarRef.value?.parentElement
  if (!column || !callbarRef.value) return
  const colHeight = column.getBoundingClientRect().height
  // Measure from the BAR's own top, not the column's — the chat header sits
  // between them, and using the column top would offset every drag by its height.
  const barTop = callbarRef.value.getBoundingClientRect().top
  if (colHeight <= 0) return
  dragging.value = true

  const move = (ev: PointerEvent) => {
    const px = ev.clientY - barTop
    if (px >= colHeight * EXPAND_AT) {            // slide into hide-chat
      if (!expanded.value) { expanded.value = true; emit('expand', true) }
      return
    }
    if (expanded.value) { expanded.value = false; emit('expand', false) }
    heightPx.value = Math.min(Math.max(px, minPx.value), colHeight * EXPAND_AT)
  }
  const up = () => {
    dragging.value = false
    setVoiceSettings({ callHeightPx: Math.round(heightPx.value) })
    stopDrag?.()
  }
  stopDrag = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    // pointercancel (touch-scroll takeover, alt-tab, system dialog) must tear the
    // drag down too, or stale listeners fire on the next unrelated click.
    window.removeEventListener('pointercancel', up)
    stopDrag = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  e.preventDefault()
}

// "Reset all Voice & Video settings" can fire mid-call — follow it, but never
// yank the bar out from under an active drag.
watch(() => voiceSettings.callHeightPx, (v) => {
  if (!dragging.value && typeof v === 'number') heightPx.value = v
})
// ── Tile context menus ──────────────────────────────────────────────────────
const copyText = (text: string, what: string) => {
  navigator.clipboard.writeText(text)
    .then(() => emit('toast', `${what} copied`))
    .catch(() => emit('toast', `Couldn’t copy the ${what}`))
}

const menuHandlers = {
  openProfile:     (u: any) => emit('profile', u),
  previewCamera:   () => emit('previewCamera'),
  toggleMute:      () => toggleMute(),
  toggleDeafen:    () => toggleDeafen(),
  openVoiceSettings: () => emit('openSettings', 'voice'),
  copy:            copyText,
  setUserVolume:   (id: string, v: number) => setUserPref(id, { volume: v }),
  toggleUserMute:  (id: string) => setUserPref(id, { muted: !userPref(id).muted }),
  toggleUserVideo: (id: string) => setUserPref(id, { videoOff: !userPref(id).videoOff }),
  toggleShowNonVideo:  () => setVoiceSettings({ showNonVideo:  !voiceSettings.showNonVideo }),
  toggleShowOwnCamera: () => setVoiceSettings({ showOwnCamera: !voiceSettings.showOwnCamera }),
}

// Passed as BUILDERS, not arrays: these menus contain live state (checkmarks
// for mute/deafen, the volume readout), and an array is a snapshot that can
// never update while the menu is open.
const onTileCtx = (e: MouseEvent, t: { id: string; name: string; avatar: string; local: boolean }) => {
  const u = { id: t.id, displayName: t.name, avatar: t.avatar }
  const base = () => ({
    selfMuted: voice.localMuted, selfDeafened: voice.localDeafened,
    showNonVideo: voiceSettings.showNonVideo, showOwnCamera: voiceSettings.showOwnCamera,
    channelId: props.convId,
  })
  // The callee hasn't joined, so they have no LiveKit id and no per-participant
  // state — their tile gets the ring controls instead of the usual menu.
  if (t.id === 'ringing' && props.callee) {
    const c = { id: props.callee.id, displayName: props.callee.name, avatar: props.callee.avatar }
    openCtxMenu(e, () => calleeMenu(c, { ringing: !rangOut.value, channelId: props.convId }, {
      ringAgain, stopRinging, openProfile: (x: any) => emit('profile', x), copy: copyText,
    }))
    return
  }
  if (t.local) openCtxMenu(e, () => ownTileMenu(u, base(), menuHandlers))
  else openCtxMenu(e, () => {
    const p = userPref(t.id)
    return participantMenu(u, { ...base(), volume: p.volume, muted: p.muted, videoOff: p.videoOff }, menuHandlers)
  })
}

// Right-clicking the mic / camera buttons opens the same flyout their chevron
// does — the chevron is easy to miss, and right-click is where people reach.
const onCtrlCtx = (e: MouseEvent, which: 'mic' | 'cam') => {
  e.preventDefault()
  if (which === 'cam' && !joinedHere.value) return
  openMenu.value = which     // open, not toggle — right-click shouldn't close it
}

// ── Outgoing dial ───────────────────────────────────────────────────────────
// You're in a 1:1 call and nobody else has picked up yet: without this the
// caller gets total silence and can't tell whether the call is even trying.
// Stops the instant anyone joins, and on leave/unmount.
//
// It also gives up. Ringing forever means a caller who walked away leaves a
// tone playing into an empty room and a callee being pestered indefinitely;
// 40s is long enough to reach a phone in another room and short enough not to
// become noise. After that the call stays OPEN — they can still answer — but
// the tone stops and the stage offers to ring again.
const RING_FOR_MS = 40_000

/**
 * True while we're dialling and nobody has answered.
 *
 * Counts LiveKit participants, NOT socket presence. Presence can drop out from
 * under someone whose media session is still up — do this off `others` and a
 * friend's socket blip makes the app decide they never answered, adding a
 * phantom "ringing…" tile and starting the dial tone at a person you are
 * mid-sentence with. The room is the authority on who is in the call.
 *
 * DM-only, and that is the real branch for the other two kinds rather than an
 * oversight: a group call rings through the incoming-call modal, and a voice
 * channel rings nobody at all — you walk into an empty room and wait, which is
 * the whole difference between a channel and a call. Dialling either would
 * start a tone with no callee for it to be aimed at.
 */
const dialing   = computed(() =>
  joinedHere.value && props.kind === 'dm' && !voice.participants.some(p => !p.local))
const rangOut   = ref(false)
let ringTimer: ReturnType<typeof setTimeout> | null = null

const clearRingTimer = () => { if (ringTimer) { clearTimeout(ringTimer); ringTimer = null } }

const startRinging = () => {
  clearRingTimer()
  rangOut.value = false
  soundDialStart()
  ringTimer = setTimeout(() => { soundDialStop(); rangOut.value = true; ringTimer = null }, RING_FOR_MS)
}

/** Offered once the ring times out — same call, fresh attempt. */
const ringAgain = () => { if (dialing.value) startRinging() }
/** Give up early. The call stays open; only the tone and the timer stop. */
const stopRinging = () => { clearRingTimer(); soundDialStop(); rangOut.value = true }

watch(dialing, (on) => {
  if (on) startRinging()
  else { clearRingTimer(); soundDialStop(); rangOut.value = false }
}, { immediate: true })

onBeforeUnmount(() => { clearRingTimer(); soundDialStop() })

const syncFullscreen = () => { isFullscreen.value = document.fullscreenElement === callbarRef.value }
const toggleFullscreen = () => {
  if (!isFullscreen.value) callbarRef.value?.requestFullscreen?.().catch(() => {})
  else document.exitFullscreen?.().catch(() => {})
}
onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen))
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
  stopDrag?.()   // an interrupted drag must not leave window listeners behind
  // CallBar is destroyed whenever you view a DIFFERENT conversation — even while
  // still connected to this call — so the inCall watch never runs. Hand the chat
  // column back on the way out, or ChatApp stays stuck in hide-chat forever.
  if (expanded.value) emit('expand', false)
})
</script>

<template>
  <div v-if="visible" ref="callbarRef" class="callbar" :style="barStyle" :class="{ 'has-video': inCall && videoList.length, 'sharing': inCall && hasScreen, 'is-expanded': expanded, 'is-fs': isFullscreen, 'is-dragging': dragging }">
    <!-- ── In a call (joined or connecting): stage + controls ────────────── -->
    <template v-if="inCall">
      <!-- stage wrapper is the positioning context for the ⛶ overlay, so the
           button sits over the video area (not down at the control-bar row) -->
      <div class="cb-stagewrap">
        <CallStage class="cb-callstage" :tiles="stageTiles" :videos="videoList" :show-filmstrip="showFilmstrip" @tile-ctx="onTileCtx" />
      </div>

      <!-- Discord-style grouped pill controls -->
      <div class="cb-bar">
        <div class="cb-group">
          <!-- mic/camera + their ▾ read as ONE control: hovering either lights the pair -->
          <div class="cb-split" :class="{ menuopen: openMenu === 'mic' }">
            <button class="cb-b cb-mic" :class="{ off: voice.localMuted }" v-tip="voice.localMuted ? 'Unmute' : 'Mute'" @click="toggleMute" @contextmenu="onCtrlCtx($event, 'mic')">
              <component :is="voice.localMuted ? MicOff : Mic" :size="20" :stroke-width="2.25" />
            </button>
            <button class="cb-chev" v-tip="'Audio settings'" @click="toggleMenu('mic')"><ChevronDown :size="12" :stroke-width="2.25" /></button>
            <MicFlyout v-if="openMenu === 'mic'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
          <div class="cb-split" :class="{ menuopen: openMenu === 'cam' }">
            <button class="cb-b cb-cam" :disabled="!joinedHere" :class="{ on: media.localCamOn }" v-tip="!joinedHere ? 'Connecting…' : (media.localCamOn ? 'Turn off camera' : 'Turn on camera')" @click="onCamera" @contextmenu="onCtrlCtx($event, 'cam')">
              <component :is="media.localCamOn ? Video : VideoOff" :size="20" :stroke-width="2.25" />
            </button>
            <button class="cb-chev" :disabled="!joinedHere" v-tip="'Video settings'" @click="toggleMenu('cam')"><ChevronDown :size="12" :stroke-width="2.25" /></button>
            <CameraFlyout v-if="openMenu === 'cam'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
        </div>
        <div class="cb-group">
          <button class="cb-b cb-share" :disabled="!joinedHere" :class="{ on: media.localScreenOn }" v-tip="!joinedHere ? 'Connecting…' : (media.localScreenOn ? 'Stop sharing' : 'Share your screen')" @click="onShare">
            <MonitorUp :size="20" :stroke-width="2.25" />
          </button>
          <div class="cb-split" :class="{ menuopen: openMenu === 'more' }">
            <button class="cb-b cb-more" v-tip="'More'" @click="toggleMenu('more')"><Ellipsis :size="20" :stroke-width="2.25" /></button>
            <MoreFlyout v-if="openMenu === 'more'" @close="openMenu = ''" @open-settings="emit('openSettings')" />
          </div>
        </div>
        <!-- Hide-chat and fullscreen only exist once there's something worth
             enlarging. On an audio call they were two controls that changed
             nothing visible. They live in the control row rather than floating
             over the stage corners so every call action sits on one line. -->
        <div v-if="hasVideo" class="cb-group">
          <button class="cb-b" v-tip="expanded ? 'Show chat' : 'Hide chat'" @click="toggleExpand">
            <!-- points DOWN normally; flips UP once the chat is hidden -->
            <ChevronDown :size="20" :stroke-width="2.25" :style="expanded ? 'transform: rotate(180deg)' : ''" />
          </button>
          <button class="cb-b" v-tip="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
            <component :is="isFullscreen ? Minimize2 : Maximize2" :size="20" :stroke-width="2.25" />
          </button>
        </div>

        <button class="cb-leave" v-tip="connectingHere ? 'Cancel' : 'Leave Call'" @click="leave"><PhoneOff :size="20" :stroke-width="2.25" /></button>
      </div>

      <!-- Drag the bottom edge to resize; past the top it becomes hide-chat -->
      <div
        v-if="!isFullscreen"
        class="cb-resize" :class="{ on: dragging }"
        v-tip="'Drag to resize the call'"
        @pointerdown="onResizeDown"
      />
    </template>

    <!-- ── Ongoing call you haven't joined ───────────────────────────────── -->
    <template v-else>
      <div class="cb-stage">
        <div v-for="p in others" :key="p.id" class="cb-tile">
          <div class="cb-av"><Avatar v-if="p.avatar" :src="p.avatar" :alt="p.name" :crop="(p as any).avatarCrop" /><template v-else>{{ initial(p.name) }}</template></div>
          <span class="cb-name">{{ p.name }}</span>
        </div>
      </div>
      <div class="cb-ongoing-label">{{ ongoingLabel }}</div>
      <div class="cb-join-row">
        <button class="cb-join" @click="join">
          <Phone :size="18" :stroke-width="2.25" /> {{ kind === 'channel' ? 'Join Voice' : 'Join Call' }}
        </button>
        <!-- Dismissible only for a DM, and only a DM. A group call and a voice
             channel are both places that stay open with or without you — there
             is no ring to silence and nothing that would ever un-dismiss, so a
             dismiss button there just hides a room that is still there. -->
        <button v-if="kind === 'dm'" class="cb-dismiss" v-tip="'Dismiss'" @click="emit('dismiss')"><X :size="18" :stroke-width="2.25" /></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.callbar {
  position: relative;
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

/* When video is on the stage, let the call bar grow to fill the chat column.
   The stage lives in .cb-stagewrap (positioning context for the ⛶ overlay);
   growth applies to the wrapper, and the stage fills it. */
/* Growth: with video on the stage, in hide-chat, or fullscreen. Hide-chat MUST
   be here independently — the message list is gone, so if the bar didn't grow
   the column was left half empty (and the ⌄/⛶ buttons stranded up top). */
.callbar.has-video,
.callbar.is-expanded { flex: 1 1 auto; min-height: 0; }
/* The stage ALWAYS takes the space left above the control row — not only when
   there's video. Previously an audio call left the wrapper at content height,
   so the avatars sat pinned to the top and resizing the bar just added empty
   space underneath them instead of re-centring. */
.cb-stagewrap { position: relative; width: 100%; display: flex; flex: 1 1 auto; min-height: 0; }
.cb-callstage { width: 100%; flex: 1 1 auto; min-height: 0; }

/* Controls pinned to the BOTTOM of the bar. The stage takes whatever is left,
   so the control row lands in the same place at every bar height instead of
   drifting up as the call grows. */
.cb-bar { margin-top: auto; flex-shrink: 0; }


/* While a screen is shared, the controls fade out and come back on hover.
   A shared screen is the content — a permanent control row over it is a strip
   of someone else's desktop you cannot see. Hover-capable pointers only:
   touch has no hover, so phones keep the controls visible or they would be
   unreachable. */
@media (hover: hover) {
  .callbar.sharing .cb-bar {
    opacity: 0; transform: translateY(6px); pointer-events: none;
    transition: opacity .18s ease, transform .18s ease;
  }
  .callbar.sharing:hover .cb-bar,
  .callbar.sharing:focus-within .cb-bar {
    opacity: 1; transform: none; pointer-events: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .callbar.sharing .cb-bar { transition: opacity .15s ease; transform: none; }
}
/* Vertical resize grip along the call bar's bottom edge */
.cb-resize {
  position: absolute; left: 0; right: 0; bottom: 0; height: 6px; z-index: 3;
  cursor: ns-resize; background: transparent; transition: background .12s;
  touch-action: none;   /* stop touch browsers hijacking the drag as a scroll */
}
.cb-resize:hover, .cb-resize.on { background: rgba(var(--accent-rgb), .55); }
/* Don't let a drag select text or fight the pointer across the app */
.callbar.is-dragging { user-select: none; }

/* Theater view: whole call surface fills the screen, letterboxed on black. */
.callbar.is-fs { background: #000; border-bottom: none; justify-content: center; padding: 24px 24px 20px; }
</style>

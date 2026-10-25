<script setup lang="ts">
/**
 * The phone call screen's sheet: a drag handle and one row of round buttons —
 * mute, speaker, camera, hang up — with "Swipe up: people, music, invite"
 * under them. Pulled up, the buttons stay at its top and the rest slides in
 * beneath them: who is in the call, the Music card, Invite people, Voice
 * settings.
 *
 * In a channel that requires push-to-talk, a wide Hold to talk bar sits above
 * the buttons. It is the one control that never fades with the others: you can
 * always speak without a tap first.
 *
 * Drawn in PhoneCallScreen's default slot, which hands down `hidden` (the
 * controls have faded over a video). It reports back whether it is pulled up —
 * the controls never hide while it is — and how tall it is shut, which the
 * screen keeps the small tiles above. What the circles and rows open (the
 * camera with its preview, the invite, the settings, the call's music) is the
 * host's: they are emitted, not done here.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  Mic, MicOff, Volume2, Headphones, Video, VideoOff, PhoneOff,
  ChevronRight, Music2, UserPlus, SlidersHorizontal,
} from 'lucide-vue-next'
import HoldToTalk from './HoldToTalk.vue'
import MarqueeText from './MarqueeText.vue'
import Avatar from '@/components/ui/Avatar.vue'
import { defaultAvatar } from '@/composables/useAvatar'
import { useVoice } from '@/composables/useVoice'
import { effectiveInputMode } from '@/composables/useVoiceSettings'
import { permits } from '@/composables/voicePermits'
import { media } from '@/composables/useVoiceMedia'
import { speaker, setSpeaker } from '@/composables/phoneCall'
import { musicCardLabel } from '@/composables/phoneCallRules'
import { music, musicAvailable } from '@/composables/useMusic'
import { sheetOffset, velocityOf, settlesOpen } from '@/composables/sheetDrag'

type Person = { id: string; name: string; avatar: string; speaking: boolean; muted: boolean }

const props = defineProps<{
  participants: Person[]
  /** A voice channel or a group call. A DM call cannot take a third person here. */
  canInvite: boolean
  /** In the call, as opposed to still connecting to it. */
  joined: boolean
  /** The controls have faded over a video. Everything but Hold to talk goes with them. */
  hidden: boolean
}>()

const emit = defineEmits<{
  /** CallBar's own camera action, preview included. */
  camera: []
  invite: []
  voiceSettings: []
  music: []
  /** Hang up — or, still connecting, cancel. */
  leave: []
  /** Pulled up (true) or let back down. */
  expanded: [on: boolean]
  /** The shut sheet's height in px, Hold to talk and the home-indicator inset included. */
  height: [px: number]
}>()

const { voice, toggleMute } = useVoice()

// ── The circles ─────────────────────────────────────────────────────────────
const pushToTalk = computed(() => effectiveInputMode() === 'ptt')

// A server mute arrives as the flag and as the token's refusal of audio.
// Either one means the microphone cannot be opened from here.
const serverMuted = computed(() => voice.serverMuted || !permits.audio)

// Under push-to-talk the bar is the only way to transmit, so the circle that
// would open the microphone for good is shut, and says why.
const micLocked = computed(() => serverMuted.value || pushToTalk.value)
const micLabel = computed(() =>
  serverMuted.value ? 'Muted by the server'
    : pushToTalk.value ? 'This channel uses push to talk'
      : voice.localMuted ? 'Unmute' : 'Mute')

/** Why Hold to talk cannot transmit right now, or null when it can. */
const pttBlocked = computed<string | null>(() =>
  serverMuted.value ? 'Muted by the server'
    // The push-to-talk key does nothing while deafened; the bar matches it.
    : voice.localDeafened ? 'Deafened'
      : !props.joined ? 'Connecting…'
        : null)

const cameraLabel = computed(() =>
  !props.joined ? 'Connecting…' : media.localCamOn ? 'Turn off camera' : 'Turn on camera')

// ── The swiped-up list ──────────────────────────────────────────────────────
const musicLabel = computed(() => musicCardLabel({
  available: musicAvailable.value,
  listeningTo: music.listeningTo,
  channels: music.channels,
}))

// ── Pulled up or let down ───────────────────────────────────────────────────
const root = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const grab = ref<HTMLButtonElement | null>(null)

const expanded = ref(false)
/** How far down the shut sheet is pushed: the list's height, hidden below the edge. */
const travel = ref(0)
/** The list is longer than the room it has: it scrolls, and the sheet is dragged by its top. */
const scrolls = ref(false)
const dragging = ref(false)
const dragY = ref(0)
/**
 * Moving to a resting place. The transform eases only then: a sheet that
 * changes size (someone joins, the bar appears) must not slide about, and
 * one under the finger must not lag behind it.
 */
const settling = ref(false)

const offset = computed(() => (dragging.value ? dragY.value : expanded.value ? 0 : travel.value))

/** 0 shut, 1 pulled all the way up. */
const progress = computed(() => {
  if (travel.value <= 0) return expanded.value ? 1 : 0
  return Math.min(1, Math.max(0, 1 - offset.value / travel.value))
})
// Under the finger the hint gives way to the list as far as it has been drawn.
const hintStyle = computed(() => (dragging.value ? { opacity: String(1 - progress.value) } : undefined))
const bodyStyle = computed(() => (dragging.value ? { opacity: String(progress.value) } : undefined))

let settleTimer: ReturnType<typeof setTimeout> | null = null
const settleTo = (open: boolean) => {
  settling.value = true
  if (settleTimer !== null) clearTimeout(settleTimer)
  // Outlasts the slowest settle (--dur-4); after it, sizes change in place.
  settleTimer = setTimeout(() => { settling.value = false; settleTimer = null }, 500)
  // Letting the list down makes it inert; focus inside it would be dropped on the floor.
  if (!open && body.value?.contains(document.activeElement)) grab.value?.focus({ preventScroll: true })
  expanded.value = open
}
const toggle = () => settleTo(!expanded.value)

watch(expanded, on => emit('expanded', on))

// ── The drag ────────────────────────────────────────────────────────────────
// Follows the finger one for one and, on release, settles where it would have
// coasted to (sheetDrag, the physics BottomSheet shares). No pointer capture: a touch
// is captured to whatever it landed on already, and taking it from a button
// would read to the screen as that press ending.

/** Movement under this is a tap on whatever was pressed, not a drag. */
const SLOP = 6
let downId: number | null = null
let startY = 0
let baseY = 0
let samples: { y: number; t: number }[] = []
let swallowClick = false

const onDown = (e: PointerEvent) => {
  swallowClick = false
  // A primary pointer going down means no other is: a drag whose release never
  // arrived (a mouse let go outside the window) is over.
  if (downId !== null && e.isPrimary) {
    downId = null
    if (dragging.value) { dragging.value = false; settleTo(expanded.value) }
  }
  // A tap on faded controls only brings them back; that is the screen's job.
  if (props.hidden || downId !== null) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const target = e.target instanceof Element ? e.target : null
  // Hold to talk is held, not dragged.
  if (target?.closest('[data-ptt]')) return
  if (scrolls.value && target && body.value?.contains(target)) return
  downId = e.pointerId
  startY = e.clientY
  baseY = offset.value
  samples = [{ y: e.clientY, t: performance.now() }]
}

const onMove = (e: PointerEvent) => {
  if (e.pointerId !== downId) return
  const dy = e.clientY - startY
  if (!dragging.value) {
    if (Math.abs(dy) < SLOP) return
    dragging.value = true
    settling.value = false
  }
  samples.push({ y: e.clientY, t: performance.now() })
  if (samples.length > 5) samples.shift()
  dragY.value = sheetOffset(baseY + dy, travel.value)
}

const onUp = (e: PointerEvent) => {
  if (e.pointerId !== downId) return
  downId = null
  if (!dragging.value) return
  // The click this release may end in belongs to the drag, not to the circle it ended over.
  swallowClick = true
  setTimeout(() => { swallowClick = false }, 0)
  const open = settlesOpen(dragY.value, velocityOf(samples), travel.value)
  dragging.value = false
  settleTo(open)
}

const onClickCapture = (e: MouseEvent) => {
  if (!swallowClick) return
  swallowClick = false
  e.stopPropagation()
  e.preventDefault()
}

// ── Measuring ───────────────────────────────────────────────────────────────
let lastHeight = -1
const measure = () => {
  const r = root.value
  const b = body.value
  const l = list.value
  if (!r || !b || !l) return
  travel.value = b.offsetHeight
  scrolls.value = l.offsetHeight > b.clientHeight + 1
  // Shut, all of it shows but the list: the handle, Hold to talk, the circles,
  // the hint, and the inset under them.
  const h = r.offsetHeight - b.offsetHeight
  if (h !== lastHeight) {
    lastHeight = h
    emit('height', h)
  }
}

let ro: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined') return
  // The sheet (the bar coming and going), the room the list has, and the list itself.
  ro = new ResizeObserver(measure)
  for (const el of [root.value, body.value, list.value]) if (el) ro.observe(el)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  if (settleTimer !== null) clearTimeout(settleTimer)
  // Leaving the host holding the controls up for a sheet that has gone.
  if (expanded.value) emit('expanded', false)
})
</script>

<template>
  <div
    ref="root"
    class="pcsh"
    :class="{ open: expanded, dragging, settling }"
    :style="{ transform: `translate3d(0, ${offset}px, 0)` }"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @click.capture="onClickCapture"
  >
    <div class="pcsh-bg" :class="{ 'is-hidden': hidden }" aria-hidden="true"></div>

    <button
      ref="grab"
      type="button"
      class="pcsh-grab"
      :class="{ 'is-hidden': hidden }"
      :inert="hidden || undefined"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Hide people, music and invite' : 'Show people, music and invite'"
      @click="toggle"
    >
      <span class="pcsh-grabber"></span>
    </button>

    <!-- Push to talk: never faded, never inert. -->
    <HoldToTalk v-if="pushToTalk" class="pcsh-ptt" :disabled="pttBlocked !== null" :disabled-label="pttBlocked ?? ''" />

    <div class="pcsh-row" :class="{ 'is-hidden': hidden }" :inert="hidden || undefined">
      <button
        type="button" class="pcsh-c" :class="{ engaged: voice.localMuted && !micLocked }"
        :disabled="micLocked" :aria-label="micLabel" @click="toggleMute"
      >
        <component :is="micLocked || voice.localMuted ? MicOff : Mic" :size="22" :stroke-width="2" />
      </button>
      <button
        v-if="speaker.supported"
        type="button" class="pcsh-c" :class="{ engaged: speaker.on && !speaker.headset }"
        :disabled="speaker.headset" :aria-label="speaker.headset ? 'Using headset' : 'Speaker'"
        :aria-pressed="speaker.headset ? undefined : speaker.on"
        @click="setSpeaker(!speaker.on)"
      >
        <component :is="speaker.headset ? Headphones : Volume2" :size="22" :stroke-width="2" />
      </button>
      <button
        type="button" class="pcsh-c" :class="{ engaged: media.localCamOn }"
        :disabled="!joined" :aria-label="cameraLabel" @click="emit('camera')"
      >
        <component :is="media.localCamOn ? Video : VideoOff" :size="22" :stroke-width="2" />
      </button>
      <button type="button" class="pcsh-c pcsh-end" :aria-label="joined ? 'Leave call' : 'Cancel'" @click="emit('leave')">
        <PhoneOff :size="22" :stroke-width="2" />
      </button>
    </div>

    <!-- The handle is the way in for a screen reader; this is for the eye. -->
    <p class="pcsh-hint" :class="{ 'is-hidden': hidden }" aria-hidden="true" :style="hintStyle">Swipe up: people, music, invite</p>

    <div
      ref="body"
      class="pcsh-body"
      :class="{ 'is-hidden': hidden, scrolls }"
      :inert="hidden || !expanded || undefined"
      :style="bodyStyle"
    >
      <div ref="list" class="pcsh-list">
        <section v-if="participants.length" class="pcsh-people">
          <h3 class="pcsh-h">In this call · {{ participants.length }}</h3>
          <ul class="pcsh-ppl">
            <li v-for="p in participants" :key="p.id" class="pcsh-person">
              <span class="pcsh-av" :class="{ speaking: p.speaking }"><Avatar :src="p.avatar || defaultAvatar(p.name)" alt="" /></span>
              <span class="pcsh-name">{{ p.name }}</span>
              <span v-if="p.muted" class="pcsh-state muted" role="img" aria-label="Muted"><MicOff :size="16" :stroke-width="2.25" /></span>
              <span v-else-if="p.speaking" class="pcsh-state talking" role="img" aria-label="Talking"><Mic :size="16" :stroke-width="2.25" /></span>
            </li>
          </ul>
        </section>

        <button v-if="musicLabel" type="button" class="pcsh-card pcsh-music" @click="emit('music')">
          <span class="pcsh-card-head">
            <Music2 class="pcsh-ic" :size="18" :stroke-width="2.25" />
            <span class="pcsh-grow">Music</span>
            <ChevronRight class="pcsh-chev" :size="16" :stroke-width="2.25" />
          </span>
          <span class="pcsh-now">
            <template v-if="musicLabel.kind === 'song'">
              <img v-if="musicLabel.cover" class="pcsh-cover" :src="musicLabel.cover" alt="" draggable="false" />
              <span v-else class="pcsh-cover is-blank"><Music2 :size="16" :stroke-width="2.25" /></span>
              <MarqueeText class="pcsh-song" :text="musicLabel.title" />
            </template>
            <span v-else-if="musicLabel.kind === 'count'" class="pcsh-now-text">{{ musicLabel.n }} playing</span>
            <span v-else class="pcsh-now-text pcsh-quiet">Not playing</span>
          </span>
        </button>

        <div class="pcsh-card pcsh-links">
          <button v-if="canInvite" type="button" class="pcsh-link" @click="emit('invite')">
            <UserPlus class="pcsh-ic" :size="18" :stroke-width="2.25" />
            <span class="pcsh-grow">Invite people</span>
            <ChevronRight class="pcsh-chev" :size="16" :stroke-width="2.25" />
          </button>
          <button type="button" class="pcsh-link" @click="emit('voiceSettings')">
            <SlidersHorizontal class="pcsh-ic" :size="18" :stroke-width="2.25" />
            <span class="pcsh-grow">Voice settings</span>
            <ChevronRight class="pcsh-chev" :size="16" :stroke-width="2.25" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The layout insets it sits between belong to PhoneCallScreen: --pcs-top-h is
   where the call's name ends. */
.pcsh {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column;
  /* Pulled all the way up, it stops short of the call's name. */
  max-height: calc(100% - var(--pcs-top-h, 72px));
  padding: 0 16px env(safe-area-inset-bottom);
  /* Its own stacking context, so the backdrop can sit under the controls. */
  isolation: isolate;
  /* The sheet owns vertical drags; a list long enough to scroll takes them back. */
  touch-action: none;
  -webkit-user-select: none; user-select: none;
}
/* Arriving up is an entrance; going back down is a dismissal, and shorter. */
.pcsh.settling { transition: transform var(--dur-4) var(--ease-out); }
.pcsh.settling:not(.open) { transition: transform var(--dur-3) var(--ease-out); }

/* The material: a veil over whatever is behind (a video, or the stage), dark
   enough that the controls read on any picture, with a faint lift so the
   sheet reads as one. Constant in every theme, as everything drawn over media
   is. No blur: it would be redone over live video on every frame of a drag. */
.pcsh-bg {
  position: absolute; inset: 0; z-index: -1;
  border-radius: 16px 16px 0 0;
  background: linear-gradient(var(--hover), var(--hover)), var(--media-veil-strong);
  box-shadow: inset 0 1px 0 var(--border), var(--shadow-sheet);
}

/* A 44px target around a 36px bar: pulled, or tapped to open and close. */
.pcsh-grab {
  flex: none; align-self: center;
  width: 88px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  padding: 0; border: none; border-radius: var(--edge-pill); background: none;
  cursor: grab;
}
.pcsh-grabber { width: 36px; height: 4px; border-radius: 2px; background: var(--grabber); }

.pcsh-ptt { flex: none; margin-bottom: 16px; }

/* ── The circles: one centred row, same size, never squeezed ── */
.pcsh-row { flex: none; display: flex; justify-content: center; gap: 16px; }
.pcsh-c {
  flex: none; width: 56px; height: 56px;
  display: flex; align-items: center; justify-content: center;
  padding: 0; border: none; border-radius: 50%;
  background: var(--hover-strong); color: var(--on-media);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
/* Lands on the press, with no easing in: late feedback is no feedback. */
.pcsh-c:active:not(:disabled) { transform: scale(.94); }
/* Switched on — muted, on the speaker, camera live — the way a phone shows it: filled. */
.pcsh-c.engaged { background: var(--on-media); color: var(--media-ground); }
.pcsh-c:disabled { opacity: .45; cursor: default; }
.pcsh-end { background: var(--danger); color: var(--text-on-danger); }

.pcsh-hint {
  flex: none; margin: 12px 0 0; padding-bottom: 12px;
  font-size: 13px; line-height: 18px; text-align: center; color: var(--text-3);
  transition: opacity var(--dur-3) var(--ease-out), visibility 0s;
}
.pcsh.open .pcsh-hint { opacity: 0; }

/* ── The list, below the edge until pulled up ── */
.pcsh-body {
  flex: 0 1 auto; min-height: 0;
  overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
  transition: opacity var(--dur-3) var(--ease-out), visibility 0s;
}
/* A scroll box decides its own touches — the sheet's `none` stops at it — so
   it says which: a list that fits leaves the swipe to the sheet (or the
   browser would take it as a scroll and cancel the drag), and one that is too
   long to fit scrolls. */
.pcsh-body:not(.scrolls) { touch-action: none; }
.pcsh-body.scrolls { touch-action: pan-y; }
/* Shut, the list is below the edge but for the inset's few px; it shows
   nothing there and takes nothing (it is inert too). */
.pcsh:not(.open) .pcsh-body { opacity: 0; pointer-events: none; }
.pcsh.dragging .pcsh-hint, .pcsh.dragging .pcsh-body { transition: none; }

.pcsh-list { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 16px; }

.pcsh-h { margin: 0 0 4px; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--text-2); }
.pcsh-ppl { margin: 0; padding: 0; list-style: none; }
.pcsh-person { display: flex; align-items: center; gap: 12px; min-height: 48px; }
.pcsh-av {
  flex: none; display: flex; width: 32px; height: 32px; border-radius: 50%;
  box-shadow: 0 0 0 2px transparent;
  transition: box-shadow var(--dur-2) var(--ease-out);
}
.pcsh-av.speaking { box-shadow: 0 0 0 2px var(--green); }
.pcsh-name {
  flex: 1; min-width: 0;
  font-size: 15px; line-height: 20px; color: var(--text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pcsh-state { flex: none; display: flex; }
.pcsh-state.muted { color: var(--danger-text); }
.pcsh-state.talking { color: var(--green-text); }

/* Rounded groups on the sheet, clipping their rows' press response to the corners. */
.pcsh-card { border-radius: var(--edge-xl); background: var(--hover); overflow: hidden; }
.pcsh-music {
  display: flex; flex-direction: column; align-items: stretch; gap: 8px;
  width: 100%; min-height: 44px; padding: 12px 16px;
  border: none; color: var(--text-1);
  font-family: inherit; text-align: left; cursor: pointer;
}
.pcsh-card-head { display: flex; align-items: center; gap: 12px; font-size: 15px; line-height: 20px; font-weight: 600; }
.pcsh-grow { flex: 1; min-width: 0; }
.pcsh-ic { flex: none; color: var(--text-2); }
.pcsh-chev { flex: none; color: var(--text-3); }
.pcsh-now {
  display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 36px;
  font-size: 14px; line-height: 20px; font-weight: 400; color: var(--text-2);
}
.pcsh-cover {
  flex: none; width: 36px; height: 36px; border-radius: var(--edge-md);
  object-fit: cover; background: var(--media-ground);
}
.pcsh-cover.is-blank { display: flex; align-items: center; justify-content: center; background: var(--hover-strong); color: var(--text-3); }
.pcsh-song { flex: 1; color: var(--text-1); }
/* Words alone sit under the word "Music": past its 18px icon and the gap. */
.pcsh-now-text { padding-left: 30px; }
.pcsh-quiet { color: var(--text-3); }

.pcsh-links { display: flex; flex-direction: column; }
.pcsh-link {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: 52px; padding: 0 16px;
  border: none; background: none; color: var(--text-1);
  font-family: inherit; font-size: 15px; line-height: 20px; text-align: left;
  cursor: pointer;
}
.pcsh-link + .pcsh-link { border-top: 1px solid var(--divider); }

/* ── Faded over a video: gone, and inert, together — Hold to talk excepted ── */
.pcsh-bg, .pcsh-grab, .pcsh-row { transition: opacity var(--dur-3) var(--ease-inout), visibility 0s; }
.pcsh .is-hidden {
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity var(--dur-3) var(--ease-inout), visibility 0s linear var(--dur-3);
}

/* The sheet snaps between its places, and the controls come and go, without moving. */
@media (prefers-reduced-motion: reduce) {
  .pcsh.settling, .pcsh.settling:not(.open) { transition: none; }
  .pcsh-bg, .pcsh-grab, .pcsh-row, .pcsh-hint, .pcsh-body, .pcsh .is-hidden, .pcsh-av { transition: none; }
}
</style>

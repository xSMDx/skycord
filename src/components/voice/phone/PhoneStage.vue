<script setup lang="ts">
/**
 * What fills the phone call screen: the big slot, a row of small tiles for
 * everyone else, and your own camera in the top-right corner.
 *
 * Presentational. PhoneCallScreen decides who is big (pickFocus, with its
 * newcomer hold) and when the controls hide, and passes both down. This only
 * draws them, with one rule of its own: a focus whose video has gone — someone
 * kept in the slot after their camera went off — is drawn as the person.
 *
 * A screen share in the slot that is not loaded here (spec 6) is drawn as its
 * sharer too, with what they are doing and Join stream under them; the screen
 * says which (`share`), and joining is the screen's to do (`join`).
 */
import { computed, ref, watch, nextTick } from 'vue'
import { MicOff, Monitor, MonitorPlay, MonitorOff, LoaderCircle } from 'lucide-vue-next'
import VideoTile from '../VideoTile.vue'
import Avatar from '@/components/ui/Avatar.vue'
import { defaultAvatar } from '@/composables/useAvatar'
import { visibleTiles, type TileCandidate } from '@/composables/callLimits'
import { perf } from '@/composables/usePerformance'
import type { VideoTrackInfo } from '@/composables/useVoiceMedia'
import { participantName } from '@/composables/voiceRoom'
import { focusedVideo, type FocusState, type ShareSlot } from '@/composables/phoneCallRules'

/** CallStage's tile. `ring` = someone being called who has not picked up. */
type Tile = { id: string; name: string; avatar: string; speaking: boolean; muted: boolean; ring?: 'ringing' | 'no-answer' }

const props = defineProps<{
  tiles: Tile[]
  videos: VideoTrackInfo[]
  selfId: string
  focus: FocusState | null
  /** The controls are hidden over a video: the small tiles fade with them. */
  hidden: boolean
  /** When each person last spoke, kept by the screen, so the row is ranked the way the focus is. */
  lastSpokeAt: Record<string, number>
  /**
   * The sheet is pulled up, and this is its height in px; null while it is
   * down. It covers the bottom of the stage then, so the small tiles (listed in
   * the sheet now) and the ring line step aside, and the big avatar moves up
   * to the middle of what is left — or, with no room left for it, fades.
   */
  raisedSheet?: number | null
  /**
   * What the slot shows when a screen share holds it (phoneCallRules'
   * shareSlot): its picture, the sharer's tile with Join stream, or that tile
   * while a joined stream loads. Null or missing when it is not a share.
   */
  share?: ShareSlot | null
}>()

const emit = defineEmits<{
  /** Join stream, on the sharer's tile. */
  join: [id: string]
  /** Leave stream, on the same tile while the stream is still loading. */
  leave: [id: string]
  /** A long-press on a stream you joined: that person's sheet. */
  person: [id: string]
}>()

defineSlots<{
  /** Under the person being rung: the screen's way to ring them again. */
  ringing?(): unknown
}>()

const camera = (id: string): VideoTrackInfo | null =>
  props.videos.find(v => v.participantId === id && v.source === 'camera') ?? null

const avatarOf = (t: Tile): string => t.avatar || defaultAvatar(t.name)

// ── The big slot ────────────────────────────────────────────────────────────
const bigVideo = computed<VideoTrackInfo | null>(() => focusedVideo(props.videos, props.focus))

// Someone in the slot with no tile yet (their video, or their share, arrived
// before presence) still has a name to show: their video's, or — for a share
// not joined, which has no video here — the one LiveKit has for them.
const bigPerson = computed<Tile | null>(() => {
  const f = props.focus
  if (!f) return null
  return props.tiles.find(t => t.id === f.id) ?? {
    id: f.id, name: props.videos.find(v => v.participantId === f.id)?.name || participantName(f.id),
    avatar: '', speaking: false, muted: false,
  }
})

// The person being called. Under their big avatar while nobody has video; if
// your own camera fills the screen meanwhile, the line still shows above the
// row, so Ring again never disappears behind your own face. Never under
// someone else's avatar, as it could be for the moment the slot takes to move.
const ringing = computed(() => {
  const t = props.tiles.find(x => x.ring)
  return t && (bigVideo.value || bigPerson.value?.id === t.id) ? t : null
})

// ── Your own camera ─────────────────────────────────────────────────────────
// A corner tile, unless it is the big picture already (nobody else has video).
const selfVideo = computed<VideoTrackInfo | null>(() => {
  const own = props.videos.find(v => v.local && v.source === 'camera')
  return own && own !== bigVideo.value ? own : null
})

// ── The row ─────────────────────────────────────────────────────────────────
// Not on it: whoever is big, and you while your camera is in the corner.
const offRow = (id: string): boolean =>
  id === props.focus?.id || (selfVideo.value !== null && id === props.selfId)

// The cap counts the big slot as one of the call's tiles, so the row gets one
// fewer: on a phone that can afford two, that is the big picture and you.
const kept = computed(() => {
  const candidates: TileCandidate[] = props.tiles
    .filter(t => t.id !== props.focus?.id)
    .map(t => ({
      id: t.id,
      isSelf: t.id === props.selfId,
      speaking: t.speaking,
      hasVideo: camera(t.id) !== null,
      lastSpokeAt: props.lastSpokeAt[t.id] ?? 0,
    }))
  return new Set(visibleTiles(candidates, perf.maxCallTiles - (props.focus ? 1 : 0)))
})

// In the order the call gives, not by who spoke last: a row that reshuffles
// every time someone talks is a row you cannot find anyone in.
const row = computed(() => props.tiles
  .filter(t => kept.value.has(t.id) && !offRow(t.id))
  .map(t => ({ tile: t, camera: camera(t.id) })))

// Left off by the cap, not out of the call: counted, so the row never reads
// as people leaving.
const notShown = computed(() => props.tiles.filter(t => !kept.value.has(t.id) && !offRow(t.id)).length)

const label = (t: Tile): string => (t.muted ? `${t.name}, muted` : t.name)

// ── Clear of the pulled-up sheet ────────────────────────────────────────────
const main = ref<HTMLElement | null>(null)
const solo = ref<HTMLElement | null>(null)
const raised = computed(() => props.raisedSheet != null)
/** How far up the big avatar moves, in px (0 or less). */
const lift = ref(0)
/** No room for it above the sheet: it fades rather than sit half under it. */
const noRoom = ref(false)

// Layout positions (offsetTop), which a transform does not change, so a lift
// measured mid-move is the same as one measured at rest. The row and the ring
// line step aside by fading, not by leaving the layout, for the same reason.
const place = () => {
  const m = main.value
  const el = solo.value
  if (props.raisedSheet == null || !m || !el) { lift.value = 0; noRoom.value = false; return }
  const top = parseFloat(getComputedStyle(m).paddingTop) || 0
  const bottom = m.clientHeight - props.raisedSheet
  const h = el.offsetHeight
  // Half the 16px the stage keeps between things, above and below.
  if (bottom - top < h + 16) { lift.value = 0; noRoom.value = true; return }
  noRoom.value = false
  lift.value = Math.min(0, Math.round((top + bottom) / 2 - (el.offsetTop + h / 2)))
}
// The share's tile is taller than an avatar alone, so it is measured again when it comes or goes.
watch(() => [props.raisedSheet, bigPerson.value?.id, !!bigVideo.value, ringing.value?.ring, props.share], () => { void nextTick(place) })
const soloStyle = computed(() => (lift.value ? { transform: `translateY(${lift.value}px)` } : undefined))

// ── A share's tile ──────────────────────────────────────────────────────────
// The sharer, as the slot already draws them, with what they are doing and
// the one thing to do about it. Joining keeps the same button, which reads
// Leave stream until the picture arrives (as the desktop's does), so a slow
// join can be called off and focus never has to move.
//
// A long-press — useLongPress hands it over as a contextmenu event, the one
// long-press the app has — on a stream you joined opens that person's sheet,
// where its Leave stream and Stream Volume are (spec 16). From the slot only:
// not from the row of small tiles, nor from a button.
const onHold = (e: MouseEvent) => {
  const f = props.focus
  if (!f || (props.share !== 'picture' && props.share !== 'loading')) return
  const t = e.target instanceof Element ? e.target : null
  if (t?.closest('.ps-row, button')) return
  e.preventDefault()
  emit('person', f.id)
}
</script>

<template>
  <div class="ps">
    <!-- The focus fills the stage. A shared screen is text, which cannot be
         cropped, so it is letterboxed; a face can be, so it fills. -->
    <template v-if="bigVideo">
      <VideoTile v-if="bigVideo.source === 'screen'" :key="`${bigVideo.participantId}:screen`" class="ps-fill" :track="bigVideo.track" fit="contain" />
      <VideoTile v-else :key="`${bigVideo.participantId}:camera`" class="ps-fill" :class="{ 'is-own': bigVideo.local }" :track="bigVideo.track" fit="cover" />
      <!-- Keeps the top text readable on a bright picture; goes with it. -->
      <div class="ps-scrim" :class="{ 'is-hidden': hidden }"></div>
    </template>

    <div ref="main" class="ps-main" :class="{ 'over-video': bigVideo }" @contextmenu="onHold">
      <div
        v-if="!bigVideo && bigPerson" ref="solo" :key="bigPerson.id"
        class="ps-solo" :class="{ raised, 'no-room': raised && noRoom }" :style="soloStyle"
      >
        <div class="ps-av" :class="{ speaking: bigPerson.speaking, unanswered: bigPerson.ring === 'no-answer' }">
          <span v-if="bigPerson.ring === 'ringing'" class="ps-wave"></span>
          <Avatar :src="avatarOf(bigPerson)" :alt="bigPerson.name" still />
          <span v-if="bigPerson.muted" class="ps-av-mute"><MicOff :size="14" :stroke-width="2.25" /></span>
        </div>

        <!-- A share not loaded here: who, what, and the way in. No video
             element — nothing is downloaded until Join stream. -->
        <div v-if="share === 'join' || share === 'loading'" class="ps-share">
          <p class="ps-share-name">{{ bigPerson.name }}</p>
          <p class="ps-share-line" aria-live="polite">
            <LoaderCircle v-if="share === 'loading'" class="ps-spin spin" :size="16" :stroke-width="2.25" aria-hidden="true" />
            <Monitor v-else :size="16" :stroke-width="2.25" aria-hidden="true" />
            {{ share === 'loading' ? 'Loading their screen…' : 'Sharing their screen' }}
          </p>
          <button
            type="button" class="ps-join" :class="{ joined: share === 'loading' }"
            @click="share === 'loading' ? emit('leave', bigPerson.id) : emit('join', bigPerson.id)"
          >
            <MonitorOff v-if="share === 'loading'" :size="18" :stroke-width="2.25" aria-hidden="true" />
            <MonitorPlay v-else :size="18" :stroke-width="2.25" aria-hidden="true" />
            {{ share === 'loading' ? 'Leave stream' : 'Join stream' }}
          </button>
        </div>
      </div>

      <div v-if="ringing" class="ps-ringing" :class="{ 'is-hidden': hidden || raised }">
        <p class="ps-ring-label">{{ ringing.ring === 'ringing' ? 'Ringing…' : 'No answer' }}</p>
        <slot name="ringing" />
      </div>

      <div v-if="row.length || notShown" class="ps-row" :class="{ 'is-hidden': hidden || raised }">
        <div class="ps-row-inner">
          <div v-for="r in row" :key="r.tile.id" class="ps-tile" :class="{ speaking: r.tile.speaking }" role="img" :aria-label="label(r.tile)">
            <VideoTile v-if="r.camera" :track="r.camera.track" fit="cover" />
            <span v-else class="ps-tile-av"><Avatar :src="avatarOf(r.tile)" alt="" still /></span>
            <span v-if="r.tile.muted" class="ps-tile-mute"><MicOff :size="10" :stroke-width="2.5" /></span>
          </div>
          <div v-if="notShown" class="ps-tile ps-more" role="img" :aria-label="`${notShown} more in the call`">+{{ notShown }}</div>
        </div>
      </div>
    </div>

    <!-- Yours, and it stays when the controls hide: it is how you know what
         the others see. -->
    <div v-if="selfVideo" class="ps-self">
      <VideoTile class="is-own" :track="selfVideo.track" fit="cover" />
    </div>
  </div>
</template>

<style scoped>
/* The layout insets (--pcs-top-inset, --pcs-top-h, --pcs-sheet-h) belong to
   PhoneCallScreen, which knows where its top text and sheet sit. */
.ps { position: absolute; inset: 0; overflow: hidden; background: var(--bg-floor); }

/* A fade only: a transform here would fight the mirror on your own camera. */
.ps-fill { position: absolute; inset: 0; animation: ps-fade var(--dur-3) var(--ease-out); }
@keyframes ps-fade { from { opacity: 0; } }
/* The front camera, as a mirror shows you. A camera you see unmirrored reads as wrong. */
.is-own { transform: scaleX(-1); }

.ps-scrim {
  position: absolute; top: 0; left: 0; right: 0;
  height: calc(var(--pcs-top-h, 0px) + 56px);
  background: linear-gradient(to bottom, var(--media-veil-strong), transparent);
  pointer-events: none;
}

/* Between the top text and the sheet. With no video the big avatar and the row
   sit together in the middle; over a video only the row is left, just above
   the sheet. */
.ps-main {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  padding: var(--pcs-top-h, 0px) 16px var(--pcs-sheet-h, 0px);
}
.ps-main.over-video { justify-content: flex-end; padding-bottom: calc(var(--pcs-sheet-h, 0px) + 12px); }

/* ── The big avatar ── */
/* It moves with the sheet: up as the sheet settles open (--dur-4), back down
   as it settles shut (--dur-3), on the sheet's own curve. */
.ps-solo {
  display: flex; flex-direction: column; align-items: center;
  animation: ps-in var(--dur-3) var(--ease-out);
  transition: transform var(--dur-3) var(--ease-out), opacity var(--dur-3) var(--ease-out);
}
.ps-solo.raised { transition-duration: var(--dur-4); }
/* Faded, and with it the share's Join stream: a button nobody can see must
   not take a tap. */
.ps-solo.no-room { opacity: 0; pointer-events: none; }
@keyframes ps-in { from { opacity: 0; transform: scale(.96); } }

.ps-av {
  position: relative; display: flex; width: 96px; height: 96px; border-radius: 50%;
  box-shadow: 0 0 0 3px transparent, 0 0 0 6px transparent;
  transition: box-shadow var(--dur-2) var(--ease-out);
}
/* The talking ring, set off from the face by a sliver of the stage. */
.ps-av.speaking { box-shadow: 0 0 0 3px var(--bg-floor), 0 0 0 6px var(--green); }
.ps-av.unanswered :deep(.av) { opacity: .6; }
.ps-av-mute {
  position: absolute; right: 0; bottom: 0;
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-panel); color: var(--text-1); border: 3px solid var(--bg-floor);
}
/* One slow ring outward while the call goes out: calm, not an alarm. */
.ps-wave {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid var(--accent);
  animation: ps-wave 2.2s var(--ease-out) infinite;
  pointer-events: none;
}
@keyframes ps-wave {
  0%   { transform: scale(1);   opacity: .7; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* ── A share's tile: the sharer, what they are doing, Join stream ── */
/* Under the big avatar, centred on it. The name is the line that matters,
   the activity a step quieter, then the one thing to do, set apart. */
.ps-share {
  display: flex; flex-direction: column; align-items: center;
  max-width: 100%; margin-top: 16px; text-align: center;
}
.ps-share-name {
  max-width: 100%; margin: 0;
  font-size: 17px; line-height: 22px; font-weight: 600; letter-spacing: -0.01em; color: var(--text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ps-share-line {
  display: flex; align-items: center; gap: 6px; margin: 2px 0 0;
  font-size: 15px; line-height: 20px; color: var(--text-2);
}
.ps-share-line svg { flex: none; }
/* Turning means work is under way, so it keeps turning for anyone who asked
   for less movement too (the `spin` carve-out in tokens.css). */
.ps-spin { animation: ps-rot .8s linear infinite; }
@keyframes ps-rot { to { transform: rotate(360deg); } }

/* The way in, in the accent: on this screen the one thing asking to be done.
   The measure of the screen's other pill, Ring again. While the stream
   loads it steps back to the circles' neutral fill and reads Leave stream. */
.ps-join {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; margin-top: 20px; padding: 0 22px;
  border: none; border-radius: var(--edge-pill);
  background: var(--accent); color: var(--text-on-accent);
  font-family: inherit; font-size: 15px; font-weight: 600; white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
/* Lands on the press, with no easing in, as the sheet's circles do. */
.ps-join:active { transform: scale(.96); }
.ps-join:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.ps-join.joined { background: var(--hover-strong); color: var(--on-media); }

.ps-ringing { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.ps-ring-label {
  margin: 0; font-size: 15px; line-height: 20px; color: var(--text-2);
  text-shadow: 0 1px 2px var(--media-veil);
}

/* ── The row ── */
/* Full width so it can scroll sideways in a big call; the inner strip centres
   itself while it fits and starts at the left edge once it does not. */
.ps-row {
  align-self: stretch; overflow-x: auto; overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.ps-row::-webkit-scrollbar { display: none; }
.ps-row-inner { display: flex; gap: 8px; width: max-content; margin: 0 auto; padding: 8px 0; }
/* Under a big avatar, set apart from it: these are the others, not more of them. */
.ps-main:not(.over-video) .ps-row { margin-top: 16px; }

.ps-tile {
  position: relative; flex: none; width: 44px; height: 58px;
  border-radius: var(--edge-lg); overflow: hidden; background: var(--bg-panel);
  display: flex; align-items: center; justify-content: center;
}
/* The talking ring as an overlay, so a video in the tile cannot paint over it. */
.ps-tile::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 0 0 2px transparent;
  transition: box-shadow var(--dur-2) var(--ease-out);
}
.ps-tile.speaking::after { box-shadow: inset 0 0 0 2px var(--green); }
.ps-tile-av { display: flex; width: 30px; height: 30px; }
.ps-tile-mute {
  position: absolute; right: 3px; bottom: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--media-veil-strong); color: var(--on-media);
}
.ps-more { font-size: 13px; font-weight: 600; color: var(--text-2); }

/* Fades with the top text and the sheet, and lets taps through while gone. */
.ps-scrim, .ps-ringing, .ps-row { transition: opacity var(--dur-3) var(--ease-inout), visibility 0s; }
.ps-scrim.is-hidden, .ps-ringing.is-hidden, .ps-row.is-hidden {
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity var(--dur-3) var(--ease-inout), visibility 0s linear var(--dur-3);
}

/* ── Your own camera ── */
/* An explicit height, not aspect-ratio: the Android app's WebView floor is
   Chromium 86, which predates it. No z-index: last in the stage, it is above
   the picture, and the sheet that follows the stage may still rise over it. */
.ps-self {
  position: absolute;
  top: calc(var(--pcs-top-inset, 0px) + 8px); right: 12px;
  width: 84px; height: 112px;
  border-radius: var(--edge-xl); overflow: hidden;
  background: var(--letterbox); box-shadow: var(--shadow-md);
}

@media (prefers-reduced-motion: reduce) {
  .ps-fill, .ps-solo { animation: none; }
  .ps-solo, .ps-solo.raised { transition: none; }
  /* Still plainly "calling", without the motion: one still ring, just clear
     of the face (at its resting size it would sit hidden behind it). */
  .ps-wave { animation: none; opacity: .5; transform: scale(1.16); }
  /* Join turns into Leave at once. The spinner is left turning: it is
     information, not decoration. */
  .ps-join { transition: none; }
  .ps-scrim, .ps-ringing, .ps-row,
  .ps-scrim.is-hidden, .ps-ringing.is-hidden, .ps-row.is-hidden { transition: none; }
}
</style>

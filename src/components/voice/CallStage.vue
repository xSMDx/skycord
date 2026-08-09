<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { MicOff, Monitor, Minimize2, Maximize2 } from 'lucide-vue-next'
import VideoTile from './VideoTile.vue'
import { colorForUsername } from '@/composables/useAvatar'
import { voiceSettings } from '@/composables/useVoiceSettings'
import { keyFor, type VideoTrackInfo } from '@/composables/useVoiceMedia'
import { getRoom } from '@/composables/voiceRoom'
import { userPref } from '@/composables/useVoice'

const props = defineProps<{
  tiles:  { id: string; name: string; avatar: string; speaking: boolean; muted: boolean }[]
  videos: VideoTrackInfo[]
  // Show the filmstrip of non-focused tiles in spotlight. False in compact
  // spotlight (chat visible) → focused tile only; true in expand/fullscreen.
  showFilmstrip?: boolean
}>()

// The stage stays presentational: it reports WHICH tile was right-clicked and
// lets the call bar, which owns the voice state, decide what the menu contains.
const emit = defineEmits<{
  tileCtx: [e: MouseEvent, t: { id: string; name: string; avatar: string; local: boolean }]
}>()

const hasVideo = computed(() => props.videos.length > 0)
const initial  = (n: string) => (n || '?').charAt(0).toUpperCase()

// Whose tile is this? A video cell knows its participant directly; an avatar
// cell's key IS the participant id.
const localId    = computed(() => getRoom()?.localParticipant.identity ?? '')
const cellOwner  = (c: Cell) => c.kind === 'video' ? c.video.participantId : c.key
const cellAvatar = (c: Cell) => c.kind === 'avatar' ? c.avatar
  : (props.tiles.find(t => t.id === c.video.participantId)?.avatar ?? '')

// One grid cell per participant: their video publication(s) if any, else an
// avatar cell. A participant sharing screen + camera yields two video cells.
type Cell =
  | { kind: 'video'; key: string; name: string; speaking: boolean; source: 'camera' | 'screen'; video: VideoTrackInfo }
  | { kind: 'avatar'; key: string; name: string; speaking: boolean; muted: boolean; avatar: string }

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  const used = new Set<VideoTrackInfo>()
  for (const t of props.tiles) {
    const mine = props.videos.filter(v =>
      v.participantId === t.id &&
      // "Disable Video" on someone's tile is local-only: their stream keeps
      // flowing, you just stop rendering it.
      !(!v.local && userPref(v.participantId).videoOff) &&
      !(v.local && v.source === 'camera' && !voiceSettings.showOwnCamera))
    if (mine.length) {
      for (const v of mine) {
        used.add(v)
        out.push({ kind: 'video', key: keyFor(t.id, v.source), name: t.name, speaking: t.speaking, source: v.source, video: v })
      }
    } else if (voiceSettings.showNonVideo) {
      out.push({ kind: 'avatar', key: t.id, name: t.name, speaking: t.speaking, muted: t.muted, avatar: t.avatar })
    }
  }
  // Videos whose participant hasn't landed in `tiles` yet (presence lag):
  // render them anyway rather than dropping them invisibly.
  for (const v of props.videos) {
    if (!used.has(v)
        && !(!v.local && userPref(v.participantId).videoOff)
        && !(v.local && v.source === 'camera' && !voiceSettings.showOwnCamera)) {
      out.push({ kind: 'video', key: keyFor(v.participantId, v.source), name: v.name, speaking: false, source: v.source, video: v })
    }
  }
  return out
})

// ── Spotlight ("big screen") ────────────────────────────────────────────────
// focusedKey is the cell.key being spotlighted; null = grid view.
const focusedKey  = ref<string | null>(null)
const focusedCell = computed(() => cells.value.find(c => c.key === focusedKey.value) ?? null)
const inSpotlight = computed(() => hasVideo.value && !!focusedCell.value)

// Compact spotlight (chat visible) renders ONLY the focused cell — the other
// tiles aren't mounted, so two streams no longer stack a tall filmstrip. The
// focused cell keeps its key, so its VideoTile is never remounted (no flash);
// only the filmstrip tiles mount/unmount when expand/fullscreen toggles.
const renderCells = computed(() =>
  inSpotlight.value && !props.showFilmstrip
    ? (focusedCell.value ? [focusedCell.value] : [])
    : cells.value)

const focus  = (key: string) => { focusedKey.value = key }
const unfocus = () => { focusedKey.value = null }

// If the focused participant leaves or stops their video, the key no longer
// resolves — drop back to grid rather than freezing on an empty spotlight.
watch(cells, () => {
  if (focusedKey.value && !focusedCell.value) focusedKey.value = null
})

// ── Per-tile fullscreen ─────────────────────────────────────────────────────
// Distinct from the call bar's ⛶, which fullscreens the whole surface. This
// takes ONE stream full-screen — the usual thing you want when someone's
// sharing and you don't care about the other tiles.
const cellEls = new Map<string, HTMLElement>()
const setCellEl = (key: string) => (el: any) => {
  if (el) cellEls.set(key, el as HTMLElement)
  else cellEls.delete(key)
}
const fsKey = ref<string | null>(null)

const toggleCellFs = async (key: string, e?: Event) => {
  e?.stopPropagation()          // don't also toggle spotlight focus
  const el = cellEls.get(key); if (!el) return
  try {
    if (document.fullscreenElement === el) await document.exitFullscreen?.()
    else await el.requestFullscreen?.()
  } catch { /* denied or unsupported — leave as-is */ }
}

// Derive from the event rather than tracking our own flag, so exiting with Esc
// or the browser's own control keeps the icon honest.
const syncFs = () => {
  const cur = document.fullscreenElement
  fsKey.value = cur ? ([...cellEls.entries()].find(([, el]) => el === cur)?.[0] ?? null) : null
}

// Esc exits spotlight (when fullscreen is also on, the browser eats the first
// Esc for fullscreen; the next one lands here).
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (fsKey.value) return          // that Esc belongs to fullscreen
  if (focusedKey.value) focusedKey.value = null
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', syncFs)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', syncFs)
})
</script>

<template>
  <!-- Layout 1: centered circular avatars (no video anywhere) -->
  <div v-if="!hasVideo" class="stage">
    <div v-for="t in tiles" :key="t.id" class="s-tile"
         @contextmenu="emit('tileCtx', $event, { id: t.id, name: t.name, avatar: t.avatar, local: t.id === localId })">
      <div class="s-av" :class="{ speaking: t.speaking }">
        <img v-if="t.avatar" :src="t.avatar" :alt="t.name" />
        <template v-else>{{ initial(t.name) }}</template>
        <span v-if="t.muted" class="s-mute"><MicOff :size="13" :stroke-width="2.25" /></span>
      </div>
      <span class="s-name">{{ t.name }}</span>
    </div>
  </div>

  <!-- Layout 2/3: rectangular grid — or spotlight when a tile is focused.
       One loop the whole time: entering spotlight only restyles the same cells
       (the focused one becomes .is-main, the rest .is-thumb), so VideoTile nodes
       are never remounted and the video never flashes. -->
  <div v-else class="stage stage--grid" :class="{ 'stage--spotlight': inSpotlight, 'no-strip': inSpotlight && !showFilmstrip }">
    <div
      v-for="c in renderCells" :key="c.key"
      :ref="setCellEl(c.key)"
      class="g-cell"
      :class="{ speaking: c.speaking,
                'is-main':  inSpotlight && c.key === focusedKey,
                'is-thumb': inSpotlight && c.key !== focusedKey,
                'is-cell-fs': fsKey === c.key }"
      role="button"
      :title="inSpotlight && c.key === focusedKey ? 'Back to grid' : `Focus ${c.name}`"
      @click="inSpotlight && c.key === focusedKey ? unfocus() : focus(c.key)"
      @contextmenu="emit('tileCtx', $event, { id: cellOwner(c), name: c.name, avatar: cellAvatar(c), local: cellOwner(c) === localId })"
    >
      <template v-if="c.kind === 'video'">
        <!-- Fullscreen forces `contain`: a cropped camera is fine in a small
             tile, but filling a whole monitor by cutting the sides off isn't. -->
        <VideoTile :track="c.video.track"
                   :fit="fsKey === c.key || c.source === 'screen' ? 'contain' : 'cover'" />
        <span v-if="c.source === 'screen'" class="g-live">LIVE</span>
        <button class="g-fs"
                :title="fsKey === c.key ? 'Exit fullscreen' : `Fullscreen ${c.name}`"
                @click="toggleCellFs(c.key, $event)">
          <component :is="fsKey === c.key ? Minimize2 : Maximize2" :size="15" :stroke-width="2.25" />
        </button>
      </template>
      <template v-else>
        <div class="g-avwrap" :style="{ background: colorForUsername(c.name) }">
          <div class="g-av">
            <img v-if="c.avatar" :src="c.avatar" :alt="c.name" />
            <template v-else>{{ initial(c.name) }}</template>
          </div>
        </div>
        <span v-if="c.muted" class="g-mute"><MicOff :size="13" :stroke-width="2.25" /></span>
      </template>
      <span class="g-name">
        <Monitor v-if="c.kind === 'video' && c.source === 'screen'" :size="13" :stroke-width="2.25" />
        {{ c.name }}
      </span>
    </div>
  </div>
</template>

<style scoped>
button { border: none; }

/* Layout 1 — circular avatar tiles */
.stage { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; align-content: center; }
.s-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.s-av {
  width: 72px; height: 72px; border-radius: 50%; position: relative;
  background: var(--accent); color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700; box-shadow: 0 0 0 0 rgba(35,165,90,0); transition: box-shadow .15s;
}
.s-av img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.s-av.speaking { box-shadow: 0 0 0 3px #23a55a; }
.s-mute {
  position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%;
  background: #f23f43; color: #fff; display: flex; align-items: center; justify-content: center; border: 3px solid var(--bg-floor);
}
.s-name { font-size: 13px; color: var(--text-1); font-weight: 600; }

/* Layout 2 — rectangular grid */
.stage--grid {
  display: grid; gap: 10px; padding: 8px; width: 100%; height: 100%; min-height: 0;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  /* Rows share the stage's height, so tiles always FIT the call bar no matter
     how short you drag it — the video letterboxes instead of overflowing. */
  grid-auto-rows: minmax(0, 1fr);
  align-content: stretch; justify-content: center; overflow: hidden;
}
/* No aspect-ratio: it derives height from width and so OVERRIDES the grid row,
   making tiles taller than a short call bar. Cells fill their row instead and
   the video letterboxes inside — so a share always fits, at any bar height. */
.g-cell {
  position: relative; height: 100%; min-height: 0; border-radius: 8px; overflow: hidden;
  background: #0b0b0f; border: 2px solid transparent; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color .15s;
}
.g-cell.speaking { border-color: #23a55a; }
/* Grid-only hover hint: clicking focuses this tile. Suppressed in spotlight. */
.stage--grid:not(.stage--spotlight) .g-cell:hover { box-shadow: inset 0 0 0 2px rgba(255,255,255,.22); }

/* Spotlight ("big screen"): focused cell fills the top, the rest wrap into a
   thumbnail strip below. Overrides the grid display (defined after .stage--grid
   so equal-specificity source order wins). */
.stage--spotlight {
  display: flex; flex-wrap: wrap; gap: 10px; padding: 8px;
  align-content: flex-start; justify-content: center;
  /* hidden, not auto: nothing here may scroll out of the bar */
  overflow: hidden;
}
.stage--spotlight .g-cell { aspect-ratio: auto; }
/* min-height MUST stay 0. A fixed floor (this was 220px) makes the tile taller
   than the stage whenever the call bar is short, which is exactly the overflow
   the grid was already fixed for — the spotlight path just kept its own copy. */
.stage--spotlight .is-main  { order: -1; flex: 1 1 100%; height: 62%; min-height: 0; }
/* Compact spotlight: no filmstrip below, so the focused tile takes the lot. */
.stage--spotlight.no-strip .is-main { height: 100%; min-height: 0; }
/* Thumbs shrink with the bar too, or they'd push the main tile out on their own. */
.stage--spotlight .is-thumb { flex: 0 0 156px; height: min(88px, 28%); min-height: 0; }
.g-avwrap { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.g-av {
  width: 72px; height: 72px; border-radius: 50%; overflow: hidden;
  background: rgba(0,0,0,.35); color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700;
}
.g-av img { width: 100%; height: 100%; object-fit: cover; }
.g-name {
  position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 5px;
  max-width: calc(100% - 16px); padding: 3px 8px; border-radius: 6px;
  background: rgba(0,0,0,.65); color: #fff; font-size: 12px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Fullscreen button — hidden until hover so it doesn't clutter a grid of tiles,
   but always visible once fullscreen (there'd be no other way back out). */
.g-fs {
  position: absolute; right: 8px; top: 8px;
  width: 28px; height: 28px; border-radius: 6px;
  background: rgba(0,0,0,.6); color: #fff;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .12s, background .12s;
}
.g-cell:hover .g-fs, .g-cell.is-cell-fs .g-fs { opacity: 1; }
.g-fs:hover { background: rgba(0,0,0,.85); }
/* A screen share already uses the top-right for its LIVE badge. */
.g-cell:has(.g-live) .g-fs { right: 8px; top: 38px; }
/* The fullscreened cell IS the viewport — drop the tile chrome. */
.g-cell.is-cell-fs { border-radius: 0; border-color: transparent; background: #000; }
.g-live {
  position: absolute; right: 8px; top: 8px; padding: 2px 7px; border-radius: 5px;
  background: #f23f43; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: .04em;
}
.g-mute {
  position: absolute; right: 8px; bottom: 8px; width: 22px; height: 22px; border-radius: 50%;
  background: #f23f43; color: #fff; display: flex; align-items: center; justify-content: center;
}
</style>

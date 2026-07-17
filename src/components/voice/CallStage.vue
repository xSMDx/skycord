<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { PhMicrophoneSlash, PhMonitor } from '@phosphor-icons/vue'
import VideoTile from './VideoTile.vue'
import { colorForUsername } from '@/composables/useAvatar'
import { voiceSettings } from '@/composables/useVoiceSettings'
import { keyFor, type VideoTrackInfo } from '@/composables/useVoiceMedia'

const props = defineProps<{
  tiles:  { id: string; name: string; avatar: string; speaking: boolean; muted: boolean }[]
  videos: VideoTrackInfo[]
}>()

const hasVideo = computed(() => props.videos.length > 0)
const initial  = (n: string) => (n || '?').charAt(0).toUpperCase()

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
    if (!used.has(v) && !(v.local && v.source === 'camera' && !voiceSettings.showOwnCamera)) {
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

const focus  = (key: string) => { focusedKey.value = key }
const unfocus = () => { focusedKey.value = null }

// If the focused participant leaves or stops their video, the key no longer
// resolves — drop back to grid rather than freezing on an empty spotlight.
watch(cells, () => {
  if (focusedKey.value && !focusedCell.value) focusedKey.value = null
})

// Esc exits spotlight (when fullscreen is also on, the browser eats the first
// Esc for fullscreen; the next one lands here).
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && focusedKey.value) focusedKey.value = null }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- Layout 1: centered circular avatars (no video anywhere) -->
  <div v-if="!hasVideo" class="stage">
    <div v-for="t in tiles" :key="t.id" class="s-tile">
      <div class="s-av" :class="{ speaking: t.speaking }">
        <img v-if="t.avatar" :src="t.avatar" :alt="t.name" />
        <template v-else>{{ initial(t.name) }}</template>
        <span v-if="t.muted" class="s-mute"><PhMicrophoneSlash :size="13" weight="fill" /></span>
      </div>
      <span class="s-name">{{ t.name }}</span>
    </div>
  </div>

  <!-- Layout 2/3: rectangular grid — or spotlight when a tile is focused.
       One loop the whole time: entering spotlight only restyles the same cells
       (the focused one becomes .is-main, the rest .is-thumb), so VideoTile nodes
       are never remounted and the video never flashes. -->
  <div v-else class="stage stage--grid" :class="{ 'stage--spotlight': inSpotlight }">
    <div
      v-for="c in cells" :key="c.key"
      class="g-cell"
      :class="{ speaking: c.speaking,
                'is-main':  inSpotlight && c.key === focusedKey,
                'is-thumb': inSpotlight && c.key !== focusedKey }"
      role="button"
      :title="inSpotlight && c.key === focusedKey ? 'Back to grid' : `Focus ${c.name}`"
      @click="inSpotlight && c.key === focusedKey ? unfocus() : focus(c.key)"
    >
      <template v-if="c.kind === 'video'">
        <VideoTile :track="c.video.track" :fit="c.source === 'screen' ? 'contain' : 'cover'" />
        <span v-if="c.source === 'screen'" class="g-live">LIVE</span>
      </template>
      <template v-else>
        <div class="g-avwrap" :style="{ background: colorForUsername(c.name) }">
          <div class="g-av">
            <img v-if="c.avatar" :src="c.avatar" :alt="c.name" />
            <template v-else>{{ initial(c.name) }}</template>
          </div>
        </div>
        <span v-if="c.muted" class="g-mute"><PhMicrophoneSlash :size="13" weight="fill" /></span>
      </template>
      <span class="g-name">
        <PhMonitor v-if="c.kind === 'video' && c.source === 'screen'" :size="13" weight="fill" />
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
  display: grid; gap: 10px; padding: 8px; width: 100%; height: 100%;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  align-content: center; justify-content: center; overflow: auto;
}
.g-cell {
  position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden;
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
  align-content: flex-start; justify-content: center; overflow: auto;
}
.stage--spotlight .g-cell { aspect-ratio: auto; }
.stage--spotlight .is-main  { order: -1; flex: 1 1 100%; height: 62%; min-height: 220px; }
.stage--spotlight .is-thumb { flex: 0 0 156px; height: 88px; }
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
.g-live {
  position: absolute; right: 8px; top: 8px; padding: 2px 7px; border-radius: 5px;
  background: #f23f43; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: .04em;
}
.g-mute {
  position: absolute; right: 8px; bottom: 8px; width: 22px; height: 22px; border-radius: 50%;
  background: #f23f43; color: #fff; display: flex; align-items: center; justify-content: center;
}
</style>

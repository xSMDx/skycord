<script setup lang="ts">
import { computed } from 'vue'
import { PhMicrophoneSlash, PhMonitor } from '@phosphor-icons/vue'
import VideoTile from './VideoTile.vue'
import { colorForUsername } from '@/composables/useAvatar'
import type { VideoTrackInfo } from '@/composables/useVoiceMedia'

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
  for (const t of props.tiles) {
    const mine = props.videos.filter(v => v.participantId === t.id)
    if (mine.length) {
      for (const v of mine) {
        out.push({ kind: 'video', key: `${t.id}:${v.source}`, name: t.name, speaking: t.speaking, source: v.source, video: v })
      }
    } else {
      out.push({ kind: 'avatar', key: t.id, name: t.name, speaking: t.speaking, muted: t.muted, avatar: t.avatar })
    }
  }
  return out
})
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

  <!-- Layout 2: rectangular grid (any video present) -->
  <div v-else class="stage stage--grid">
    <div v-for="c in cells" :key="c.key" class="g-cell" :class="{ speaking: c.speaking }">
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
  background: #0b0b0f; border: 2px solid transparent;
  display: flex; align-items: center; justify-content: center;
}
.g-cell.speaking { border-color: #23a55a; }
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

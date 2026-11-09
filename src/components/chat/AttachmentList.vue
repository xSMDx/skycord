<script setup lang="ts">
/**
 * The files sent with a message, under its text.
 *
 * Photos and videos share one box (the mosaic the owner chose over even
 * squares): one keeps its own shape, two sit side by side, three are one
 * tall and two stacked, four are 2×2, and past four the last tile counts the
 * rest. Clicking a tile opens the large view at it. A single video plays in
 * place with ordinary controls — never on its own — in a 16:9 box, letterboxed,
 * so nothing moves when a portrait clip's size arrives.
 *
 * Everything else is a card: type icon, name (the extension stays visible),
 * type and size, and a download button. The name downloads too.
 *
 * Each image's box is reserved from the width and height the server read out
 * of the file, so the conversation does not jump as photos arrive.
 */
import { computed, ref } from 'vue'
import { Download, Play, Maximize2, ImageOff, FileText, FileSpreadsheet, FileArchive, FileAudio, FileCode, File as FileIcon } from 'lucide-vue-next'
import type { Attachment } from '@/types'
import { mosaicLayout, splitName, formatBytes, fileTypeLabel, fileIconFor } from '@/utils/attachments'
import GifImage from './GifImage.vue'
import MediaViewer from './MediaViewer.vue'

const props = defineProps<{ attachments: Attachment[]; author: string }>()

const media = computed(() => props.attachments.filter(a => a.kind === 'image' || a.kind === 'video'))
const files = computed(() => props.attachments.filter(a => a.kind === 'file'))
const layout = computed(() => mosaicLayout(media.value.length))
const tiles = computed(() => media.value.slice(0, layout.value.shown))
const single = computed(() => (media.value.length === 1 ? media.value[0] : null))

/** A lone image's own shape, scaled into 400×300; 4:3 when its size is unknown. */
const singleBox = computed(() => {
  const a = single.value
  if (!a || a.kind !== 'image') return {}
  if (!a.width || !a.height) return { width: '400px', aspectRatio: '4 / 3' }
  const scale = Math.min(1, 400 / a.width, 300 / a.height)
  return { width: `${Math.max(1, Math.round(a.width * scale))}px`, aspectRatio: `${a.width} / ${a.height}` }
})

const broken = ref<Record<string, boolean>>({})
const isGif = (a: Attachment) => a.mime === 'image/gif'

const ICONS = { doc: FileText, sheet: FileSpreadsheet, archive: FileArchive, audio: FileAudio, code: FileCode, file: FileIcon }
const iconFor = (a: Attachment) => ICONS[fileIconFor(a.name)]

const viewerAt = ref<number | null>(null)
const open = (i: number) => { viewerAt.value = i }
</script>

<template>
  <div class="att">
    <!-- One photo or GIF: its own shape. -->
    <button v-if="single && single.kind === 'image'" type="button" class="media one" :style="singleBox"
      :aria-label="`Open ${single.name}`" @click="open(0)">
      <span v-if="broken[single.key]" class="broken"><ImageOff :size="22" :stroke-width="1.5" />{{ single.name }}</span>
      <GifImage v-else-if="isGif(single)" :src="single.url" :alt="single.name" />
      <img v-else :src="single.url" :alt="single.name" loading="lazy" draggable="false" @error="broken[single.key] = true" />
    </button>

    <!-- One video: plays here, with its own controls. -->
    <div v-else-if="single" class="media one video">
      <video :src="single.url" preload="metadata" controls playsinline :aria-label="single.name" />
      <button type="button" class="expand" v-tip="'Open large'" :aria-label="`Open ${single.name} large`" @click="open(0)">
        <Maximize2 :size="16" :stroke-width="2" />
      </button>
    </div>

    <!-- Two or more: one box. -->
    <div v-else-if="media.length" :class="['mosaic', layout.template]">
      <button v-for="(a, i) in tiles" :key="a.key" type="button" class="media tile"
        :aria-label="`Open ${a.name}`" @click="open(i)">
        <span v-if="broken[a.key]" class="broken"><ImageOff :size="20" :stroke-width="1.5" /></span>
        <template v-else-if="a.kind === 'video'">
          <video :src="a.url" preload="metadata" muted playsinline tabindex="-1" />
          <span class="play" aria-hidden="true"><Play :size="20" :stroke-width="2" /></span>
        </template>
        <GifImage v-else-if="isGif(a)" :src="a.url" :alt="a.name" />
        <img v-else :src="a.url" :alt="a.name" loading="lazy" draggable="false" @error="broken[a.key] = true" />
        <span v-if="i === tiles.length - 1 && layout.extra" class="more">+{{ layout.extra }}</span>
      </button>
    </div>

    <!-- Everything else: a card each. -->
    <div v-for="a in files" :key="a.key" class="file">
      <span class="ftile" aria-hidden="true"><component :is="iconFor(a)" :size="22" :stroke-width="1.5" /></span>
      <span class="finfo">
        <a class="fname" :href="a.url" :download="a.name" :title="a.name">
          <span class="stem">{{ splitName(a.name).stem }}</span><span class="ext">{{ splitName(a.name).ext }}</span>
        </a>
        <span class="fmeta">{{ fileTypeLabel(a.name) }} · {{ formatBytes(a.size) }}</span>
      </span>
      <a class="dl" :href="a.url" :download="a.name" v-tip="'Download'" :aria-label="`Download ${a.name}`">
        <Download :size="18" :stroke-width="1.75" />
      </a>
    </div>

    <MediaViewer v-if="viewerAt !== null" :items="media" :start="viewerAt" :author="author" @close="viewerAt = null" />
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; }
button { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }

.att { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 6px; max-width: 100%; }

.media {
  position: relative; display: block; overflow: hidden;
  border-radius: var(--edge-lg); background: var(--bg-input);
  cursor: zoom-in;
}
.media img, .media video { display: block; width: 100%; height: 100%; object-fit: cover; }
.media.one { max-width: 100%; max-height: 300px; }
.media.one img { object-fit: contain; }
@media (hover: hover) and (pointer: fine) {
  .media:hover img { filter: brightness(1.06); }
}
.media:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
/* A GIF fills its tile like a photo does. */
.media :deep(.gif) { display: block; width: 100%; height: 100%; border-radius: 0; }
.media :deep(.gif img) { width: 100%; height: 100%; max-width: none; max-height: none; object-fit: cover; }

/* A video is always 16:9, letterboxed: no jump when a portrait clip loads. */
.media.video { width: 400px; aspect-ratio: 16 / 9; cursor: default; background: var(--bg-floor); }
.media.video video { object-fit: contain; }
.expand {
  position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: var(--edge-md);
  display: grid; place-items: center; background: var(--media-veil); color: var(--on-media);
  opacity: 0; transition: opacity var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.expand:hover { background: var(--media-veil-strong); }
.media.video:hover .expand, .expand:focus-visible { opacity: 1; }

.mosaic {
  display: grid; gap: 4px; width: 400px; max-width: 100%; aspect-ratio: 4 / 3;
  border-radius: var(--edge-lg); overflow: hidden;
}
.mosaic .media { border-radius: 0; width: 100%; height: 100%; }
.mosaic.two { grid-template-columns: 1fr 1fr; }
.mosaic.three { grid-template-columns: 2fr 1fr; grid-template-rows: 1fr 1fr; }
.mosaic.three .tile:first-child { grid-row: 1 / span 2; }
.mosaic.four { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.play {
  position: absolute; inset: 0; margin: auto; width: 48px; height: 48px; border-radius: 50%;
  display: grid; place-items: center; background: var(--media-veil-strong); color: var(--on-media);
}
.play svg { margin-left: 3px; fill: currentColor; }
.more {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: var(--media-veil-strong); color: var(--on-media);
  font-size: 22px; font-weight: 700;
}
.broken {
  width: 100%; height: 100%; min-height: 80px; padding: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-3); font-size: 12px; text-align: center; word-break: break-word;
}

.file {
  display: flex; align-items: center; gap: 12px; width: 420px; max-width: 100%;
  padding: 10px 4px 10px 12px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--edge-lg);
}
.ftile {
  width: 40px; height: 40px; flex-shrink: 0; border-radius: var(--edge-md);
  display: grid; place-items: center; background: var(--bg-input); color: var(--text-2);
}
.finfo { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.fname {
  display: flex; min-width: 0; font-size: 14.5px; font-weight: 600; line-height: 1.3;
  color: var(--text-link); text-decoration: var(--link-decoration, none);
}
.fname:hover { text-decoration: underline; }
.stem { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ext { flex-shrink: 0; white-space: nowrap; }
.fmeta { font-size: 12.5px; color: var(--text-3); }
.dl {
  width: 44px; height: 44px; flex-shrink: 0; border-radius: var(--edge-md);
  display: grid; place-items: center; color: var(--icon);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.dl:hover { background: var(--hover-strong); color: var(--text-1); }
.dl:active { transform: scale(.94); }

/* Phone: the box takes the message column; controls stay finger-sized. */
@media (max-width: 768px) {
  .media.video, .mosaic, .file { width: 100%; }
  .media.one { max-height: 300px; }
  .expand { opacity: 1; width: 44px; height: 44px; top: 6px; right: 6px; }
}
</style>

<script setup lang="ts">
/**
 * The files waiting to go with the next message, inside the composer box and
 * above the text. One tile each: a thumbnail for a photo, a type icon for
 * anything else, the name underneath, and a × in the corner.
 *
 * The bar under a tile is its upload. A tile that cannot go says why under
 * it, in red, and keeps Send blocked until it is removed — or retried, when
 * the failure was the network rather than the file.
 */
import { X, RotateCw, CircleAlert, Film, FileText, FileSpreadsheet, FileArchive, FileAudio, FileCode, File as FileIcon } from 'lucide-vue-next'
import type { TrayItem } from '@/composables/useAttachmentTray'
import { fileIconFor } from '@/utils/attachments'

defineProps<{ items: TrayItem[] }>()
const emit = defineEmits<{ remove: [id: string]; retry: [id: string] }>()

const ICONS = { doc: FileText, sheet: FileSpreadsheet, archive: FileArchive, audio: FileAudio, code: FileCode, file: FileIcon }
const iconFor = (item: TrayItem) => (item.kind === 'video' ? Film : ICONS[fileIconFor(item.name)])

const label = (item: TrayItem) =>
  item.state === 'uploading' ? `${item.name}, uploading ${Math.round(item.progress * 100)}%`
  : item.error ? `${item.name}: ${item.error}` : item.name
</script>

<template>
  <ul class="tray" aria-label="Files to send">
    <li v-for="item in items" :key="item.id" class="tile" :class="item.state" :aria-label="label(item)">
      <div class="thumb">
        <img v-if="item.previewUrl" :src="item.previewUrl" alt="" draggable="false" />
        <component :is="iconFor(item)" v-else :size="28" :stroke-width="1.5" />
        <span v-if="item.state === 'uploading'" class="rail" aria-hidden="true">
          <i :style="{ transform: `scaleX(${item.progress})` }" />
        </span>
      </div>
      <p v-if="item.error" class="name err">
        <CircleAlert :size="13" :stroke-width="2" aria-hidden="true" />
        <span>{{ item.error }}</span>
      </p>
      <p v-else class="name">{{ item.name }}</p>
      <button v-if="item.state === 'failed'" type="button" class="retry" v-tip="'Try again'" @click.stop="emit('retry', item.id)">
        <RotateCw :size="13" :stroke-width="2" /> Retry
      </button>
      <button type="button" class="x" :aria-label="item.state === 'uploading' ? `Cancel ${item.name}` : `Remove ${item.name}`"
        v-tip="item.state === 'uploading' ? 'Cancel' : 'Remove'" @click.stop="emit('remove', item.id)">
        <X :size="13" :stroke-width="2.25" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

/* A full-width row of its own inside the composer's flex box, cut off from
   the text by a hairline — the same box, not a second one. */
.tray {
  flex: 1 0 100%; order: -1;
  display: flex; gap: 12px; list-style: none;
  padding: 12px 8px 10px 8px; margin: 0 -8px 0 -4px;
  border-bottom: 1px solid var(--divider);
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin;
}
.tile { position: relative; width: 96px; flex-shrink: 0; }
.thumb {
  position: relative; width: 96px; height: 96px;
  border-radius: var(--edge-md); overflow: hidden;
  background: var(--bg-input); color: var(--text-2);
  display: grid; place-items: center;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.uploading .thumb img { opacity: .55; transition: opacity var(--dur-2) var(--ease-out); }
.refused .thumb, .failed .thumb { box-shadow: inset 0 0 0 1.5px rgba(var(--danger-rgb), .7); }

/* The upload. Scaled, not resized, so it moves on the compositor. */
.rail {
  position: absolute; left: 6px; right: 6px; bottom: 6px; height: 4px;
  border-radius: 2px; background: var(--track); overflow: hidden;
}
.rail i {
  display: block; height: 100%; border-radius: 2px; background: var(--accent); color: var(--text-on-accent);
  transform-origin: left center; transition: transform var(--dur-2) var(--ease-out);
}

.name {
  margin-top: 4px; font-size: 12px; line-height: 1.35; color: var(--text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.name.err { display: flex; align-items: flex-start; gap: 4px; white-space: normal; color: var(--danger-text); }
.name.err svg { flex-shrink: 0; margin-top: 1px; }

.retry {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 2px;
  font-size: 12px; font-weight: 600; color: var(--text-link);
  border-radius: var(--edge-sm); padding: 2px 4px; margin-left: -4px;
}
.retry:hover { background: var(--hover); }

/* The ×: a small dark disc ringed in the composer's own colour, so it reads
   as sitting on the tile's corner rather than inside it. */
.x {
  position: absolute; top: -6px; right: -6px;
  width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--bg-floor); color: var(--text-1);
  box-shadow: 0 0 0 2px var(--bg-chatbar);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.x:hover { background: var(--danger); color: var(--text-on-danger); }
.x:active { transform: scale(.92); }

/* Phone: smaller tiles that scroll sideways, and controls a finger can hit.
   The × keeps its small disc; the 44px is the transparent ring around it. */
@media (max-width: 768px) {
  .tray { gap: 14px; padding-top: 14px; }
  .tile, .thumb { width: 76px; }
  .thumb { height: 76px; }
  .x { top: -10px; right: -10px; width: 44px; height: 44px; min-width: 44px; background: transparent; box-shadow: none; isolation: isolate; }
  .x::before {
    content: ''; position: absolute; inset: 10px; border-radius: 50%;
    background: var(--bg-floor); box-shadow: 0 0 0 2px var(--bg-chatbar); z-index: -1;
  }
  .x:hover { background: transparent; }
  .retry { min-height: 44px; }
}
</style>

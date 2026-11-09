<script setup lang="ts">
/**
 * The large view of a message's photos and videos.
 *
 * As big as fits on a dark backdrop. Name and who sent it, top left;
 * download, open the original, close, top right. Arrows and "2 of 3" when the
 * message has more than one. Escape, a click on the backdrop or a downward
 * swipe closes it; the arrow keys step through.
 *
 * "Open original" exists only in a browser. In the Windows app a link to the
 * app's own server opened in a new window loads in the app's window instead
 * (desktop/src/main.ts, setWindowOpenHandler) — it would replace Skycord with
 * a bare image — so wherever an app bridge is present, download is the way
 * out. Videos do not play on their own here either.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { X, Download, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import type { Attachment } from '@/types'
import { formatBytes } from '@/utils/attachments'
import { appBridge } from '@/composables/desktopBridge'

const props = defineProps<{ items: Attachment[]; start: number; author: string }>()
const emit = defineEmits<{ close: [] }>()

const index = ref(Math.min(Math.max(0, props.start), props.items.length - 1))
const current = computed(() => props.items[index.value])
const inApp = appBridge() !== null
const many = computed(() => props.items.length > 1)

const close = () => emit('close')
const step = (by: number) => {
  if (!many.value) return
  index.value = (index.value + by + props.items.length) % props.items.length
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
}

// A downward drag past 80px closes, the way a photo viewer on a phone does.
let downY: number | null = null
const dragY = ref(0)
const onPointerDown = (e: PointerEvent) => { if (e.pointerType !== 'mouse') downY = e.clientY }
const onPointerMove = (e: PointerEvent) => { if (downY !== null) dragY.value = Math.max(0, e.clientY - downY) }
const onPointerUp = () => {
  if (downY === null) return
  const far = dragY.value > 80
  downY = null; dragY.value = 0
  if (far) close()
}

const closeBtn = ref<HTMLButtonElement | null>(null)
let returnTo: HTMLElement | null = null
onMounted(() => {
  returnTo = document.activeElement as HTMLElement | null
  closeBtn.value?.focus()
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  returnTo?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mv" appear>
      <div class="mv" role="dialog" aria-modal="true" :aria-label="current.name"
        @click.self="close" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
        <header class="bar">
          <div class="who">
            <b>{{ current.name }}</b>
            <small>{{ author }} · {{ formatBytes(current.size) }}</small>
          </div>
          <a class="btn" :href="current.url" :download="current.name" v-tip="'Download'" :aria-label="`Download ${current.name}`">
            <Download :size="20" :stroke-width="1.75" />
          </a>
          <a v-if="!inApp" class="btn" :href="current.url" target="_blank" rel="noopener" v-tip="'Open original'" aria-label="Open original">
            <ExternalLink :size="20" :stroke-width="1.75" />
          </a>
          <button ref="closeBtn" type="button" class="btn" v-tip="'Close'" aria-label="Close" @click="close">
            <X :size="22" :stroke-width="2" />
          </button>
        </header>

        <div class="stage" :style="dragY ? { transform: `translateY(${dragY}px)`, opacity: String(Math.max(.4, 1 - dragY / 400)) } : undefined"
          @click.self="close">
          <img v-if="current.kind === 'image'" :key="current.key" :src="current.url" :alt="current.name" draggable="false" />
          <video v-else :key="current.key" :src="current.url" controls playsinline preload="metadata" :aria-label="current.name" />
        </div>

        <template v-if="many">
          <button type="button" class="nav l" aria-label="Previous" @click="step(-1)"><ChevronLeft :size="24" :stroke-width="2" /></button>
          <button type="button" class="nav r" aria-label="Next" @click="step(1)"><ChevronRight :size="24" :stroke-width="2" /></button>
          <p class="count" aria-live="polite">{{ index + 1 }} of {{ items.length }}</p>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; }
button { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }

.mv {
  position: fixed; inset: 0; z-index: 1000;
  background: var(--media-veil-strong);
  color: var(--on-media);
  touch-action: pan-x;
}
.bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 2;
  display: flex; align-items: center; gap: 4px;
  padding: max(10px, env(safe-area-inset-top)) 12px 10px 20px;
}
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.who b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who small { font-size: 12px; opacity: .75; }
.btn {
  width: 44px; height: 44px; flex-shrink: 0; border-radius: var(--edge-md);
  display: grid; place-items: center; color: var(--on-media);
  transition: background var(--dur-1) var(--ease-out);
}
.btn:hover { background: var(--media-veil); }
.btn:focus-visible, .nav:focus-visible { outline: 2px solid var(--on-media); outline-offset: 2px; }

.stage {
  position: absolute; inset: 64px 80px 52px; display: grid; place-items: center;
  transition: transform var(--dur-2) var(--ease-out), opacity var(--dur-2) var(--ease-out);
}
.stage img, .stage video {
  max-width: 100%; max-height: 100%; display: block;
  border-radius: var(--edge-md); box-shadow: var(--shadow-md);
}
.nav {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; background: var(--media-veil); color: var(--on-media);
  transition: background var(--dur-1) var(--ease-out);
}
.nav:hover { background: var(--media-veil-strong); }
.nav.l { left: 20px; }
.nav.r { right: 20px; }
.count { position: absolute; bottom: 16px; left: 0; right: 0; margin: 0; text-align: center; font-size: 12.5px; opacity: .8; }

.mv-enter-active { transition: opacity var(--dur-3) var(--ease-out); }
.mv-enter-active .stage { transition: transform var(--dur-3) var(--ease-out); }
.mv-leave-active { transition: opacity var(--dur-exit) var(--ease-in); }
.mv-enter-from, .mv-leave-to { opacity: 0; }
.mv-enter-from .stage { transform: scale(.97); }

@media (max-width: 768px) {
  .stage { inset: 60px 8px 56px; }
  .nav.l { left: 8px; }
  .nav.r { right: 8px; }
}
</style>

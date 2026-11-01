<script setup lang="ts">
/**
 * Bottom sheet — the mobile stand-in for a side panel or popover.
 *
 * Members and Profile are a glance at context, not a place you travel to: you
 * want to see who's in the group and get back without losing your scroll
 * position. A pushed screen would be the wrong grammar for that; a sheet keeps
 * the conversation visible behind it.
 *
 * Drag-to-dismiss follows the finger 1:1, rubber-bands upward past the top, and
 * decides on release from projected velocity rather than distance — so a short
 * flick down closes it and a slow drag that stalls springs back.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { project, rubber, velocityOf } from '@/composables/sheetDrag'

const props = withDefaults(defineProps<{
  open: boolean
  /** The sheet's heading, and its name for a screen reader. A `head` slot may draw the heading instead. */
  title?: string
  /**
   * Fraction of the viewport the sheet occupies — or 'fit': as tall as what
   * it holds, up to near the top of the screen, for a short sheet of controls
   * that a fixed height would leave half empty.
   */
  height?: number | 'fit'
}>(), { title: '', height: 0.72 })

defineSlots<{
  default?(): unknown
  /** The heading row, in place of the title's text. */
  head?(): unknown
}>()

const emit = defineEmits<{ close: [] }>()

const sheet = ref<HTMLElement | null>(null)
const body  = ref<HTMLElement | null>(null)

/** Live drag offset in px. 0 = fully open. */
const dragY = ref(0)
const dragging = ref(false)

const DISMISS_AT = 0.35      // fraction of sheet height past which we close

let startY = 0
let samples: { y: number; t: number }[] = []
let active = false

const onDown = (e: PointerEvent) => {
  // A sheet whose body is scrolled must scroll, not drag — otherwise the two
  // gestures fight on every touch and the list feels broken.
  if (body.value && body.value.scrollTop > 0) return
  active = true
  dragging.value = true
  startY = e.clientY
  samples = [{ y: e.clientY, t: performance.now() }]
}

const onMove = (e: PointerEvent) => {
  if (!active) return
  const dy = e.clientY - startY
  samples.push({ y: e.clientY, t: performance.now() })
  if (samples.length > 5) samples.shift()
  const h = sheet.value?.offsetHeight || 1
  dragY.value = dy >= 0 ? dy : -rubber(-dy, h)
}

const onUp = () => {
  if (!active) return
  active = false
  dragging.value = false
  const h = sheet.value?.offsetHeight || 1
  const projected = dragY.value + project(velocityOf(samples))
  if (projected > h * DISMISS_AT) emit('close')
  else dragY.value = 0
}

// Reset whenever it reopens, or a sheet dismissed by drag would reappear
// already pushed halfway down.
watch(() => props.open, o => { if (o) dragY.value = 0 })

const style = computed(() => ({
  height: props.height === 'fit' ? undefined : `${Math.round(props.height * 100)}dvh`,
  transform: dragY.value ? `translate3d(0, ${dragY.value}px, 0)` : '',
  transition:dragging.value ? 'none' : undefined,
}))

/** Scrim fades as the sheet is dragged away — the two are one gesture. */
const scrimStyle = computed(() => {
  const h = sheet.value?.offsetHeight || 1
  const p = Math.min(1, Math.max(0, dragY.value / h))
  return { opacity: String(1 - p * 0.85), transition:dragging.value ? 'none' : undefined }
})

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && props.open) emit('close') }
watch(() => props.open, o => {
  if (o) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="bs-root">
        <!-- 40-60% scrim: strong enough to isolate the sheet without hiding
             where you came from. -->
        <div class="bs-scrim" :style="scrimStyle" @click="emit('close')" />

        <div
          ref="sheet" class="bs" :class="{ fit: height === 'fit' }" :style="style"
          role="dialog" aria-modal="true" :aria-label="title"
          @pointerdown="onDown" @pointermove="onMove"
          @pointerup="onUp" @pointercancel="onUp"
        >
          <div class="bs-grab"><span /></div>
          <div v-if="title || $slots.head" class="bs-head"><slot name="head">{{ title }}</slot></div>
          <div ref="body" class="bs-body"><slot /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bs-root { position: fixed; inset: 0; z-index: 950; }
.bs-scrim { position: absolute; inset: 0; background: var(--scrim); }

.bs {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column;
  background: var(--bg-raised);
  border-radius: 16px 16px 0 0;
  box-shadow: var(--shadow-sheet);
  /* The home indicator sits under the sheet's own bottom edge. */
  padding-bottom: env(safe-area-inset-bottom);
  transition: transform var(--dur-4) var(--ease-out);
  touch-action: none;   /* the sheet owns vertical drag; the body re-enables it */
}

/* Sized by its content. A percentage of the root, not dvh, which the Android
   app's Chromium 86 WebView does not know. 48px keeps the scrim showing
   above it, so it still reads as a sheet over the screen; past that its body
   scrolls. The body's basis is its content, not flex: 1's 0%, which an older
   WebView can take as zero in a box with no set height; min-height 0 still
   lets it shrink. */
.bs.fit { max-height: calc(100% - 48px); }
.bs.fit .bs-body { flex: 0 1 auto; }

.bs-grab { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0 }
.bs-grab span { width: 36px; height: 4px; border-radius: 2px; background: var(--grabber) }

.bs-head {
  flex-shrink: 0; padding: 6px 16px 12px;
  font-size: 16px; font-weight: 700; color: var(--text-strong);
  letter-spacing: -.01em;
}

.bs-body {
  flex: 1; min-height: 0; overflow: hidden auto;
  padding: 0 12px 12px;
  touch-action: pan-y;              /* scrolling works inside */
  overscroll-behavior: contain;     /* and doesn't bleed to the page behind */
}

/* Enter/exit along the same path — it came from the bottom, it leaves there. */
.sheet-enter-active .bs { transition: transform var(--dur-4) var(--ease-out) }
.sheet-leave-active .bs { transition: transform var(--dur-exit) var(--ease-in) }
.sheet-enter-active .bs-scrim { transition: opacity var(--dur-3) var(--ease-out) }
.sheet-leave-active .bs-scrim { transition: opacity var(--dur-exit) var(--ease-in) }
.sheet-enter-from .bs, .sheet-leave-to .bs { transform: translate3d(0, 100%, 0) }
.sheet-enter-from .bs-scrim, .sheet-leave-to .bs-scrim { opacity: 0 }

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active .bs, .sheet-leave-active .bs { transition: opacity var(--dur-3) var(--ease-out)}
  .sheet-enter-from .bs, .sheet-leave-to .bs { transform: none; opacity: 0 }
}
</style>

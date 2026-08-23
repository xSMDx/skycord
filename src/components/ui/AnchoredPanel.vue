<script setup lang="ts">
/**
 * A floating panel pinned beside something.
 *
 * Extracted because two surfaces needed the same behaviour on the same day —
 * the "Invite to Voice" list and the status duration submenu — and both had
 * first been built as inline expansions, which pushed the list they belonged
 * to further down the page and made a six-item menu something you scroll to
 * reach. A menu that opens *beside* its trigger costs the layout nothing.
 *
 * Teleported and `position: fixed`, for the same reason `ProfilePopout` is:
 * the sidebar is 234px wide and scrolls, so anything anchored inside it gets
 * clipped the moment it is wider than the strip it grew out of.
 *
 * Placement is a preference, not a promise — it flips to the other side and
 * then clamps to the viewport, so a trigger near an edge still yields a panel
 * that is entirely on screen.
 *
 * `data-anchored-panel` on the root is a contract, not decoration. A panel
 * teleported out of a parent that closes on outside-pointerdown is, by the
 * DOM's reckoning, outside that parent — so the parent would tear this down
 * on the very pointerdown that was trying to click a row inside it, and the
 * click would never land. Parents with that behaviour check for the marker
 * and let it through (see ProfilePopout.onDocDown).
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  anchor: HTMLElement | null
  /** Preferred side. Flips automatically when there is no room. */
  placement?: 'right' | 'left'
  /** Align the panel's top with the anchor's top, or its bottom with the anchor's bottom. */
  align?: 'top' | 'bottom'
  width?: number
}>(), { placement: 'right', align: 'top', width: 220 })

const emit = defineEmits<{ close: [] }>()

const GAP = 8, EDGE = 8
const panel = ref<HTMLElement | null>(null)
const pos   = ref<{ left: number; top: number } | null>(null)

const place = async () => {
  await nextTick()
  const a = props.anchor?.getBoundingClientRect()
  const p = panel.value
  if (!a || !p) return
  const w = p.offsetWidth, h = p.offsetHeight

  let left = props.placement === 'right' ? a.right + GAP : a.left - w - GAP
  // No room on the preferred side — try the other one before clamping, so a
  // panel never ends up sitting on top of the thing it belongs to.
  if (left + w > window.innerWidth - EDGE) left = a.left - w - GAP
  if (left < EDGE)                          left = a.right + GAP

  let top = props.align === 'bottom' ? a.bottom - h : a.top
  if (top + h > window.innerHeight - EDGE) top = window.innerHeight - h - EDGE

  pos.value = {
    left: Math.min(Math.max(EDGE, left), window.innerWidth  - w - EDGE),
    top:  Math.min(Math.max(EDGE, top),  window.innerHeight - h - EDGE),
  }
}

// Re-place when the anchor changes identity (a different row opened it) and
// on anything that can move it out from under the panel.
watch(() => props.anchor, place)
onMounted(() => {
  place()
  window.addEventListener('resize', place)
  // Capture phase: a scroll inside the sidebar does not bubble to window.
  window.addEventListener('scroll', place, true)
  document.addEventListener('keydown', onKey)
  // Deferred: the very click that opened this panel is still propagating, and
  // binding synchronously would let it close the panel it just opened.
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onOutside)
})

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
const onOutside = (e: PointerEvent) => {
  const t = e.target as Node
  if (panel.value?.contains(t)) return
  // The anchor's own handler toggles this panel; closing here too would make
  // a click on it close and immediately reopen.
  if (props.anchor?.contains(t)) return
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="ap"
      data-anchored-panel
      :style="{
        left:  pos ? pos.left + 'px' : '-9999px',
        top:   pos ? pos.top  + 'px' : '0px',
        width: width + 'px',
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.ap {
  position: fixed;
  z-index: 1300;              /* above ProfilePopout (1200), below modals */
  background: var(--bg-floating, var(--bg-panel));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .32);
  padding: 6px;
  max-height: 60vh;
  overflow-y: auto;
}
</style>

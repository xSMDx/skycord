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

  /**
   * Place beside the floating CONTAINER the anchor lives in, not beside the
   * anchor itself.
   *
   * A menu row is inset from the edge of the popout holding it, so measuring
   * from the row put this panel ten pixels inside that popout — overlapping
   * the thing it belongs to. It compounds with each cascade level, since the
   * next panel measures from a chevron inset inside THIS one.
   *
   * Anything already floating counts as a container: another AnchoredPanel,
   * or the profile popout. A row that is not inside one measures from itself,
   * which is what a sidebar row wants.
   */
  const host = props.anchor?.closest('[data-anchored-panel], .pp') as HTMLElement | null
  const hb = host && host !== p ? host.getBoundingClientRect() : a

  let left = props.placement === 'right' ? hb.right + GAP : hb.left - w - GAP
  // No room on the preferred side — try the other one before clamping, so a
  // panel never ends up sitting on top of the thing it belongs to.
  if (left + w > window.innerWidth - EDGE) left = hb.left - w - GAP
  if (left < EDGE)                          left = hb.right + GAP

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
    <!-- Always mounted, because place() measures this element to decide
         where it goes; a v-if on `pos` would mean it can never be measured
         and so never positioned. It parks off-screen until then, and
         materialises when it gains `ap--in`. -->
    <div
      ref="panel"
      class="ap"
      :class="{ 'ap--in': !!pos }"
      data-anchored-panel
      :style="{
        left:  pos ? pos.left + 'px' : '-9999px',
        top:   pos ? pos.top  + 'px' : '0px',
        width: width + 'px',
        transformOrigin: placement === 'right' ? 'left center' : 'right center',
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
  /* A menu is a medium-weight material: heavy enough to separate itself from
     the content it covers, light enough to read as floating above it. The
     inset top line is light catching the lip; the outer hairline is its body.
     Both degrade to solid colour under prefers-reduced-transparency. */
  background: var(--mat-medium);
  backdrop-filter: blur(var(--mat-blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--mat-blur)) saturate(180%);
  box-shadow:
    inset 0 1px 0 var(--mat-lip),
    0 0 0 1px var(--mat-hairline),
    var(--shadow-2);
  border-radius: var(--edge-3);
  padding: 6px;
  max-height: 60vh;
  overflow-y: auto;
}

/* Materialise, don't just fade: blur, scale and opacity move together so the
   panel reads as a surface arriving rather than an image cross-fading in. It
   grows out of the row that spawned it — transform-origin follows placement.

   Exit is still instant: the parent unmounts this with a v-if, so there is no
   leave phase to animate. That is the same gap ModalBase has across 21
   surfaces, and it gets fixed once, there, rather than papered over here. */
.ap { opacity: 0; transform: translateX(-6px) scale(.97);
      transition: opacity var(--dur-2) var(--ease-out),
                  transform var(--dur-2) var(--ease-out); }
.ap.ap--in { opacity: 1; transform: none; }
</style>

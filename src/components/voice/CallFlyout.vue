<script setup lang="ts">
/**
 * Anchored popover for call controls. The parent wraps the anchor button in a
 * position:relative container and v-if's this component inside it.
 *
 * Positioning is FIXED, measured from the anchor, not absolute. Absolute
 * positioning is clipped by any ancestor with `overflow: hidden` — which the
 * left sidebar has — so the user-panel menus rendered squashed inside the panel
 * instead of floating above it. Fixed escapes the clip, at the cost of having
 * to compute coordinates and re-measure on resize.
 */
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = withDefaults(defineProps<{ dir?: 'down' | 'up' }>(), { dir: 'down' })
const emit = defineEmits<{ close: [] }>()

const root  = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const pos   = ref<{ left: number; top: number } | null>(null)

const GAP = 12
const EDGE = 8   // keep this clear of the viewport

const place = async () => {
  await nextTick()
  // The anchor is this component's own placeholder — its parent is the
  // relative container the caller wrapped the button in.
  const anchor = root.value?.parentElement
  const p = panel.value
  if (!anchor || !p) return

  const a = anchor.getBoundingClientRect()
  const w = p.offsetWidth, h = p.offsetHeight

  let left = a.left + a.width / 2 - w / 2
  left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE)

  // Preferred side, then flip if there isn't room for it.
  let top = props.dir === 'up' ? a.top - h - GAP : a.bottom + GAP
  if (props.dir === 'up' && top < EDGE)                       top = a.bottom + GAP
  if (props.dir === 'down' && top + h > window.innerHeight - EDGE) top = a.top - h - GAP
  top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE)

  pos.value = { left, top }
}

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
const onResize = () => { void place() }

// Click-away without a backdrop element, for the same reason the context menu
// dropped its own: an invisible full-screen layer eats the click that dismisses
// it, so the thing you actually aimed at needs a second click.
// Anchor clicks are ignored here — the anchor's own handler toggles the menu,
// and closing on the way in would make it impossible to ever close by clicking
// the button again.
const onDocPointerDown = (e: PointerEvent) => {
  const t = e.target as Node
  if (panel.value?.contains(t)) return
  if (root.value?.parentElement?.contains(t)) return
  emit('close')
}

onMounted(() => {
  void place()
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <div ref="root" class="fly-anchor">
    <Teleport to="body">
      <div
        ref="panel"
        class="fly"
        :class="`fly-${dir}`"
        :style="pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { opacity: 0 }"
        @click.stop
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Zero-size marker: exists only so `parentElement` gives us the anchor to
   measure. The panel itself is teleported to <body>. */
.fly-anchor { position: absolute; width: 0; height: 0; }

/* No backdrop element — see onDocPointerDown. */
.fly {
  position: fixed; z-index: 8001;
  min-width: 236px; max-height: 62vh; overflow-y: auto;
  background: var(--bg-floor); border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 6px;
  box-shadow: 0 8px 32px rgba(0,0,0,.85);
}
.fly-down { animation: fly-pop-down .12s cubic-bezier(.4,0,.2,1); }
.fly-up   { animation: fly-pop-up   .12s cubic-bezier(.4,0,.2,1); }

@keyframes fly-pop-down {
  from { opacity: 0; transform: scale(.94) translateY(-4px); }
  to   { opacity: 1; transform: scale(1)   translateY(0); }
}
@keyframes fly-pop-up {
  from { opacity: 0; transform: scale(.94) translateY(4px); }
  to   { opacity: 1; transform: scale(1)   translateY(0); }
}
</style>

<!-- Row primitives are intentionally UNSCOPED (global): slot content belongs to
     each flyout's own scope, so shared row styles can't live in a scoped block
     here. Prefixed classes keep the global footprint safe. -->
<style>
.fly .fr {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; padding: 8px 10px; border: none; background: none; text-align: left;
  font-size: 13.5px; font-weight: 500; color: var(--text-1); border-radius: 5px;
  cursor: pointer; box-sizing: border-box;
}
.fly .fr:hover { background: var(--accent); color: #fff; }
.fly .fr:hover .fr-sub { color: rgba(255,255,255,.8); }
.fly .fr:disabled { opacity: .45; cursor: not-allowed; }
.fly .fr:disabled:hover { background: none; color: var(--text-1); }
.fly .fr.static, .fly .fr.static:hover { background: none; color: var(--text-1); cursor: default; }
.fly .fr-sep   { height: 1px; background: rgba(255,255,255,.08); margin: 4px 2px; }
.fly .fr-label {
  display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3); padding: 6px 10px 2px;
}
.fly .fr-sub {
  display: block; font-size: 11.5px; font-weight: 400; color: var(--text-3);
  margin-top: 1px; max-width: 190px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fly .fr-slider { width: 100%; accent-color: var(--accent); cursor: pointer; }
.fly .fr-check  { color: var(--state-live); flex-shrink: 0; }
.fly .fr:hover .fr-check { color: #fff; }
.fly .fr-tog {
  flex-shrink: 0; width: 38px; height: 20px; border-radius: 10px;
  background: rgba(128,132,142,.5); position: relative; transition: background var(--dur-2) var(--ease-out); display: inline-block;
}
.fly .fr-tog.on { background: var(--state-live); }
.fly .fr-tog > span {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform var(--dur-2) var(--ease-out);
}
.fly .fr-tog.on > span { transform: translateX(18px); }
</style>

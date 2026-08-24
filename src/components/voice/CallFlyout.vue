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
import { useDismissal } from '@/composables/useDismissal'

const props = withDefaults(defineProps<{ dir?: 'down' | 'up' }>(), { dir: 'down' })
const emit = defineEmits<{ close: [] }>()

// Close is two steps so the leave transition survives the parent unmounting
// us. Every caller renders this as `v-if="showX" @close="showX = false"`.
const { shown, requestClose, onAfterLeave } = useDismissal(() => emit('close'))

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

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
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
  requestClose()
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
      <Transition name="fly" :duration="{ enter: 120, leave: 140 }" @after-leave="onAfterLeave">
      <div
        v-if="shown"
        ref="panel"
        class="fly"
        :class="`fly-${dir}`"
        :style="pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { opacity: 0 }"
        @click.stop
      >
        <slot />
      </div>
      </Transition>
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
/* Grows from the control that opened it rather than from its own middle —
   a menu that expands out of its button reads as belonging to it. */
.fly-down { animation: fly-pop-down var(--dur-1) var(--ease-out); transform-origin: top center; }
.fly-up   { animation: fly-pop-up   var(--dur-1) var(--ease-out); transform-origin: bottom center; }

/* Leaves back along the path it arrived on. `animation: none` is load-bearing:
   an animation outranks a transition on the same property, so the entrance
   keyframes would otherwise pin transform and opacity and nothing would move. */
.fly-leave-active {
  animation: none;
  transition: opacity var(--dur-exit) var(--ease-in), transform var(--dur-exit) var(--ease-in);
}
.fly-leave-to.fly-down { opacity: 0; transform: scale(.96) translateY(-4px); }
.fly-leave-to.fly-up   { opacity: 0; transform: scale(.96) translateY(4px); }

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
  font-size: 13.5px; font-weight: 500; color: var(--text-1); border-radius: 6px;
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
.fly .fr-check  { color: #23a55a; flex-shrink: 0; }
.fly .fr:hover .fr-check { color: #fff; }
.fly .fr-tog {
  flex-shrink: 0; width: 38px; height: 20px; border-radius: 10px;
  background: rgba(128,132,142,.5); position: relative; transition: background var(--dur-2) var(--ease-out); display: inline-block;
}
.fly .fr-tog.on { background: #23a55a; }
.fly .fr-tog > span {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform var(--dur-2) var(--ease-out);
}
.fly .fr-tog.on > span { transform: translateX(18px); }
</style>

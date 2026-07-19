<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
// Anchored popover for call-bar controls. The parent wraps the anchor button in
// a position:relative container and v-if's this component inside it. The panel
// opens UPWARD, centered on the anchor. A fixed backdrop catches outside
// clicks; Esc closes too.
// Direction is the caller's call because it depends on where the anchor sits:
// the call bar is at the TOP of the chat column so its menus drop downward,
// while the user panel is pinned to the BOTTOM and must open upward or the menu
// would render off-screen.
withDefaults(defineProps<{ dir?: 'down' | 'up' }>(), { dir: 'down' })

const emit = defineEmits<{ close: [] }>()
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div>
    <div class="fly-backdrop" @mousedown="emit('close')" @contextmenu.prevent />
    <div class="fly" :class="`fly-${dir}`" @click.stop>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.fly-backdrop { position: fixed; inset: 0; z-index: 8000; }
.fly {
  position: absolute; left: 50%; transform: translateX(-50%);
  z-index: 8001; min-width: 236px; max-height: 62vh; overflow-y: auto;
  background: var(--bg-floor); border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 6px;
  box-shadow: 0 8px 32px rgba(0,0,0,.85);
}
/* Call bar sits at the top of the chat column: drop over the messages rather
   than covering the call stage. */
.fly-down { top: calc(100% + 12px); animation: fly-pop-down .12s cubic-bezier(.4,0,.2,1); }
/* User panel is pinned to the bottom: opening downward would go off-screen. */
.fly-up   { bottom: calc(100% + 12px); animation: fly-pop-up .12s cubic-bezier(.4,0,.2,1); }

@keyframes fly-pop-down {
  from { opacity: 0; transform: translateX(-50%) scale(.94) translateY(-4px); }
  to   { opacity: 1; transform: translateX(-50%) scale(1)   translateY(0); }
}
@keyframes fly-pop-up {
  from { opacity: 0; transform: translateX(-50%) scale(.94) translateY(4px); }
  to   { opacity: 1; transform: translateX(-50%) scale(1)   translateY(0); }
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
.fly .fr-check  { color: #23a55a; flex-shrink: 0; }
.fly .fr:hover .fr-check { color: #fff; }
.fly .fr-tog {
  flex-shrink: 0; width: 38px; height: 20px; border-radius: 10px;
  background: rgba(128,132,142,.5); position: relative; transition: background .15s; display: inline-block;
}
.fly .fr-tog.on { background: #23a55a; }
.fly .fr-tog > span {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform .15s;
}
.fly .fr-tog.on > span { transform: translateX(18px); }
</style>

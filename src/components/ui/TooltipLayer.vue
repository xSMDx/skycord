<script setup lang="ts">
/**
 * The single floating tooltip. Mounted once at app root; every v-tip drives it.
 *
 * Teleported to <body> so it can't be clipped by an ancestor's overflow:hidden
 * — the shell, sidebar and call bar all clip, and a tooltip on a control near
 * their edge would otherwise be cut in half.
 */
import { computed, ref, watch, nextTick } from 'vue'
import { tip } from '@/composables/useTooltip'

const GAP = 8      // distance from the anchor
const EDGE = 8     // keep this far from the viewport edge

const el = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })
/** Resolved placement — may differ from the requested one after flipping. */
const place = ref(tip.placement)

const measureAndPlace = () => {
  const box = el.value
  if (!box) return
  const bw = box.offsetWidth, bh = box.offsetHeight
  const vw = window.innerWidth, vh = window.innerHeight
  const { x, y, w, h } = tip

  let p = tip.placement
  // Flip rather than let it hang off-screen. Only the axis that doesn't fit
  // flips, so a top tooltip near the top edge becomes bottom, not left.
  if (p === 'top'    && y - GAP - bh < EDGE)        p = 'bottom'
  else if (p === 'bottom' && y + h + GAP + bh > vh - EDGE) p = 'top'
  else if (p === 'left'   && x - GAP - bw < EDGE)   p = 'right'
  else if (p === 'right'  && x + w + GAP + bw > vw - EDGE) p = 'left'
  place.value = p

  let left: number, top: number
  if (p === 'top')         { left = x + w / 2 - bw / 2; top = y - GAP - bh }
  else if (p === 'bottom') { left = x + w / 2 - bw / 2; top = y + h + GAP }
  else if (p === 'left')   { left = x - GAP - bw;       top = y + h / 2 - bh / 2 }
  else                     { left = x + w + GAP;        top = y + h / 2 - bh / 2 }

  // Clamp along the cross axis so a tooltip on an edge control stays readable.
  pos.value = {
    left: Math.min(Math.max(EDGE, left), vw - bw - EDGE),
    top:  Math.min(Math.max(EDGE, top),  vh - bh - EDGE),
  }
}

// Measure AFTER the text is in the DOM — width depends on the label, so
// positioning from a stale size puts short tooltips visibly off-centre.
watch(() => [tip.open, tip.text, tip.x, tip.y] as const, async ([open]) => {
  if (!open) return
  await nextTick()
  measureAndPlace()
}, { immediate: true })

const style = computed(() => ({ left: `${pos.value.left}px`, top: `${pos.value.top}px` }))
</script>

<template>
  <Teleport to="body">
    <Transition name="tip">
      <div v-if="tip.open" ref="el" class="tip" :class="'tip-' + place" :style="style" role="tooltip">
        {{ tip.text }}
        <span class="tip-arrow" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tip {
  position: fixed; z-index: 10000;
  /* Above every modal and menu — a tooltip is always the topmost thing while
     it's up, and being clipped behind a dialog is the same as not existing. */
  pointer-events: none;               /* never eat a click meant for the control */
  max-width: 260px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-floor, #111214);
  border: 1px solid var(--border, rgba(255,255,255,.08));
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  color: var(--text-strong, #f2f3f5);
  font-size: 12.5px; font-weight: 600; line-height: 1.35;
  letter-spacing: .005em;             /* small text reads better slightly open */
  white-space: pre-line;              /* lets a label carry a second line */
  text-align: center;
}

.tip-arrow {
  position: absolute; width: 8px; height: 8px;
  background: var(--bg-floor, #111214);
  border: 1px solid var(--border, rgba(255,255,255,.08));
  transform: rotate(45deg);
}
/* Only two borders show per side, so the arrow reads as a continuation of the
   bubble rather than a diamond stuck to it. */
.tip-top    .tip-arrow { bottom: -5px; left: 50%; margin-left: -4px; border-top: none;  border-left: none; }
.tip-bottom .tip-arrow { top: -5px;    left: 50%; margin-left: -4px; border-bottom: none; border-right: none; }
.tip-left   .tip-arrow { right: -5px;  top: 50%;  margin-top: -4px;  border-bottom: none; border-left: none; }
.tip-right  .tip-arrow { left: -5px;   top: 50%;  margin-top: -4px;  border-top: none;  border-right: none; }

/* Rises slightly toward the control it belongs to, so the motion points at the
   thing being described rather than appearing from nowhere. */
.tip-enter-active { transition: opacity var(--dur-1) var(--ease-out), transform .12s cubic-bezier(.32,.72,0,1); }
.tip-leave-active { transition: opacity var(--dur-1) var(--ease-out); }
.tip-enter-from { opacity: 0; transform: translateY(3px) scale(.97); }
.tip-leave-to   { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .tip-enter-active, .tip-leave-active { transition: opacity var(--dur-1) var(--ease-out); }
  .tip-enter-from { transform: none; }
}
</style>

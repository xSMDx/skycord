<script setup lang="ts">
/**
 * A placeholder shaped like the thing that is coming.
 *
 * A spinner says "something is happening somewhere". A skeleton says "a
 * message list is arriving, and it will look like this" — the layout is
 * already correct when the content lands, so nothing jumps. That is the
 * difference the user asked for: it should feel like the app is working, not
 * like it is stuck.
 *
 * Two rules this enforces so the effect does not become noise:
 *
 * **The shimmer travels across the surface, not within each bar.** One
 * `background-attachment: fixed` gradient means every bar on screen is lit by
 * the same moving light, as though a single sheen passes over the panel. Give
 * each bar its own animation and you get a wall of independently pulsing
 * rectangles, which reads as broken rather than loading.
 *
 * **It respects reduced motion by going still, not by disappearing.** The
 * shape is the information; the movement is only reassurance. Under
 * `prefers-reduced-motion` the bars hold a steady tone.
 */
withDefaults(defineProps<{
  /** Width of the bar. A number is px; a string passes through (`60%`). */
  w?: number | string
  h?: number | string
  /** Circular, for avatars. */
  circle?: boolean
  /** Softens successive lines so a block of them reads as depth, not stripes. */
  dim?: number
}>(), { w: '100%', h: 12, circle: false, dim: 1 })

const size = (v: number | string) => (typeof v === 'number' ? `${v}px` : v)
</script>

<template>
  <span
    class="sk"
    :class="{ 'sk--circle': circle }"
    :style="{
      width:  circle ? size(h) : size(w),
      height: size(h),
      opacity: dim,
    }"
    aria-hidden="true"
  />
</template>

<style scoped>
.sk {
  display: block;
  flex: none;
  border-radius: var(--edge-1);
  /* Fixed attachment is what makes one sheen cross every bar at once rather
     than each bar animating its own. */
  background-image: linear-gradient(
    100deg,
    var(--sk-base) 0%,
    var(--sk-base) 38%,
    var(--sk-sheen) 50%,
    var(--sk-base) 62%,
    var(--sk-base) 100%
  );
  background-size: 220vw 100%;
  background-attachment: fixed;
  animation: sk-sweep 1.9s linear infinite;
}
.sk--circle { border-radius: 50%; }

@keyframes sk-sweep {
  from { background-position: -110vw 0; }
  to   { background-position:  110vw 0; }
}

/* Still, not gone: the shape still tells you what is coming. */
@media (prefers-reduced-motion: reduce) {
  .sk { animation: none; background-image: none; background-color: var(--sk-base); }
}
</style>

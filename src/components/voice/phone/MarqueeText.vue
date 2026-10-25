<script setup lang="ts">
/**
 * One line of text that slides when it does not fit: out to its end, a pause,
 * back to its start, a pause — ping-pong, never a loop that jumps. Text that
 * fits stays put.
 *
 * Under reduced motion, the system's or the app's own, it holds still and
 * ends in an ellipsis instead.
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { effectiveMotion } from '@/composables/usePerformance'

const props = defineProps<{ text: string }>()

const box = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)

/** How many px of the text are cut off at the end. */
const overflow = ref(0)

// Layout widths, not the scroll width: the slide is a transform, and a
// transformed child changes what the box can scroll, mid-animation.
const measure = () => {
  const b = box.value
  const t = inner.value
  if (!b || !t) return
  const over = t.offsetWidth - b.clientWidth
  overflow.value = over > 1 ? over : 0
}

// The app's "Reduce motion" switch stops it as the system's does (the media
// query below); without this it would play once in a millisecond and leave
// the end cut off with no ellipsis.
const moving = computed(() => overflow.value > 0 && effectiveMotion.value !== 'off')

/** A calm reading pace: about 30px a second while moving, at least three seconds a leg. */
const PX_PER_SECOND = 30
const style = computed(() => {
  if (!moving.value) return undefined
  // The move fills the middle 70% of each leg; the rest is the pause at either end.
  const seconds = Math.max(3, overflow.value / PX_PER_SECOND / 0.7)
  return { '--mq-shift': `-${overflow.value}px`, '--mq-time': `${seconds.toFixed(2)}s` }
})

let ro: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined') return
  // The box narrows with the card; the text widens when a web font arrives.
  ro = new ResizeObserver(measure)
  if (box.value) ro.observe(box.value)
  if (inner.value) ro.observe(inner.value)
})
watch(() => props.text, () => nextTick(measure))
onBeforeUnmount(() => { ro?.disconnect(); ro = null })
</script>

<template>
  <span ref="box" class="mq" :class="{ 'is-still': !moving }">
    <span ref="inner" class="mq-text" :class="{ 'is-moving': moving }" :style="style">{{ text }}</span>
  </span>
</template>

<style scoped>
.mq { display: block; min-width: 0; overflow: hidden; white-space: nowrap; }
/* inline-block so its width is the text's and it can be moved; while still it
   is plain inline text, which is what lets the box end it in an ellipsis. */
.mq-text { display: inline-block; white-space: nowrap; }
.mq.is-still { text-overflow: ellipsis; }
.mq.is-still .mq-text { display: inline; }
.mq-text.is-moving {
  will-change: transform;
  animation: mq-pingpong var(--mq-time) var(--ease-inout) infinite alternate;
}
@keyframes mq-pingpong {
  0%, 15%   { transform: translateX(0); }
  85%, 100% { transform: translateX(var(--mq-shift)); }
}

@media (prefers-reduced-motion: reduce) {
  .mq { text-overflow: ellipsis; }
  .mq-text, .mq-text.is-moving { display: inline; animation: none; will-change: auto; }
}
</style>

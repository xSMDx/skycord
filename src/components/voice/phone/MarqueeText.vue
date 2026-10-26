<script setup lang="ts">
/**
 * One line of text that slides when it does not fit: out to its end, a pause,
 * back to its start, a pause — ping-pong, never a loop that jumps. Text that
 * fits stays put.
 *
 * While sliding, its two edges fade out instead of cutting a letter in half,
 * and the fades sit just outside the line (in the gap beside it), so the first
 * letter rests exactly where the still text would.
 *
 * `active` false holds it still, with an ellipsis, until it is wanted: a title
 * inside something not yet in view would otherwise be met mid-slide. Each time
 * it becomes active it starts again from the beginning, pause first.
 *
 * Under reduced motion, the system's or the app's own, it holds still and
 * ends in an ellipsis instead.
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { effectiveMotion } from '@/composables/usePerformance'

const props = withDefaults(defineProps<{ text: string; active?: boolean }>(), { active: true })

const box = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)

/** How many px of the text are cut off at the end. */
const overflow = ref(0)

// Layout widths, not the scroll width: the slide is a transform, and a
// transformed child changes what the box can scroll, mid-animation. Sliding,
// the box is wider by the two fades and the text by the same padding, so the
// difference — what has to travel — is the same either way.
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
const moving = computed(() => props.active && overflow.value > 0 && effectiveMotion.value !== 'off')

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
  <span ref="box" class="mq" :class="{ 'is-still': !moving, 'is-sliding': moving }">
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

/* Sliding: 12px fades at both ends, out past the line's own edges, with the
   text padded by as much so it starts and stops in the clear. */
.mq.is-sliding {
  margin: 0 -12px;
  -webkit-mask-image: linear-gradient(to right, transparent, black 12px, black calc(100% - 12px), transparent);
  mask-image: linear-gradient(to right, transparent, black 12px, black calc(100% - 12px), transparent);
}
.mq.is-sliding .mq-text { padding: 0 12px; }

.mq-text.is-moving {
  will-change: transform;
  animation: mq-pingpong var(--mq-time) var(--ease-inout) infinite alternate;
}
@keyframes mq-pingpong {
  0%, 15%   { transform: translateX(0); }
  85%, 100% { transform: translateX(var(--mq-shift)); }
}

@media (prefers-reduced-motion: reduce) {
  .mq, .mq.is-sliding { margin: 0; text-overflow: ellipsis; -webkit-mask-image: none; mask-image: none; }
  .mq-text, .mq-text.is-moving, .mq.is-sliding .mq-text { display: inline; padding: 0; animation: none; will-change: auto; }
}
</style>

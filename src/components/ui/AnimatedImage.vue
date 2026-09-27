<script setup lang="ts">
/**
 * A non-square image that follows the same motion policy as Avatar — used for
 * profile banners, which are the largest moving thing on a profile and so the
 * worst offender if left looping.
 *
 * Kept separate from Avatar rather than adding a `shape` prop to it: Avatar
 * owns a square/round box with a fixed pixel size, and a banner is a fluid
 * strip that fills its parent. Bending one component to be both would make
 * every avatar call site carry sizing props it doesn't need.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { isIdentityCrop, isAnimated, cropLayout, type Crop } from '@/composables/useCrop'
import { useGifBurst, useTapToPlay, hasHover, motionAllowed, tapOnly, playbackPolicy, freezeFrame } from '@/composables/useGifPlayback'

const props = withDefaults(defineProps<{
  src: string
  alt?: string
  crop?: Crop | null
  /** Play regardless — the editor's own preview wants the real thing. */
  alwaysAnimate?: boolean
}>(), { alt: '', crop: null, alwaysAnimate: false })

const animated = computed(() => isAnimated(props.src))
const { bursting } = useGifBurst()
const { played, play } = useTapToPlay()
const poster = ref<string | null>(null)
const hovering = ref(false)

const loadPoster = async () => {
  poster.value = animated.value && motionAllowed && !props.alwaysAnimate
    ? await freezeFrame(props.src)
    : null
}
onMounted(loadPoster)
watch(() => props.src, loadPoster)

const reason = computed(() => playbackPolicy({
  animated: animated.value, alwaysAnimate: props.alwaysAnimate,
  reduced: !motionAllowed, tapOnly: tapOnly.value, hasHover,
}))

const playing = computed(() => {
  if (reason.value === 'always') return true
  if (reason.value === 'never') return false
  if (!poster.value) return true      // cross-origin: nothing to freeze to
  if (reason.value === 'hover') return hovering.value
  if (reason.value === 'burst') return bursting.value
  return played.value                 // 'tap'
})
const shownSrc = computed(() => (playing.value || !poster.value) ? props.src : poster.value)

/*
 * A crop is stored as a percentage of the box it was framed in. Rendered into
 * a box of a DIFFERENT shape — or carried over from before the editor
 * constrained panning — that percentage can walk the image off its own edge
 * and leave the background showing through.
 *
 * So the offset is bounded here by how much image there actually is to spare:
 * after object-fit: cover and scale(z), the content overhangs each edge by
 * exactly half the difference between the content and the box. Panning further
 * than that is asking to see something that isn't there.
 */
const el = ref<HTMLImageElement | null>(null)
const box = ref({ w: 0, h: 0 })
const measure = () => {
  // clientWidth/Height, not getBoundingClientRect: the rect includes ancestor
  // transforms, and the settings modal animates in with a scale. Measuring
  // mid-animation returned 333 for a 340px card and sized the image to match,
  // leaving a slice of background down one side. The layout box ignores that.
  const p = el.value?.parentElement
  if (p) box.value = { w: p.clientWidth, h: p.clientHeight }
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    const ro = new ResizeObserver(measure)
    if (el.value.parentElement) ro.observe(el.value.parentElement)
  }
})

const safeStyle = computed(() => {
  const c = props.crop
  if (isIdentityCrop(c)) return undefined
  const { w, h } = box.value
  return cropLayout(el.value?.naturalWidth ?? 0, el.value?.naturalHeight ?? 0, w, h, c)
})
</script>

<template>
  <!-- A tap is the only way this ever plays, so it must be a real, keyboard-
       reachable control — not a click handler on the img. Every other reason
       (hover, burst, always, never) leaves the markup exactly as it was. -->
  <button v-if="reason === 'tap'" type="button" class="anim-img-btn" :aria-label="`Play ${alt}`" @click="play">
    <img
      class="anim-img"
      ref="el"
      :src="shownSrc" alt="" :style="safeStyle" draggable="false"
      @load="measure"
    />
  </button>
  <img
    v-else
    class="anim-img"
    ref="el"
    :src="shownSrc" :alt="alt" :style="safeStyle" draggable="false"
    @load="measure"
    @pointerenter="hovering = true"
    @pointerleave="hovering = false"
  />
</template>

<style scoped>
.anim-img {
  width: 100%; height: 100%;
  object-fit: cover; display: block;
  user-select: none; -webkit-user-drag: none;
}
.anim-img-btn {
  display: block; width: 100%; height: 100%;
  padding: 0; border: none; background: none; cursor: pointer;
}
</style>

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
import { cropStyle, isAnimated, type Crop } from '@/composables/useCrop'
import { useGifBurst, hasHover, motionAllowed, freezeFrame } from '@/composables/useGifPlayback'

const props = withDefaults(defineProps<{
  src: string
  alt?: string
  crop?: Crop | null
  /** Play regardless — the editor's own preview wants the real thing. */
  alwaysAnimate?: boolean
}>(), { alt: '', crop: null, alwaysAnimate: false })

const animated = computed(() => isAnimated(props.src))
const { bursting } = useGifBurst()
const poster = ref<string | null>(null)
const hovering = ref(false)

const loadPoster = async () => {
  poster.value = animated.value && motionAllowed && !props.alwaysAnimate
    ? await freezeFrame(props.src)
    : null
}
onMounted(loadPoster)
watch(() => props.src, loadPoster)

const playing = computed(() => {
  if (!animated.value || props.alwaysAnimate) return true
  if (!motionAllowed) return false
  if (!poster.value) return true      // cross-origin: nothing to freeze to
  return hasHover ? hovering.value : bursting.value
})
const shownSrc = computed(() => (playing.value || !poster.value) ? props.src : poster.value)
</script>

<template>
  <img
    class="anim-img"
    :src="shownSrc" :alt="alt" :style="cropStyle(crop)" draggable="false"
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
</style>

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
import { isIdentityCrop, isAnimated, type Crop } from '@/composables/useCrop'
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
  const r = el.value?.getBoundingClientRect()
  if (r) box.value = { w: r.width, h: r.height }
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    const ro = new ResizeObserver(measure)
    ro.observe(el.value)
  }
})

const safeStyle = computed(() => {
  const c = props.crop
  if (isIdentityCrop(c)) return undefined
  const nw = el.value?.naturalWidth ?? 0, nh = el.value?.naturalHeight ?? 0
  const { w, h } = box.value
  let { x, y } = c!
  if (nw && nh && w && h) {
    const cover = Math.max(w / nw, h / nh)
    const cw = nw * cover * c!.zoom, ch = nh * cover * c!.zoom
    const maxX = Math.max(0, (cw - w) / 2) / w * 100
    const maxY = Math.max(0, (ch - h) / 2) / h * 100
    x = Math.min(maxX, Math.max(-maxX, x))
    y = Math.min(maxY, Math.max(-maxY, y))
  }
  return { transform: `translate(${x}%, ${y}%) scale(${c!.zoom})`, transformOrigin: 'center center' }
})
</script>

<template>
  <img
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
</style>

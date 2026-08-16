<script setup lang="ts">
/**
 * The one place an avatar is drawn.
 *
 * Exists for two reasons, both about animated images.
 *
 * FRAMING. A static avatar is cropped by canvas at upload and stored
 * already-cropped, so any `<img>` could point at it. A GIF can't be — drawing
 * it to a canvas flattens it to one frame — so its framing lives as numbers
 * and is re-applied as a CSS transform wherever it appears. That's only
 * maintainable if there IS one place.
 *
 * MOTION. A member list of twenty looping GIFs is twenty things competing with
 * the message you're reading. They hold still and move only when there's a
 * reason: hover on a pointer device, a shared periodic burst on touch. See
 * useGifPlayback for why the burst is one timer rather than one per avatar.
 */
import { computed, ref, watch, onMounted } from 'vue'
import type { Crop } from '@/composables/useCrop'
import { isAnimated } from '@/composables/useCrop'
import { useGifBurst, hasHover, motionAllowed, freezeFrame } from '@/composables/useGifPlayback'

const props = withDefaults(defineProps<{
  src: string
  alt?: string
  /**
   * Rendered size in px. Omit to fill the parent instead — most call sites
   * already have a wrapper with the size baked into its own stylesheet, and
   * restating that number here would be a second place to change it.
   */
  size?: number | null
  crop?: Crop | null
  /** Square instead of round — group icons on some surfaces. */
  square?: boolean
  /** Ring colour for a speaking or selected state. */
  ring?: string | null
  /** Opt out of the motion policy — the profile editor wants to see the real
   *  thing move while you're choosing it. */
  alwaysAnimate?: boolean
}>(), { alt: '', size: null, crop: null, square: false, ring: null, alwaysAnimate: false })

const animated = computed(() => isAnimated(props.src))
const { bursting } = useGifBurst()

/** Frozen first frame. null when we couldn't make one (cross-origin GIF). */
const poster = ref<string | null>(null)
const hovering = ref(false)

const loadPoster = async () => {
  poster.value = animated.value && motionAllowed && !props.alwaysAnimate
    ? await freezeFrame(props.src)
    : null
}
onMounted(loadPoster)
watch(() => props.src, loadPoster)

/**
 * Show the live image when it should be moving, the poster when it shouldn't.
 * With no poster (cross-origin) there is nothing to fall back TO, so it plays
 * — a broken picture would be worse than an unwanted animation.
 */
const playing = computed(() => {
  if (!animated.value) return true
  if (props.alwaysAnimate) return true
  if (!motionAllowed) return false          // reduced motion: never
  if (!poster.value) return true            // no still to show
  return hasHover ? hovering.value : bursting.value
})

const shownSrc = computed(() => (playing.value || !poster.value) ? props.src : poster.value)

const boxStyle = computed(() => {
  const s = props.size
  // Without a size the span is 100%/100% and the parent decides, so a wrapper
  // that already says 32px keeps saying it. The rounding for a square icon
  // then has no pixel value to scale from, hence the flat radius.
  return {
    width:  s ? `${s}px` : '100%',
    height: s ? `${s}px` : '100%',
    borderRadius: props.square ? (s ? `${Math.max(4, s * 0.22)}px` : '30%') : '50%',
    ...(props.ring ? { boxShadow: `0 0 0 2px ${props.ring}` } : {}),
  }
})

/** A null crop must cost nothing: object-fit already frames a centred image,
 *  so emit no transform at all rather than an identity one. */
const imgStyle = computed(() => {
  const c = props.crop
  if (!c || (c.zoom === 1 && c.x === 0 && c.y === 0)) return undefined
  return {
    transform: `translate(${c.x}%, ${c.y}%) scale(${c.zoom})`,
    transformOrigin: 'center center',
  }
})
</script>

<template>
  <span
    class="av" :style="boxStyle"
    @pointerenter="hovering = true"
    @pointerleave="hovering = false"
  >
    <img :src="shownSrc" :alt="alt" :style="imgStyle" draggable="false" />
    <slot />
  </span>
</template>

<style scoped>
.av {
  position: relative; display: inline-block; flex-shrink: 0;
  overflow: hidden;                 /* the crop IS this clip */
  background: var(--bg-deep);
  /* Its own stacking context, so a scaled GIF can't paint over a neighbour. */
  isolation: isolate;
}
.av img {
  width: 100%; height: 100%;
  object-fit: cover;                /* frames a null-crop image by itself */
  display: block;
  user-select: none; -webkit-user-drag: none;
}
</style>

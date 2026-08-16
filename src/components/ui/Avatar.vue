<script setup lang="ts">
/**
 * The one place an avatar is drawn.
 *
 * Exists because of animated GIFs. A static avatar is cropped by canvas at
 * upload and stored already-cropped, so every `<img>` in the app could just
 * point at it. A GIF can't be: drawing it to a canvas flattens it to a single
 * frame. Its framing therefore has to live as numbers and be re-applied as a
 * CSS transform at every place the avatar appears — which is only maintainable
 * if there IS one place.
 *
 * The crop is stored as a zoom plus an offset in PERCENT of the container, not
 * pixels, so the same numbers frame the face identically at 20px in a message
 * list and at 80px on a profile card.
 */
import { computed } from 'vue'
import type { Crop } from '@/composables/useCrop'

const props = withDefaults(defineProps<{
  src: string
  alt?: string
  /** Rendered size in px. Square; avatars always are. */
  size?: number
  crop?: Crop | null
  /** Square instead of round — group icons in some surfaces. */
  square?: boolean
  /** Ring colour for a speaking/selected state, if the caller wants one. */
  ring?: string | null
}>(), { alt: '', size: 32, crop: null, square: false, ring: null })

const boxStyle = computed(() => ({
  width:  `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: props.square ? `${Math.max(4, props.size * 0.22)}px` : '50%',
  ...(props.ring ? { boxShadow: `0 0 0 2px ${props.ring}` } : {}),
}))

/**
 * No crop is the common case and must cost nothing: `object-fit: cover` alone
 * already frames a centred image correctly, so a null crop emits no transform
 * at all rather than an identity one.
 */
const imgStyle = computed(() => {
  const c = props.crop
  if (!c || (c.zoom === 1 && c.x === 0 && c.y === 0)) return undefined
  return {
    transform: `translate(${c.x}%, ${c.y}%) scale(${c.zoom})`,
    // Scaling from the centre keeps the offset meaning the same at any size.
    transformOrigin: 'center center',
  }
})
</script>

<template>
  <span class="av" :style="boxStyle">
    <img :src="src" :alt="alt" :style="imgStyle" draggable="false" />
    <slot />
  </span>
</template>

<style scoped>
.av {
  position: relative; display: inline-block; flex-shrink: 0;
  overflow: hidden;                 /* the crop IS this clip */
  background: var(--bg-deep);
  /* Own stacking context, so a scaled GIF can't paint over a neighbour. */
  isolation: isolate;
}
.av img {
  width: 100%; height: 100%;
  object-fit: cover;                /* frames a null-crop image on its own */
  display: block;
  user-select: none; -webkit-user-drag: none;
}
</style>

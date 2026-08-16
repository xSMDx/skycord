<script setup lang="ts">
import { ref, onMounted } from 'vue'
// Aliased, for two reasons: PhImage and PhImageSquare both map to Lucide's
// single Image, which would be a duplicate identifier; and an unaliased `Image`
// shadows the DOM constructor that `new Image()` below relies on for cropping.
import { X, Image as ImageIcon, RotateCw } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { isAnimated, clampCrop, type Crop } from '@/composables/useCrop'

const props = withDefaults(defineProps<{
  src: string
  /** 'avatar' is square; 'banner' is the 16:5 strip on the profile card. */
  shape?: 'avatar' | 'banner'
}>(), { shape: 'avatar' })

/**
 * Two ways out, because there are two kinds of image.
 *
 *   apply(dataUrl)  a static image, already cropped by canvas.
 *   applyCrop(src, crop)  an animated GIF, untouched, plus the framing to
 *                         re-apply as CSS wherever it's drawn.
 *
 * A GIF has to take the second path: drawing it to a canvas would flatten it
 * to a single frame and the animation — the whole reason it's a GIF — is gone.
 */
const emit = defineEmits<{
  apply: [dataUrl: string]
  applyCrop: [src: string, crop: Crop]
  cancel: []
  close: []
}>()

const animated = isAnimated(props.src)

// The preview is the real aspect of the thing being framed, so what you see
// while dragging is what lands on the profile.
const BANNER_RATIO = 16 / 5
const VIEWPORT   = props.shape === 'banner' ? 340 : 300
const VIEWPORT_H = props.shape === 'banner' ? 106 : 300
const OUTPUT     = props.shape === 'banner' ? 1024 : 256
const OUTPUT_H   = props.shape === 'banner' ? Math.round(1024 / BANNER_RATIO) : 256

const img      = new Image()
const ready    = ref(false)
let baseCover  = 1      // scale so the image covers the viewport at zoom 1

const scale  = ref(1)   // user zoom (1..3)
const rot    = ref(0)   // degrees, 90° steps
const tx     = ref(0)   // pan offset, viewport px
const ty     = ref(0)

// Live preview transform — mirrored exactly on the export canvas in apply().
const imgStyle = () => ({
  transform:
    `translate(-50%, -50%) translate(${tx.value}px, ${ty.value}px) ` +
    `rotate(${rot.value}deg) scale(${baseCover * scale.value})`,
})

onMounted(() => {
  img.onload = () => {
    // Cover the viewport in BOTH axes — for a banner the limiting dimension is
    // usually the height, and fitting to the shorter side alone would leave a
    // gap down the sides of a wide crop.
    baseCover = Math.max(VIEWPORT / img.naturalWidth, VIEWPORT_H / img.naturalHeight)
    ready.value = true
  }
  img.src = props.src
})

// ── Drag to reposition ──────────────────────────────────────────────────────
let dragging = false
let startX = 0, startY = 0, startTx = 0, startTy = 0
const onDown = (e: PointerEvent) => {
  dragging = true
  startX = e.clientX; startY = e.clientY; startTx = tx.value; startTy = ty.value
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
const onMove = (e: PointerEvent) => {
  if (!dragging) return
  tx.value = startTx + (e.clientX - startX)
  ty.value = startTy + (e.clientY - startY)
}
const onUp = () => { dragging = false }

const rotate = () => { rot.value = (rot.value + 90) % 360 }
const reset  = () => { scale.value = 1; rot.value = 0; tx.value = 0; ty.value = 0 }

const apply = () => {
  /*
   * Animated: hand back the original plus the framing, expressed in PERCENT of
   * the container rather than pixels. Percent survives being rendered at a
   * different size — the same numbers frame the same face at 20px in a message
   * list and at 300px here, which pixels could never do.
   */
  if (animated) {
    emit('applyCrop', props.src, clampCrop({
      zoom: scale.value,
      x: (tx.value / VIEWPORT)   * 100,
      y: (ty.value / VIEWPORT_H) * 100,
    }))
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT; canvas.height = OUTPUT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) { emit('cancel'); return }

  const k = OUTPUT / VIEWPORT
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, OUTPUT, OUTPUT_H)
  ctx.save()
  ctx.translate(OUTPUT / 2 + tx.value * k, OUTPUT_H / 2 + ty.value * k)
  ctx.rotate((rot.value * Math.PI) / 180)
  const drawScale = baseCover * scale.value * k
  ctx.scale(drawScale, drawScale)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  ctx.restore()

  emit('apply', canvas.toDataURL('image/jpeg', 0.9))
}
</script>

<template>
  <ModalBase width="500px" @close="emit('close')">
    <div class="ei">
      <div class="ei-header">
        <h2 class="ei-title">Edit Image</h2>
        <button class="ei-close" @click="emit('close')" aria-label="Close">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <!-- One viewport for both kinds of image. A GIF used to get its own
           undraggable preview, which is precisely what made it uncroppable. -->
      <div class="ei-stage" :class="`ei-${shape}`">
        <div
          class="ei-viewport"
          @pointerdown="onDown" @pointermove="onMove"
          @pointerup="onUp" @pointercancel="onUp"
        >
          <img v-if="ready" :src="src" class="ei-img" :style="imgStyle()" draggable="false" />
          <div class="ei-mask"></div>
        </div>
      </div>

      <p v-if="animated" class="ei-gifnote">
        Animation is kept — the framing is applied when it's shown, not baked in.
      </p>

      <div class="ei-controls">
        <ImageIcon :size="18" :stroke-width="2.25" class="ei-zoom-ico" />
        <input
          v-model.number="scale"
          class="ei-slider"
          type="range" min="1" max="3" step="0.01"
          aria-label="Zoom"
        />
        <ImageIcon :size="22" :stroke-width="2.25" class="ei-zoom-ico" />
        <button v-if="!animated" class="ei-rotate" v-tip="'Rotate'" @click="rotate">
          <RotateCw :size="18" :stroke-width="2.25" />
        </button>
      </div>

      <div class="ei-footer">
        <button v-if="true" class="ei-reset" @click="reset">Reset</button>
        <div class="ei-actions">
          <button class="ei-cancel" @click="emit('cancel')">Cancel</button>
          <button class="ei-apply" :disabled="!animated && !ready" @click="apply">Apply</button>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.ei { display: flex; flex-direction: column; }
.ei-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 0; }
.ei-title  { font-size: 17px; font-weight: 700; color: var(--text-strong); }
.ei-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s;
}
.ei-close:hover { background: var(--hover); color: var(--text-strong); }

.ei-stage { display: flex; justify-content: center; padding: 18px; }
.ei-viewport {
  position: relative;
  /* Driven by the shape, so what you drag is the shape you get. */
  width: var(--ei-w, 300px); height: var(--ei-h, 300px);
  border-radius: 8px; overflow: hidden; background: var(--bg-input);
  cursor: grab; touch-action: none;
}
/* 16:5 — the same strip the profile card draws, so the preview isn't a
   promise the card then breaks. */
.ei-stage.ei-banner .ei-viewport { --ei-w: 340px; --ei-h: 106px; }
.ei-viewport:active { cursor: grabbing; }
.ei-img { position: absolute; left: 50%; top: 50%; transform-origin: center; will-change: transform; }
/* GIF preview: whole frame, centred, animation untouched */
.ei-gifnote { text-align: center; font-size: 12.5px; color: var(--text-3); margin: 10px 0 0; }
/* Circular alignment mask: darken everything outside the circle + white ring */
.ei-mask {
  position: absolute; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.9), 0 0 0 9999px rgba(0,0,0,.55);
  border-radius: 50%;
}
/* Banners are a rectangle. Showing a circle here would frame the image
   against a shape it is never going to be drawn in. */
.ei-stage.ei-banner .ei-mask { border-radius: 8px; }

.ei-controls {
  display: flex; align-items: center; gap: 12px;
  padding: 0 28px 4px; color: var(--text-2);
}
.ei-zoom-ico { color: var(--text-2); flex-shrink: 0; }
.ei-slider { flex: 1; accent-color: var(--accent); height: 4px; cursor: pointer; }
.ei-rotate {
  width: 34px; height: 34px; border-radius: 6px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); transition: background .12s, color .12s;
}
.ei-rotate:hover { background: var(--hover); color: var(--text-strong); }

.ei-footer { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; }
.ei-reset { font-size: 14px; font-weight: 600; color: var(--accent); }
.ei-reset:hover { text-decoration: underline; }
.ei-actions { display: flex; align-items: center; gap: 12px; }
.ei-cancel { padding: 9px 18px; border-radius: 4px; font-size: 14px; font-weight: 600; color: var(--text-1); background: rgba(255,255,255,.06); }
.ei-cancel:hover { background: var(--hover-strong); }
.ei-apply { padding: 9px 24px; border-radius: 4px; font-size: 14px; font-weight: 600; color: var(--text-on-accent); background: var(--accent); transition: background .12s, opacity .12s; }
.ei-apply:hover:not(:disabled) { background: var(--accent-hover); }
.ei-apply:disabled { opacity: .5; cursor: not-allowed; }
</style>

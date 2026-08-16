<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
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
const banner = props.shape === 'banner'

/*
 * Two rectangles, deliberately different sizes.
 *
 *   STAGE   the area you drag inside. Bigger than the window, so you can see
 *           the parts of the image you're about to cut off and judge the
 *           framing against them.
 *   WINDOW  the bright rounded rect. This is what actually gets kept, and
 *           every measurement below is against IT, not the stage.
 *
 * They used to be one rectangle. That made the banner editor a letterbox with
 * no context around it — you were framing blind — and it meant the exported
 * crop was measured against the stage.
 */
const STAGE_W  = banner ? 340 : 300
const STAGE_H  = banner ? 240 : 300
const CROP_W   = banner ? 304 : 300
const CROP_H   = banner ? Math.round(304 / BANNER_RATIO) : 300   // 95

/** The geometry above, handed to CSS. One source of truth: hardcoding these
 *  sizes in the stylesheet too would let the drag area and the export maths
 *  drift apart without anything failing loudly. */
const stageVars = {
  '--st-w': STAGE_W + 'px', '--st-h': STAGE_H + 'px',
  '--cw': CROP_W + 'px',  '--ch': CROP_H + 'px',
  '--cr': banner ? '12px' : '50%',
}

const OUTPUT   = banner ? 1024 : 256
const OUTPUT_H = banner ? Math.round(1024 / BANNER_RATIO) : 256

const img      = new Image()
const ready    = ref(false)
let baseCover  = 1      // cover scale at zoom 1, for the unrotated image

/** Cover scale for the CURRENT rotation. At 90°/270° the image's width has to
 *  cover the window's height and vice versa. */
const coverScale = () => {
  if (!img.naturalWidth) return baseCover
  const swapped = rot.value % 180 !== 0
  const w = swapped ? img.naturalHeight : img.naturalWidth
  const h = swapped ? img.naturalWidth  : img.naturalHeight
  return Math.max(CROP_W / w, CROP_H / h)
}

const scale  = ref(1)   // user zoom (1..3)
const rot    = ref(0)   // degrees, 90° steps
const tx     = ref(0)   // pan offset, viewport px
const ty     = ref(0)

// Live preview transform — mirrored exactly on the export canvas in apply().
const imgStyle = () => ({
  transform:
    `translate(-50%, -50%) translate(${tx.value}px, ${ty.value}px) ` +
    `rotate(${rot.value}deg) scale(${coverScale() * scale.value})`,
})

onMounted(() => {
  img.onload = () => {
    // Cover the viewport in BOTH axes — for a banner the limiting dimension is
    // usually the height, and fitting to the shorter side alone would leave a
    // gap down the sides of a wide crop.
    baseCover = Math.max(CROP_W / img.naturalWidth, CROP_H / img.naturalHeight)
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
/**
 * How far the image may be nudged before a corner of the window would show
 * empty space. Nothing outside this is a framing anyone wants, and allowing it
 * also produced offsets past 100% of the window — which the server then
 * clamped, silently saving a DIFFERENT framing than the one on screen.
 */
const maxOffset = () => {
  const s = coverScale() * scale.value
  const swapped = rot.value % 180 !== 0
  const w = (swapped ? img.naturalHeight : img.naturalWidth)  * s
  const h = (swapped ? img.naturalWidth  : img.naturalHeight) * s
  return { x: Math.max(0, (w - CROP_W) / 2), y: Math.max(0, (h - CROP_H) / 2) }
}
const clampPan = () => {
  const m = maxOffset()
  tx.value = Math.min(m.x, Math.max(-m.x, tx.value))
  ty.value = Math.min(m.y, Math.max(-m.y, ty.value))
}

const onMove = (e: PointerEvent) => {
  if (!dragging) return
  tx.value = startTx + (e.clientX - startX)
  ty.value = startTy + (e.clientY - startY)
  clampPan()
}

// Zooming OUT shrinks the room to pan, so an offset that was legal at 3x can
// leave a gap at 1.2x. Re-clamp whenever the zoom changes.
watch([scale, rot], clampPan)
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
      // Percent OF THE WINDOW, since that's the box the crop is rendered
      // into everywhere else.
      x: (tx.value / CROP_W) * 100,
      y: (ty.value / CROP_H) * 100,
    }))
    return
  }

  /*
   * Clamp once more, here, because this is the last gate before pixels are
   * written and it is the only one that has to hold. Dragging clamps as you
   * go, but a value can reach this point another way — a rotation, a crop
   * restored from a version that predates the clamp — and a gap baked into
   * the export is permanent. No amount of fixing the renderer later recovers
   * pixels that were never stored.
   */
  clampPan()

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT; canvas.height = OUTPUT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) { emit('cancel'); return }

  const k = OUTPUT / CROP_W
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, OUTPUT, OUTPUT_H)
  ctx.save()
  ctx.translate(OUTPUT / 2 + tx.value * k, OUTPUT_H / 2 + ty.value * k)
  ctx.rotate((rot.value * Math.PI) / 180)
  const drawScale = coverScale() * scale.value * k
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
      <div class="ei-stage" :class="`ei-${shape}`" :style="stageVars">
        <div
          class="ei-viewport"
          @pointerdown="onDown" @pointermove="onMove"
          @pointerup="onUp" @pointercancel="onUp"
        >
          <img v-if="ready" :src="src" class="ei-img" :style="imgStyle()" draggable="false" />
          <!-- The bright window. Its huge outer shadow is what dims everything
               around it, so the dim and the cut-out can never disagree. -->
          <div class="ei-window"></div>
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
          type="range" min="1" max="5" step="0.01"
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

.ei-stage {
  display: flex; justify-content: center; padding: 18px;
}
.ei-viewport {
  position: relative;
  width: var(--st-w, 300px); height: var(--st-h, 300px);
  border-radius: 8px; overflow: hidden; background: var(--bg-input);
  cursor: grab; touch-action: none;
}
/* 16:5 — the same strip the profile card draws, so the preview isn't a
   promise the card then breaks. */
.ei-viewport:active { cursor: grabbing; }
.ei-img { position: absolute; left: 50%; top: 50%; transform-origin: center; will-change: transform; }
/* GIF preview: whole frame, centred, animation untouched */
.ei-gifnote { text-align: center; font-size: 12.5px; color: var(--text-3); margin: 10px 0 0; }
/* Circular alignment mask: darken everything outside the circle + white ring */
/* The kept region. Everything outside is dimmed by this element's own
   9999px outer shadow, so there is exactly one source of truth for where the
   crop ends — a separate dimming layer could drift out of alignment with it. */
.ei-window {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: var(--cw, 300px); height: var(--ch, 300px);
  pointer-events: none;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.9), 0 0 0 9999px rgba(0,0,0,.55);
  border-radius: var(--cr, 50%);
}
/* Banners are a rectangle. Showing a circle here would frame the image
   against a shape it is never going to be drawn in. */

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

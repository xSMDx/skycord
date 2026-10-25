<script setup lang="ts">
/**
 * The phone's push-to-talk: a wide bar above the call's circles. Press and
 * hold to transmit; let go to stop. A phone has no key to hold, so in a
 * channel that requires push-to-talk this is the only way to speak.
 *
 * The rules — "Talking…" only once the press is on air, and every ending
 * releases — are holdToTalk.ts's. This wires a finger (or a key) to them.
 *
 * The bar takes the pointer itself (its children are out of the hit test), so
 * the finger stays its until it lifts, even if it slides off. It never hands
 * the pointer back while the finger is down: the call screen hears a lost
 * capture as a release, and would start counting down to hide the controls
 * under a finger still talking.
 */
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { Mic, MicOff } from 'lucide-vue-next'
import { pttPress, pttRelease } from '@/composables/useVoice'
import { createHoldToTalk } from '@/composables/holdToTalk'

const props = defineProps<{
  /** Cannot transmit: deafened, muted by the server, or not in the call yet. */
  disabled: boolean
  /** What the bar says instead of "Hold to talk" while it cannot be used. */
  disabledLabel: string
}>()

const hold = createHoldToTalk({
  press: pttPress,
  release: pttRelease,
  buzz: () => { navigator.vibrate?.(10) },
})
const talking = hold.talking

/** The finger holding the bar. Any other is ignored, down and up. */
let pointerId: number | null = null
/** Held from the keyboard (Space or Enter) instead. */
let keyHeld = false

const onPointerDown = (e: PointerEvent) => {
  if (props.disabled || keyHeld || pointerId !== null) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pointerId = e.pointerId
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    // A pointer already gone by the time this ran. Its up or cancel still
    // reaches the bar, and the page going hidden releases regardless.
  }
  hold.down()
}

// Lifted, cancelled (the system took the touch), or its capture lost.
const onPointerEnd = (e: PointerEvent) => {
  if (e.pointerId !== pointerId) return
  pointerId = null
  hold.up()
}

const isHoldKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'

const onKeyDown = (e: KeyboardEvent) => {
  if (!isHoldKey(e)) return
  // Not a click: the bar acts on press and release, never on activation.
  e.preventDefault()
  if (e.repeat || props.disabled || keyHeld || pointerId !== null) return
  keyHeld = true
  hold.down()
}
const onKeyUp = (e: KeyboardEvent) => {
  if (!isHoldKey(e) || !keyHeld) return
  e.preventDefault()
  keyHeld = false
  hold.up()
}
// Focus leaving mid-hold means the key's release will land somewhere else.
const onBlur = () => {
  if (!keyHeld) return
  keyHeld = false
  hold.up()
}

const releaseAll = () => {
  pointerId = null
  keyHeld = false
  hold.up()
}

// The app went to the background, or the screen went off, mid-hold: the
// lift will never reach the page, so this is the release.
const onVisibility = () => {
  if (document.visibilityState === 'hidden') releaseAll()
}

// Muted by the server, or deafened, while holding: stop now, not on the lift.
watch(() => props.disabled, d => { if (d) releaseAll() })

onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  // The call ended, or the channel stopped requiring push-to-talk, under the finger.
  releaseAll()
})
</script>

<template>
  <button
    type="button"
    class="htt"
    :class="{ talking }"
    data-ptt
    :disabled="disabled"
    @pointerdown="onPointerDown"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @lostpointercapture="onPointerEnd"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @blur="onBlur"
    @contextmenu.prevent
  >
    <component :is="disabled ? MicOff : Mic" :size="20" :stroke-width="2.25" aria-hidden="true" />
    <span class="htt-label">{{ disabled ? disabledLabel : talking ? 'Talking…' : 'Hold to talk' }}</span>
  </button>
</template>

<style scoped>
/* Over the sheet while the controls show, and straight over the video when
   they fade — it never does — so it carries its own veil under its tint. */
.htt {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; min-height: 52px; padding: 0 20px;
  border: none; border-radius: var(--edge-pill);
  background: linear-gradient(var(--hover-strong), var(--hover-strong)), var(--media-veil-strong);
  color: var(--on-media);
  font-family: inherit; font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
  cursor: pointer;
  /* A finger that drifts while talking must not become a scroll, which would
     cancel the press. No callout, no selection: it is held, not read. */
  touch-action: none;
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
/* The bar is the only thing the finger can land on, so the bar keeps it. */
.htt > * { pointer-events: none; }
.htt.talking { background: var(--accent); color: var(--text-on-accent); }
/* Still over the veil, so still white (a theme-following grey would turn to
   ink on the light themes); quieter, but readable: it says why. */
.htt:disabled {
  cursor: default;
  background: linear-gradient(var(--hover), var(--hover)), var(--media-veil-strong);
  color: var(--on-media);
}
.htt:disabled > * { opacity: .6; }
.htt-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>

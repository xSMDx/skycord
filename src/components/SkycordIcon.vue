<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import lottie, { type AnimationItem } from 'lottie-web'
import skycordSpinData from '@/assets/lottie/skycord-spin.json'
import { appearance } from '@/composables/useAppearance'

const props = withDefaults(defineProps<{
  size?:  number | string
  color?: string
  /**
   * 'static'  — plain SVG, no lottie-web loaded at all. Use anywhere the icon
   *             just sits still (sidebar logo, favicon-adjacent spots, etc).
   * 'loading' — always spinning. Use for loading screens / splash states.
   * 'hover'   — spins only while the cursor is over it, then settles back to
   *             rest. Use in the chat room per the hover-icon request.
   * 'lucky'   — sits still, but a hover OR click has a 1-in-30 chance to spin
   *             once. An easter egg — most interactions do nothing.
   */
  mode?: 'static' | 'loading' | 'hover' | 'lucky'
}>(), {
  size:  32,
  color: 'currentColor',
  mode:  'static',
})

const lottieEl = ref<HTMLDivElement | null>(null)
let anim: AnimationItem | null = null

// The source asset is drawn in black (#000) — recolor every shape's fill/stroke
// to match the `color` prop so it isn't a black hole on the app's dark surfaces.
// `currentColor` has no meaning inside a Lottie JSON (it's not CSS), so when
// that's the prop value we read the actual resolved text color off the DOM
// element itself once it's mounted, the same way a real currentColor would.
const resolveColor = (raw: string): string => {
  if (raw !== 'currentColor') return raw
  if (!lottieEl.value) return '#dcddde' // sensible dark-theme fallback pre-mount
  const computed = getComputedStyle(lottieEl.value).color
  const match = computed.match(/\d+/g)
  if (!match) return '#dcddde'
  const [r, g, b] = match.map(Number)
  return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

const buildRecoloredData = (rawColor: string) => {
  const clone = JSON.parse(JSON.stringify(skycordSpinData))
  const hex = resolveColor(rawColor).replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if ((node.ty === 'fl' || node.ty === 'st') && node.c?.k) node.c.k = [r, g, b]
    Object.values(node).forEach(walk)
  }
  walk(clone)
  return clone
}

const buildAnim = () => {
  if (!lottieEl.value) return
  anim = lottie.loadAnimation({
    container: lottieEl.value,
    renderer: 'svg',
    loop:     props.mode === 'loading',
    autoplay: props.mode === 'loading',
    animationData: buildRecoloredData(props.color),
  })
  // One-shot modes settle back to the rest pose (frame 0) after a spin.
  if (props.mode === 'hover' || props.mode === 'lucky') {
    anim.addEventListener('complete', () => anim?.goToAndStop(0, true))
  }
}

const destroyAnim = () => { anim?.destroy(); anim = null }

// Easter egg: only 1 interaction in 30 actually spins.
const SPIN_CHANCE = 1 / 30
const maybeSpin = () => {
  if (!anim) return
  if (Math.random() < SPIN_CHANCE) { anim.loop = false; anim.goToAndPlay(0, true) }
}

const onEnter = () => {
  if (props.mode === 'hover') {
    // CSS hover-state color changes never trigger Vue reactivity, so rebuild
    // right before playing to capture whatever color is true at this moment.
    destroyAnim(); buildAnim(); anim?.play()
  } else if (props.mode === 'lucky') {
    maybeSpin()
  }
}
const onClick = () => { if (props.mode === 'lucky') maybeSpin() }
const onLeave = () => {
  // Let the current spin finish rather than snapping back — feels less abrupt
  // than stop(); just don't queue another loop.
}

onMounted(() => {
  if (props.mode !== 'static') buildAnim()
})
onBeforeUnmount(destroyAnim)

watch(() => props.mode, (newMode, oldMode) => {
  if (oldMode !== 'static' && anim) destroyAnim()
  if (newMode !== 'static') buildAnim()
})

watch(() => props.color, () => {
  if (props.mode === 'static' || !anim) return
  destroyAnim()
  buildAnim()
})

// When `color` resolves to currentColor, the baked Lottie color is frozen at
// build time — so a theme change must rebuild it, otherwise the logo keeps the
// old theme's color and can vanish (e.g. a light mark on a now-light surface).
watch(
  () => [appearance.theme, appearance.scheme, appearance.contrast, appearance.accent, JSON.stringify(appearance.custom)],
  () => {
    if (props.mode === 'static' || !anim || props.color !== 'currentColor') return
    destroyAnim()
    buildAnim()
  },
)
</script>

<template>
  <!-- Static mode: plain SVG, zero JS dependency -->
  <svg
    v-if="mode === 'static'"
    :width="size" :height="size"
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
    class="skycord-icon"
  >
    <rect width="256" height="256" fill="none" />
    <path
      fill="none" :stroke="color"
      stroke-linecap="round" stroke-linejoin="round" stroke-width="16"
      d="M24,64a24,24,0,0,1,48,0H184a24,24,0,0,1,48,0v80a64,64,0,0,1-64,64H88a64,64,0,0,1-64-64Z"
    />
    <circle cx="92"  cy="140" r="12" :fill="color" />
    <circle cx="164" cy="140" r="12" :fill="color" />
  </svg>

  <!-- Loading / hover mode: lottie-rendered, with the same flat footprint -->
  <div
    v-else
    ref="lottieEl"
    class="skycord-icon skycord-icon-lottie"
    :style="{ width: typeof size === 'number' ? size + 'px' : size, height: typeof size === 'number' ? size + 'px' : size }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @click="onClick"
  />
</template>

<style scoped>
.skycord-icon {
  display: block;
  flex-shrink: 0;
}
.skycord-icon-lottie {
  cursor: default;
}
.skycord-icon-lottie :deep(svg) {
  width: 100% !important;
  height: 100% !important;
}
</style>
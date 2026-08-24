<script setup lang="ts">
/**
 * Saturation/value square + hue strip + hex field, matching the picker pattern
 * used for banner colour.
 *
 * Works in HSV internally rather than storing the hex alone: at value 0 every
 * hue is black, so a picker that round-tripped through hex would lose the hue
 * the moment you dragged to the bottom of the square and snap the knob back to
 * red. Keeping h/s/v as the source of truth and emitting hex leaves the knobs
 * where the user put them.
 */
import { ref, watch, onMounted } from 'vue'
import { Pipette } from 'lucide-vue-next'

const props = defineProps<{ modelValue: string | null; presets?: string[] }>()
const emit  = defineEmits<{ 'update:modelValue': [hex: string] }>()

const DEFAULT_PRESETS = ['#1e6fd9', '#1a2b57', '#2f9e5f', '#b8912f', '#c33bbd', 'var(--state-fault)']

const h = ref(0), s = ref(0), v = ref(0)
const hexText = ref('000000')

const hsv2hex = (hh: number, ss: number, vv: number) => {
  const f = (n: number) => {
    const k = (n + hh / 60) % 6
    return vv - vv * ss * Math.max(Math.min(k, 4 - k, 1), 0)
  }
  return '#' + [f(5), f(3), f(1)]
    .map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}
const hex2hsv = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b)
  let hh = 0
  if (d) hh = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  if (hh < 0) hh += 360
  return { h: hh, s: mx ? d / mx : 0, v: mx }
}

const push = () => {
  const hex = hsv2hex(h.value, s.value, v.value)
  hexText.value = hex.slice(1)
  emit('update:modelValue', hex)
}

// Only adopt an incoming value when it differs from what we'd emit, or typing
// in the hex field would fight the parent echoing the same colour back.
const adopt = (hex: string | null) => {
  const val = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#000000'
  if (val === hsv2hex(h.value, s.value, v.value)) return
  const c = hex2hsv(val)
  h.value = c.h; s.value = c.s; v.value = c.v
  hexText.value = val.slice(1)
}
onMounted(() => adopt(props.modelValue))
watch(() => props.modelValue, adopt)

const onHexInput = (e: Event) => {
  const raw = (e.target as HTMLInputElement).value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
  hexText.value = raw
  if (raw.length === 6) {
    const c = hex2hsv('#' + raw)
    h.value = c.h; s.value = c.s; v.value = c.v
    emit('update:modelValue', '#' + raw.toLowerCase())
  }
}

// Pointer capture so a drag that leaves the square keeps tracking, and clamped
// so the knob can't be dragged outside its own box.
const track = (el: HTMLElement, e: PointerEvent, fn: (x: number, y: number) => void) => {
  el.setPointerCapture(e.pointerId)
  const run = (ev: PointerEvent) => {
    const r = el.getBoundingClientRect()
    fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
       Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
  }
  run(e)
  const move = (ev: PointerEvent) => run(ev)
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
const onSV  = (e: PointerEvent) => track(e.currentTarget as HTMLElement, e, (x, y) => { s.value = x; v.value = 1 - y; push() })
const onHue = (e: PointerEvent) => track(e.currentTarget as HTMLElement, e, (x)    => { h.value = x * 360; push() })

// Not every browser ships EyeDropper; the button is simply hidden when absent
// rather than offering something that throws.
const hasEyedropper = typeof (window as any).EyeDropper === 'function'
const pickFromScreen = async () => {
  try {
    const { sRGBHex } = await new (window as any).EyeDropper().open()
    if (/^#[0-9a-f]{6}$/i.test(sRGBHex)) { adopt(sRGBHex); emit('update:modelValue', sRGBHex.toLowerCase()) }
  } catch { /* dismissed */ }
}
</script>

<template>
  <div class="cp">
    <div
      class="cp-sv"
      :style="{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h},100%,50%))` }"
      @pointerdown="onSV"
    >
      <span class="cp-knob" :style="{ left: s * 100 + '%', top: (1 - v) * 100 + '%' }" />
    </div>

    <div class="cp-hue" @pointerdown="onHue">
      <span class="cp-knob" :style="{ left: (h / 360) * 100 + '%', top: '50%' }" />
    </div>

    <div class="cp-hex">
      <span>#</span>
      <input :value="hexText" maxlength="6" spellcheck="false" aria-label="Hex colour" @input="onHexInput" />
      <button v-if="hasEyedropper" class="cp-eye" v-tip="'Pick from screen'" @click="pickFromScreen">
        <Pipette :size="15" :stroke-width="1.75" />
      </button>
    </div>

    <div class="cp-presets">
      <button
        v-for="p in (presets || DEFAULT_PRESETS)" :key="p"
        :style="{ background: p }" v-tip="p" :aria-label="p"
        @click="adopt(p); emit('update:modelValue', p)"
      />
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.cp { width: 240px; }
.cp-sv { height: 150px; border-radius: 5px; position: relative; cursor: crosshair; margin-bottom: 12px; touch-action: none; }
.cp-hue {
  height: 12px; border-radius: 6px; position: relative; cursor: pointer; margin-bottom: 14px; touch-action: none;
  background: linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);
}
.cp-knob {
  position: absolute; width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.5);
  transform: translate(-50%,-50%); pointer-events: none;
}
.cp-hex {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  background: var(--bg-input); border: 1px solid var(--accent);
  border-radius: 5px; padding: 8px 10px;
}
.cp-hex span  { color: var(--text-3); font-family: var(--font-mono); font-size: 14px; }
.cp-hex input {
  flex: 1; min-width: 0; background: none; border: none; outline: none;
  color: var(--text-1); font-family: var(--font-mono); font-size: 14px; text-transform: lowercase;
}
.cp-eye { color: var(--text-3); display: flex; }
.cp-eye:hover { color: var(--text-1); }
.cp-presets { display: flex; gap: 8px; }
.cp-presets button { width: 32px; height: 32px; border-radius: 6px; transition: transform var(--dur-1) var(--ease-out); }
.cp-presets button:hover { transform: translateY(-2px); }
</style>

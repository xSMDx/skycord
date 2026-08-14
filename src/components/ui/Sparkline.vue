<script setup lang="ts">
/**
 * A small time-series graph for the RTC debug panel.
 *
 * Deliberately not a charting library: these plot at most 60 points, redraw
 * once a second, and there can be a dozen on screen at once. An SVG polyline
 * costs nothing; a chart lib would cost 40KB and a render loop.
 *
 * The y-axis auto-scales to the window unless `max` is given, and always
 * includes zero so a flat-but-nonzero line still reads as "high", not "empty".
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  /** Fixed ceiling. Omit to scale to whatever is in the window. */
  max?: number
  /** Expected sample count — fixes the x-scale so a filling graph grows from
   *  the right instead of stretching, the way a real monitor behaves. */
  capacity?: number
  height?: number
  color?: string
  /** Rendered top-right: the current value, already formatted. */
  value?: string
  label?: string
  /** Turns the y-axis tick labels on. */
  ticks?: boolean
  /** Formats the tick labels. Defaults to a rounded number. */
  fmtTick?: (v: number) => string
}>(), {
  height: 56, capacity: 60, color: 'var(--accent)', ticks: true,
})

const W = 300   // viewBox units; the SVG scales to its container
const pad = 2

const scaleMax = computed(() => {
  if (typeof props.max === 'number' && props.max > 0) return props.max
  const peak = props.data.length ? Math.max(...props.data) : 0
  if (peak <= 0) return 1
  // Round up to something legible rather than hugging the peak exactly.
  const mag = Math.pow(10, Math.floor(Math.log10(peak)))
  return Math.ceil(peak / mag) * mag
})

const H = computed(() => props.height)

const points = computed(() => {
  const d = props.data
  if (!d.length) return ''
  const cap = Math.max(props.capacity, 2)
  const step = W / (cap - 1)
  const top = pad, bot = H.value - pad
  // Anchor the newest sample to the right edge.
  const offset = W - (d.length - 1) * step
  return d.map((v, i) => {
    const x = offset + i * step
    const y = bot - (Math.min(v, scaleMax.value) / scaleMax.value) * (bot - top)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})

/** Closes the polyline into the baseline so it can be filled. */
const area = computed(() => {
  if (!points.value) return ''
  const first = points.value.split(' ')[0].split(',')[0]
  const last  = points.value.split(' ').slice(-1)[0].split(',')[0]
  return `${first},${H.value - pad} ${points.value} ${last},${H.value - pad}`
})

const tickVals = computed(() => {
  const m = scaleMax.value
  return [m, m / 2, 0]
})
const fmt = (v: number) => (props.fmtTick ? props.fmtTick(v) : String(Math.round(v)))
const uid = `sl${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <div class="sl">
    <div v-if="label || value" class="sl-head">
      <span class="sl-label">{{ label }}</span>
      <span v-if="value" class="sl-value">{{ value }}</span>
    </div>
    <div class="sl-body">
      <svg class="sl-svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" :style="{ height: H + 'px' }">
        <defs>
          <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   :stop-color="color" stop-opacity=".28" />
            <stop offset="100%" :stop-color="color" stop-opacity="0" />
          </linearGradient>
        </defs>
        <!-- Gridlines at the tick positions, so the fill has something to sit on -->
        <line v-for="(_, i) in 3" :key="i" class="sl-grid"
              x1="0" :x2="W" :y1="pad + (i * (H - pad * 2) / 2)" :y2="pad + (i * (H - pad * 2) / 2)" />
        <polygon v-if="area" :points="area" :fill="`url(#${uid})`" />
        <polyline v-if="points" :points="points" fill="none" :stroke="color" stroke-width="1.5"
                  vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <div v-if="ticks" class="sl-ticks" :style="{ height: H + 'px' }">
        <span v-for="(t, i) in tickVals" :key="i">{{ fmt(t) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sl { min-width: 0; }
.sl-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.sl-label { font-size: 12px; color: var(--text-2); font-weight: 600; }
.sl-value { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }

.sl-body { display: flex; align-items: stretch; gap: 6px; }
.sl-svg { flex: 1; min-width: 0; display: block; }
.sl-grid { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; opacity: .5; }

.sl-ticks {
  display: flex; flex-direction: column; justify-content: space-between;
  font-size: 9px; color: var(--text-faint); font-variant-numeric: tabular-nums;
  text-align: right; min-width: 26px; flex-shrink: 0;
  /* Nudge so the labels sit ON the gridlines rather than between them. */
  margin: -4px 0;
}
</style>

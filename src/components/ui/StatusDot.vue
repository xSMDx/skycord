<script setup lang="ts">
/**
 * A presence dot: a colour, a shape and a name.
 *
 * The colour alone was three failures at once — under the 3:1 a graphical
 * object needs on the light themes, indistinguishable to a red/green
 * colour-blind reader, and announced to a screen reader as nothing at all.
 * The shape is what actually carries the status here (online filled, idle a
 * crescent, do-not-disturb a bar, offline a hollow ring); the colour confirms
 * it and the label says it.
 *
 * The shapes are cut with a mask rather than drawn in the surface colour, so
 * the holes show whatever is behind the dot. Each call site keeps its existing
 * ring (`border: 2px solid var(--bg-panel)`) and sets this element's own
 * `background` to the SAME token, so a crescent reads as a bite taken out of
 * the dot rather than a grey shape sitting on it — and it stays correct when
 * the theme changes the surface under it.
 */
import { computed } from 'vue'
import { statusColor, statusLabel } from '@/composables/usePresence'
import { nextMaskId, statusShape } from './statusShape'

const props = withDefaults(defineProps<{
  status?: string | null
  /** False where visible text next to the dot already names the status — the
   *  status picker — so it is not announced twice. */
  named?: boolean
}>(), { named: true })

const shape = computed(() => statusShape(props.status))

// One id per dot — see nextMaskId, which explains why sharing four ids
// across the page is a bug rather than an optimisation.
const maskId = nextMaskId()
</script>

<template>
  <span
    class="sd"
    :style="{ color: statusColor(status) }"
    :role="named ? 'img' : undefined"
    :aria-label="named ? statusLabel(status) : undefined"
    :aria-hidden="named ? undefined : 'true'"
  >
    <svg viewBox="0 0 10 10" width="100%" height="100%" aria-hidden="true" focusable="false">
      <mask :id="maskId">
        <rect width="10" height="10" fill="white" />
        <!-- Cut sizes checked at 9px, the smallest dot in the app (the DM
             header): the crescent's bite has to clear the anti-aliased edge
             or it reads as a slightly dented circle, and the bar has to stay
             thick enough not to disappear into the ring around it. -->
        <circle v-if="shape === 'crescent'" cx="2.4" cy="2.4" r="3.7" fill="black" />
        <rect v-else-if="shape === 'bar'" x="1.9" y="4.05" width="6.2" height="1.9" rx=".95" fill="black" />
        <circle v-else-if="shape === 'ring'" cx="5" cy="5" r="2.6" fill="black" />
      </mask>
      <circle cx="5" cy="5" r="5" fill="currentColor" :mask="shape === 'filled' ? undefined : `url(#${maskId})`" />
    </svg>
  </span>
</template>

<style scoped>
.sd { display: inline-block; line-height: 0; }
.sd svg { display: block; }
</style>

<script setup lang="ts">
/**
 * Settings › Updates — the page that says what is happening.
 *
 * Its most important state is the dull one. "Skycord is up to date", with the
 * time of the last check, is what distinguishes a working updater from one
 * that has quietly given up — a distinction that did not exist here, and cost
 * a week on a build eight days old.
 */
import { computed } from 'vue'
import { useUpdates, updateLabel } from '@/composables/useUpdates'
import '@/styles/settingsShared.css'

const { state, supported, check, install } = useUpdates()

const label = computed(() => updateLabel(state.value))
const busy = computed(() => state.value.phase === 'checking' || state.value.phase === 'downloading')
const pct = computed(() => Math.round(state.value.percent))
const lastChecked = computed(() =>
  state.value.lastCheckedAt ? new Date(state.value.lastCheckedAt).toLocaleString() : 'never')

/** MB/s, because a percentage alone cannot tell a slow download from a stuck one. */
const speed = computed(() => {
  const bps = state.value.bytesPerSecond
  return bps > 0 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : ''
})
</script>

<template>
  <div v-if="!supported" class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Updates are handled by the Skycord app</span>
        <span class="st-field-value">In a browser, reloading the page is all it takes.</span>
      </div>
    </div>
  </div>

  <template v-else>
    <div class="st-card">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">{{ label }}</span>
          <span class="st-field-value">Last checked: {{ lastChecked }}</span>
        </div>
        <button
          v-if="state.phase === 'ready'"
          type="button" class="st-btn st-btn--primary" @click="install()"
        >Restart to update</button>
        <button v-else type="button" class="st-btn" :disabled="busy" @click="check()">
          {{ busy ? 'Working…' : 'Check now' }}
        </button>
      </div>

      <div
        v-if="state.phase === 'downloading'" class="up-bar" role="progressbar"
        :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" :aria-label="label"
      >
        <div class="up-fill" :style="{ transform: `scaleX(${pct / 100})` }" />
      </div>
      <p v-if="state.phase === 'downloading' && speed" class="up-speed">{{ speed }}</p>
    </div>

    <div class="st-card">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">How updating works</span>
          <span class="st-field-value">
            Skycord checks when it starts and every six hours. An update downloads in the background
            while you carry on, and only installs when you press Restart — never on its own, and
            never in the middle of a call.
          </span>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.up-bar { height: 6px; margin-top: 12px; overflow: hidden; border-radius: 3px; background: var(--bg-input); }
/* scaleX, not width: animating width is a layout animation, and the repo has
   a test that says so. transform-origin pins it to the left edge. */
.up-fill {
  width: 100%; height: 100%; border-radius: inherit;
  background: var(--accent); color: var(--text-on-accent);
  transform-origin: left center;
  transition: transform var(--dur-2) var(--ease-out);
}
.up-speed { margin: 8px 0 0; color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .up-fill { transition: none; } }
</style>

<script setup lang="ts">
/**
 * Connection status strip.
 *
 * The socket has tracked `connected` since it was written, but nothing ever
 * showed it — so losing the connection was completely silent. Messages simply
 * stopped arriving and the app looked idle rather than broken.
 *
 * Deliberately NOT a permanent "Connected" badge. A healthy connection is the
 * expected state, and a green light that's always on becomes furniture people
 * stop seeing — which then makes its absence just as invisible. So: silent when
 * healthy, visible when it isn't, and a brief confirmation on recovery so the
 * disappearance is explained rather than just happening.
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { Wifi, WifiOff, LoaderCircle } from 'lucide-vue-next'
import { useSocket } from '@/composables/useSocket'

const { connState, retry } = useSocket()

/** Shown briefly after recovery, then hidden again. */
const justReconnected = ref(false)
let recoverTimer: ReturnType<typeof setTimeout> | null = null

watch(connState, (now, was) => {
  // Only celebrate an actual recovery — not the first connect on page load,
  // where there was nothing to recover from and a flash would be noise.
  if (now === 'connected' && (was === 'connecting' || was === 'offline')) {
    justReconnected.value = true
    if (recoverTimer) clearTimeout(recoverTimer)
    recoverTimer = setTimeout(() => { justReconnected.value = false }, 2200)
  }
  if (now !== 'connected') justReconnected.value = false
})

const visible = computed(() => connState.value !== 'connected' || justReconnected.value)

/*
 * Reserve space for the strip instead of floating it over the app.
 *
 * Overlaying looked fine until it covered the chat header's back button — a
 * status message that hides navigation is worse than no status message. So the
 * app shrinks by exactly the strip's height while it's up.
 *
 * Measured rather than hard-coded, because the safe-area inset makes the height
 * device-dependent: 28px in a browser tab, more on a notched phone.
 */
const el = ref<HTMLElement | null>(null)
const setOffset = (px: number) =>
  document.documentElement.style.setProperty('--conn-h', `${px}px`)

watch(visible, async v => {
  if (!v) { setOffset(0); return }
  await nextTick()
  setOffset(el.value?.offsetHeight ?? 28)
}, { immediate: true })

onBeforeUnmount(() => setOffset(0))

const view = computed(() => {
  if (justReconnected.value) return { tone: 'ok'   as const, text: 'Back online' }
  if (connState.value === 'connecting') return { tone: 'wait' as const, text: 'Reconnecting…' }
  return { tone: 'bad' as const, text: 'Can’t reach Skycord' }
})
</script>

<template>
  <Transition name="cb">
    <div v-if="visible" ref="el" class="cb" :class="view.tone" role="status" aria-live="polite">
      <LoaderCircle v-if="view.tone === 'wait'" class="cb-ico cb-spin" :size="14" :stroke-width="2.25" />
      <WifiOff      v-else-if="view.tone === 'bad'" class="cb-ico" :size="14" :stroke-width="2.25" />
      <Wifi         v-else class="cb-ico" :size="14" :stroke-width="2.25" />

      <span class="cb-text">{{ view.text }}</span>

      <!-- Only when nothing is retrying on its own — offering "Try again"
           mid-retry would just interrupt a reconnect already in progress. -->
      <button v-if="view.tone === 'bad'" class="cb-retry" @click="retry">Try again</button>
    </div>
  </Transition>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

/* Pinned above everything, including modals — the connection being down is
   more important than whatever is open, and it must not be coverable.
   Safe-area inset so it clears the notch when installed. */
.cb {
  position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: calc(6px + env(safe-area-inset-top)) 12px 6px;
  font-size: 12.5px; font-weight: 600; letter-spacing: .01em;
  color: #fff;
}
.cb.wait { background: #b8871f; }
.cb.bad  { background: #a12f31; }
.cb.ok   { background: #1c7a45; }

.cb-ico  { flex-shrink: 0; }
.cb-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.cb-retry {
  margin-left: 4px; padding: 3px 10px; border-radius: 999px;
  background: rgba(255,255,255,.18); font-size: 12px; font-weight: 700;
  /* 44px would dwarf a 30px-tall strip; the surrounding bar is a large target
     already and this sits alone, so a smaller pill is legitimate here. */
  min-height: 26px;
}
.cb-retry:active { background: rgba(255,255,255,.3); }

.cb-spin { animation: cb-rot 1s linear infinite; }
@keyframes cb-rot { to { transform: rotate(360deg); } }

/* Slides from the top edge and leaves the same way, so it reads as one object
   coming and going rather than two unrelated events. */
.cb-enter-active, .cb-leave-active { transition:transform .26s cubic-bezier(.32,.72,0,1), opacity var(--dur-3) var(--ease-out); }
.cb-enter-from, .cb-leave-to { transform: translateY(-100%); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .cb-enter-active, .cb-leave-active { transition: opacity var(--dur-3) var(--ease-out); }
  .cb-enter-from, .cb-leave-to { transform: none; }
  .cb-spin { animation: none; }
}
</style>

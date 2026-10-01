<script setup lang="ts">
/**
 * Settings › Debug — the page that would have saved the week.
 *
 * Every row here is something that was invisible while it was broken: which
 * build is running, whether the capture addon loaded, whether the audio
 * worklet fetched, what the updater last did. Each of those cost a day.
 *
 * None of it is private, so the whole thing copies in one press and can be
 * pasted into a conversation without being read first.
 */
import { computed, onMounted, ref } from 'vue'
import { desktopBridge, type AboutFacts } from '@/composables/desktopBridge'
import { useUpdates, updateLabel } from '@/composables/useUpdates'
import { diagnosticsText } from '@/composables/diagnosticsText'
import { setDebugUnlocked } from '@/composables/debugUnlock'
import '@/styles/settingsShared.css'

const facts = ref<AboutFacts | null>(null)
const workletLoaded = ref(false)
const copied = ref(false)
const { state } = useUpdates()

const origin = location.origin
const bundle = computed(() =>
  [...document.querySelectorAll('script[src]')]
    .map(s => (s as HTMLScriptElement).src)
    .find(u => /assets\/index-/.test(u))?.split('/').pop() ?? 'unknown')

onMounted(async () => {
  facts.value = (await desktopBridge()?.about?.()) ?? null
  // A HEAD is enough: the failure that mattered was a 404, not bad contents.
  try { workletLoaded.value = (await fetch('/share-audio-worklet.js', { method: 'HEAD' })).ok }
  catch { workletLoaded.value = false }
})

const text = computed(() => facts.value
  ? diagnosticsText(facts.value, {
      origin, bundle: bundle.value, workletLoaded: workletLoaded.value, update: updateLabel(state.value),
    })
  : [
      'web client',
      `instance: ${origin}`,
      `bundle: ${bundle.value}`,
      `worklet: ${workletLoaded.value ? 'loaded' : 'not loaded'}`,
    ].join('\n'))

const copy = async () => {
  try {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch { /* the clipboard can be refused; the text is on screen regardless */ }
}
const reload = () => location.reload()
</script>

<template>
  <div class="st-card">
    <pre class="dbg-text">{{ text }}</pre>
  </div>

  <div class="dbg-row">
    <button type="button" class="st-btn st-btn--primary" @click="copy">
      {{ copied ? 'Copied' : 'Copy diagnostics' }}
    </button>
    <button type="button" class="st-btn" @click="reload">Reload client</button>
    <button type="button" class="st-btn" @click="setDebugUnlocked(false)">Hide this page</button>
  </div>

  <p v-if="!facts" class="st-hint">
    The version and capture rows are desktop only — this is the web client.
  </p>
  <p class="st-hint">
    Reload client fetches the page again past the cache, which is what to try when the app looks
    older than the server. Hide this page puts it away; seven taps on the Skycord icon in About
    this instance brings it back.
  </p>
</template>

<style scoped>
.dbg-text {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font: 400 12.5px/1.7 var(--font-mono, ui-monospace, "Cascadia Mono", Consolas, monospace);
  color: var(--text-1);
}
.dbg-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 12px; }
</style>

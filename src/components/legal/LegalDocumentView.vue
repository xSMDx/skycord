<script setup lang="ts">
/**
 * One legal text, loaded when shown. A host's document is Markdown and goes
 * through renderLegalMarkdown, which lets no raw HTML, image or unsafe link
 * through; the AGPL is plain text and is shown exactly as written.
 */
import { onMounted, ref, watch } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import { renderLegalMarkdown } from '@/composables/legalMarkdown'

const props = defineProps<{
  load: () => Promise<string>
  format: 'markdown' | 'plain'
}>()

const html = ref('')
const text = ref('')
const state = ref<'loading' | 'ready' | 'failed'>('loading')

const run = async () => {
  state.value = 'loading'
  try {
    const source = await props.load()
    if (props.format === 'markdown') html.value = await renderLegalMarkdown(source)
    else text.value = source
    state.value = 'ready'
  } catch {
    state.value = 'failed'
  }
}

onMounted(run)
watch(() => props.load, run)
</script>

<template>
  <div class="ld" :aria-busy="state === 'loading' ? 'true' : undefined">
    <p v-if="state === 'loading'" class="ld-status">
      <LoaderCircle class="ld-spin" :size="16" :stroke-width="2.25" aria-hidden="true" />
      Loading…
    </p>
    <p v-else-if="state === 'failed'" class="ld-status" role="alert">
      Couldn't load this document.
      <button type="button" class="ld-retry" @click="run">Try again</button>
    </p>
    <!-- The one v-html here: renderLegalMarkdown escapes raw HTML, renders no
         images and drops every link that is not https:, http: or mailto:. -->
    <div v-else-if="format === 'markdown'" class="ld-body" v-html="html" />
    <pre v-else class="ld-plain">{{ text }}</pre>
  </div>
</template>

<style scoped>
.ld { color: var(--text-1); font-size: 14px; line-height: 1.6; }
.ld-status { display: flex; align-items: center; gap: 8px; color: var(--text-3); margin: 8px 0; }
.ld-retry {
  background: none; border: none; padding: 0; font: inherit; font-weight: 600;
  color: var(--text-link); cursor: pointer;
}
.ld-retry:hover { text-decoration: underline; }
.ld-spin { animation: ld-rot 1s linear infinite; }
@keyframes ld-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ld-spin { animation: none; } }

.ld-body { max-width: 72ch; overflow-wrap: anywhere; }
.ld-body :deep(h1) { font-size: 20px; font-weight: 700; color: var(--text-strong); margin: 4px 0 12px; }
.ld-body :deep(h2) { font-size: 16px; font-weight: 700; color: var(--text-strong); margin: 22px 0 8px; }
.ld-body :deep(h3) { font-size: 14px; font-weight: 700; color: var(--text-1); margin: 18px 0 6px; }
.ld-body :deep(p) { margin: 0 0 10px; }
.ld-body :deep(ul), .ld-body :deep(ol) { margin: 0 0 10px; padding-left: 22px; }
.ld-body :deep(li) { margin: 2px 0; }
.ld-body :deep(a) { color: var(--text-link); text-decoration: underline; }
.ld-body :deep(code) {
  font-family: var(--font-mono); font-size: 13px;
  background: var(--bg-input); border-radius: 4px; padding: 1px 4px;
}
.ld-body :deep(pre) { background: var(--bg-input); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
.ld-body :deep(pre code) { background: none; padding: 0; }
.ld-body :deep(blockquote) { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid var(--border); color: var(--text-2); }
.ld-plain {
  margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; color: var(--text-2);
}
</style>

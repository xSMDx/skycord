<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { PhPalette } from '@phosphor-icons/vue'
import { useApi } from '@/composables/useApi'
import { useAppearance, type Appearance } from '@/composables/useAppearance'

// A message carries EITHER an inline theme code (offline-decodable) or a link
// slug (fetched). Both resolve to a themeable partial + a name to show.
const props = defineProps<{ code?: string; slug?: string }>()

const { parseTheme, sanitizeTheme, previewTheme, setAppearance } = useAppearance()
const { getTheme } = useApi()

type State = 'loading' | 'ready' | 'error'
const state = ref<State>('loading')
const name  = ref('Shared theme')
const author = ref<string | null>(null)
const data  = ref<Partial<Appearance> | null>(null)

const THEME_BG: Record<string, string> = {
  default: '#313338', midnight: '#1a1b1f', amoled: '#000000',
  light: '#ffffff', 'light-dim': '#eceef0', custom: '#313338',
}

// A few representative dots: accent first, then key surfaces (custom overrides
// win, else the theme preset's chat background + standard panel/floor).
const swatches = computed<string[]>(() => {
  const d = data.value
  if (!d) return []
  const c = (d.custom ?? {}) as Record<string, string>
  return [
    d.accent || '#5865f2',
    c['--bg-chat']  || THEME_BG[d.theme || 'default'] || '#313338',
    c['--bg-panel'] || '#2b2d31',
    c['--bg-floor'] || '#111214',
  ]
})

onMounted(async () => {
  if (props.code) {
    const t = parseTheme(props.code)
    if (!t) { state.value = 'error'; return }
    data.value = t; state.value = 'ready'
    return
  }
  if (props.slug) {
    try {
      const r = await getTheme(props.slug)
      name.value = r.name || 'Shared theme'
      author.value = r.authorName || null
      data.value = sanitizeTheme(r.data)
      state.value = 'ready'
    } catch { state.value = 'error' }
    return
  }
  state.value = 'error'
})

const onPreview = () => { if (data.value) previewTheme(data.value) }
const onApply   = () => { if (data.value) setAppearance(data.value) }
</script>

<template>
  <div class="theme-card">
    <template v-if="state === 'loading'">
      <div class="tc-loading">Loading theme…</div>
    </template>

    <template v-else-if="state === 'error'">
      <div class="tc-icon tc-icon--err"><PhPalette :size="20" weight="bold" /></div>
      <div class="tc-body"><span class="tc-name">Theme unavailable</span><span class="tc-sub">This theme code or link is invalid.</span></div>
    </template>

    <template v-else>
      <div class="tc-icon"><PhPalette :size="20" weight="bold" /></div>
      <div class="tc-body">
        <span class="tc-name">{{ name }}</span>
        <span class="tc-sub">
          <span class="tc-swatches"><i v-for="(s, i) in swatches" :key="i" :style="{ background: s }" /></span>
          <span v-if="author">by {{ author }}</span>
          <span v-else>Appearance theme</span>
        </span>
      </div>
      <div class="tc-actions">
        <button class="tc-btn ghost" @click.stop="onPreview">Preview</button>
        <button class="tc-btn primary" @click.stop="onApply">Apply</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.theme-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-floor); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px; margin-top: 6px; max-width: 420px;
}
.tc-loading { color: var(--text-3); font-size: 13px; }
.tc-icon {
  width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: var(--text-on-accent);
}
.tc-icon--err { background: #4f3535; color: var(--text-strong); }
.tc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.tc-name { font-size: 15px; font-weight: 700; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tc-sub { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 8px; }
.tc-swatches { display: inline-flex; gap: 3px; }
.tc-swatches i { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.25); }
.tc-actions { display: flex; gap: 8px; flex-shrink: 0; }
.tc-btn { padding: 7px 13px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .12s; }
.tc-btn.ghost { color: var(--text-2); background: rgba(128,132,142,.16); }
.tc-btn.ghost:hover { background: rgba(128,132,142,.28); color: var(--text-strong); }
.tc-btn.primary { color: var(--text-on-accent); background: var(--accent); }
.tc-btn.primary:hover { background: var(--accent-hover); }
</style>

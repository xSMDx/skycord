<script setup lang="ts">
/**
 * The flag for an ISO-3166 alpha-2 country code.
 *
 * An SVG, not the emoji. Regional-indicator flag emoji have no glyphs on
 * Windows at all — every one of them renders as the two letters, so "🇩🇪"
 * shows up as "DE" for a large share of the people this screen is for. The
 * emoji also can't be sized reliably against surrounding text.
 *
 * Loaded one flag at a time rather than through `flag-icons.min.css`. That
 * stylesheet carries all 271 flags, most of them inlined as data URIs by the
 * bundler — 425KB of CSS to draw the two or three flags a real devices list
 * actually contains. `import.meta.glob` gives the bundler each file separately
 * instead, so a viewer fetches only what is on screen.
 *
 * The name comes from `Intl.DisplayNames`, which every target browser has and
 * which localises to the reader's own language for free. That name is the
 * accessible text: a flag with no name is decoration to a screen reader, and
 * unidentifiable to plenty of sighted readers too.
 */
import { ref, computed, watch } from 'vue'

const props = defineProps<{ code: string | null }>()

/**
 * Resolved at build time into a map of path → loader. Lazy (no `eager`), so
 * each flag is its own network request made only when something renders it.
 */
const FLAGS = import.meta.glob<string>(
  '/node_modules/flag-icons/flags/4x3/*.svg',
  { query: '?url', import: 'default' },
)

const src = ref<string | null>(null)

const name = computed(() => {
  if (!props.code) return ''
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(props.code) ?? props.code
  } catch {
    // A code the runtime does not recognise. The raw two letters beat nothing.
    return props.code
  }
})

watch(() => props.code, async code => {
  src.value = null
  const lower = (code ?? '').toLowerCase()
  if (!/^[a-z]{2}$/.test(lower)) return

  const load = FLAGS[`/node_modules/flag-icons/flags/4x3/${lower}.svg`]
  // A valid ISO code the flag set has no artwork for — the row simply shows the
  // address with no flag, which is the same as an unknown location.
  if (!load) return

  try {
    const url = await load()
    // The prop can change while this await is in flight.
    if (props.code?.toLowerCase() === lower) src.value = url
  } catch { /* leave it flagless */ }
}, { immediate: true })
</script>

<template>
  <!-- Not a background-image: an <img> carries the name as real alternative
       text, and gets the browser's own lazy decoding. -->
  <img v-if="src" class="cf" :src="src" :alt="name" v-tip="name" width="16" height="12" />
</template>

<style scoped>
.cf {
  /* 4:3, matching the source artwork — a squashed flag is worse than none. */
  width: 16px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  object-fit: cover;
  /* Several flags are mostly white and vanish on the panel. A hairline inset
     ring rather than a border, so it costs no layout. */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .28);
}
</style>

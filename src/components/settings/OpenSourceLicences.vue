<script setup lang="ts">
/**
 * The third-party packages bundled into this app, with their licences —
 * generated when the app is built (vite.config.ts), and loaded only when this
 * view opens.
 */
import { onMounted, ref } from 'vue'

interface Package { name: string; version: string; license: string; text: string }

const packages = ref<Package[]>([])
const state = ref<'loading' | 'ready' | 'missing'>('loading')

onMounted(async () => {
  try {
    const res = await fetch('/licenses.json', { credentials: 'omit' })
    if (!res.ok) throw new Error(String(res.status))
    packages.value = await res.json() as Package[]
    state.value = 'ready'
  } catch {
    state.value = 'missing'
  }
})
</script>

<template>
  <p v-if="state === 'loading'" class="st-hint">Loading…</p>
  <p v-else-if="state === 'missing'" class="st-hint">
    This list is written when the app is built, so a development server doesn't have one.
  </p>
  <div v-else class="st-card">
    <details v-for="pkg in packages" :key="pkg.name" class="os-item">
      <summary class="os-sum">
        <span class="os-name">{{ pkg.name }}</span>
        <span class="os-meta">{{ pkg.version }} · {{ pkg.license }}</span>
      </summary>
      <pre v-if="pkg.text" class="os-text">{{ pkg.text }}</pre>
    </details>
  </div>
</template>

<style scoped>
.os-item + .os-item { border-top: 1px solid var(--divider); }
.os-sum {
  display: flex; align-items: baseline; gap: 10px; padding: 12px 20px;
  cursor: pointer; list-style: none;
}
.os-sum::-webkit-details-marker { display: none; }
.os-sum:hover { background: var(--hover); }
.os-name { font-size: 14px; font-weight: 600; color: var(--text-1); overflow-wrap: anywhere; }
.os-meta { font-size: 12.5px; color: var(--text-3); white-space: nowrap; }
.os-text {
  margin: 0; padding: 0 20px 14px; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--font-mono); font-size: 12px; line-height: 1.5; color: var(--text-2);
}
</style>

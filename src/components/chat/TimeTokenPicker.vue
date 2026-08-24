<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatTimeToken, type TimeStyle } from '@/utils/richText'

const emit = defineEmits<{ pick: [token: string]; close: [] }>()

// datetime-local needs "YYYY-MM-DDTHH:mm" in local time
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const when = ref(toLocalInput(new Date()))
const unix = computed(() => Math.floor(new Date(when.value).getTime() / 1000))

const styles: { id: TimeStyle; label: string }[] = [
  { id: 'd', label: 'Short Date' },
  { id: 'f', label: 'Short Date/Time' },
  { id: 'F', label: 'Long Date/Time' },
  { id: 't', label: 'Short Time' },
  { id: 'T', label: 'Long Time' },
  { id: 'R', label: 'Relative' },
]
const preview = (s: TimeStyle) => formatTimeToken(unix.value, s)
const choose  = (s: TimeStyle) => emit('pick', `<t:${unix.value}:${s}>`)
</script>

<template>
  <div class="tt" @mousedown.prevent @click.stop>
    <div class="tt-header">
      <span class="tt-title">Insert a timestamp</span>
      <span class="tt-note">Everyone sees it in their own timezone</span>
    </div>
    <input v-model="when" type="datetime-local" class="tt-when" />
    <div class="tt-list">
      <button v-for="s in styles" :key="s.id" class="tt-row" @click="choose(s.id)">
        <span class="tt-preview">{{ preview(s.id) }}</span>
        <span class="tt-label">{{ s.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.tt {
  width: 320px; background: var(--bg-panel); border: 1px solid rgba(0,0,0,.4);
  border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.55); padding: 12px;
}
.tt-header { display: flex; flex-direction: column; gap: 1px; margin-bottom: 10px; }
.tt-title { font-size: 14px; font-weight: 700; color: var(--text-strong); }
.tt-note  { font-size: 12px; color: var(--text-3); }
.tt-when {
  width: 100%; padding: 8px 10px; border-radius: 6px; margin-bottom: 8px;
  background: var(--bg-input); border: 1px solid transparent; color: var(--text-1); outline: none;
  font: inherit; color-scheme: dark;
}
.tt-when:focus { border-color: var(--accent); }
.tt-list { display: flex; flex-direction: column; gap: 2px; }
.tt-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border-radius: 6px; transition: background var(--dur-1) var(--ease-out);
}
.tt-row:hover { background: rgba(var(--accent-rgb),.18); }
.tt-preview { font-size: 13.5px; color: #f2f3f5; }
.tt-label   { font-size: 11px; color: var(--text-faint); flex-shrink: 0; }
</style>

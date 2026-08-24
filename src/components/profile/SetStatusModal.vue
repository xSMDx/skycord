<script setup lang="ts">
/**
 * "Set your status" — a status line plus when it should clear itself.
 *
 * The durations are resolved to an absolute timestamp HERE, on save, rather
 * than stored as "1 hour" and interpreted later. A relative label would keep
 * sliding forward every time it was read, so the status would never actually
 * expire.
 */
import { ref, computed } from 'vue'
import { X } from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import ProfileCard from './ProfileCard.vue'

const props = defineProps<{
  user: {
    username: string; displayName?: string; discriminator?: string
    avatar?: string | null; bannerColor?: string | null; status?: string
  }
  text?: string
  saving?: boolean
}>()
const emit = defineEmits<{ save: [payload: { text: string; clearAt: string | null }]; close: [] }>()

const text = ref(props.text ?? '')

const OPTIONS = [
  { id: 'never', label: "Don't clear",  ms: null },
  { id: '30m',   label: '30 minutes',   ms: 30 * 60_000 },
  { id: '1h',    label: '1 hour',       ms: 60 * 60_000 },
  { id: '4h',    label: '4 hours',      ms: 4 * 3_600_000 },
  { id: 'today', label: 'Today',        ms: 'today' as const },
  { id: '1d',    label: 'Tomorrow',     ms: 24 * 3_600_000 },
]
const clearId = ref('never')

const clearAt = computed<string | null>(() => {
  const opt = OPTIONS.find(o => o.id === clearId.value)
  if (!opt || opt.ms === null) return null
  if (opt.ms === 'today') {
    const end = new Date(); end.setHours(23, 59, 59, 999)
    return end.toISOString()
  }
  return new Date(Date.now() + (opt.ms as number)).toISOString()
})

// Shows the resolved moment, not the label — "Tomorrow" alone doesn't tell you
// when, and this is the only place to catch a choice that isn't what you meant.
const clearPreview = computed(() => {
  if (!clearAt.value) return 'Stays until you clear it'
  const d = new Date(clearAt.value)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return sameDay ? `Clears today at ${time}`
    : `Clears ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`
})

const submit = () => emit('save', { text: text.value.trim(), clearAt: text.value.trim() ? clearAt.value : null })
</script>

<template>
  <ModalBase width="440px" @close="emit('close')">
    <div class="ss">
      <div class="ss-head">
        <h2>Set your status</h2>
        <button class="ss-x" aria-label="Close" @click="emit('close')"><X :size="18" :stroke-width="2.25" /></button>
      </div>

      <div class="ss-preview">
        <ProfileCard
          :username="user.username"
          :display-name="user.displayName"
          :avatar="user.avatar"
          :banner-color="user.bannerColor"
          :status="user.status"
          :custom-status="text.trim() ? { text: text.trim() } : null"
        />
      </div>

      <label class="ss-label" for="ss-text">Status</label>
      <input
        id="ss-text" v-model="text" class="ss-input" maxlength="128"
        placeholder="What's happening?" @keydown.enter="submit"
      />
      <div class="ss-count">{{ text.length }} / 128</div>

      <div class="ss-row">
        <span class="ss-row-l">Clear after</span>
        <select v-model="clearId" class="ss-input ss-select">
          <option v-for="o in OPTIONS" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
      </div>
      <div class="ss-hint">{{ clearPreview }}</div>

      <div class="ss-foot">
        <button class="ss-btn ghost" @click="emit('close')">Cancel</button>
        <button class="ss-btn primary" :disabled="saving" @click="submit">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.ss { padding: 22px; }
.ss-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.ss-head h2 { font-size: 20px; font-weight: 700; color: var(--text-strong); }
.ss-x { color: var(--text-3); display: flex; }
.ss-x:hover { color: var(--text-strong); }

.ss-preview { display: flex; justify-content: center; margin-bottom: 18px; }
.ss-preview :deep(.pc) { width: 100%; box-shadow: none; }

.ss-label {
  display: block; font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3); margin-bottom: 8px;
}
.ss-input {
  width: 100%; background: var(--bg-input); border: 1px solid rgba(0,0,0,.4);
  border-radius: 6px; padding: 12px 12px; color: var(--text-1); font: inherit; font-size: 15px;
}
.ss-input:focus { outline: none; border-color: var(--accent); }
.ss-count { font-size: 11px; color: var(--text-3); text-align: right; margin-top: 6px; font-variant-numeric: tabular-nums; }

.ss-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
.ss-row-l { font-size: 13px; color: var(--text-2); }
.ss-select { width: auto; padding: 8px 12px; font-size: 14px; cursor: pointer; }
.ss-hint { font-size: 12px; color: var(--text-3); margin-top: 8px; }

.ss-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.ss-btn { font-size: 14px; font-weight: 500; padding: 8px 16px; border-radius: 6px; color: var(--text-strong); background: var(--hover-strong); }
.ss-btn:hover { background: rgba(255,255,255,.16); }
.ss-btn.primary { background: var(--accent); }
.ss-btn.primary:hover { background: var(--accent-hover); }
.ss-btn.primary:disabled { opacity: .6; cursor: not-allowed; }
.ss-btn.ghost { background: none; color: var(--text-2); }
.ss-btn.ghost:hover { background: var(--hover); color: var(--text-strong); }
</style>

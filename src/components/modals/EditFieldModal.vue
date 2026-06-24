<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { PhX } from '@phosphor-icons/vue'

const props = defineProps<{
  title: string
  description?: string
  saving?: boolean
  doneLabel?: string
  doneDisabled?: boolean
}>()

const emit = defineEmits<{ close: []; done: [] }>()

// Escape closes the modal, matching every other modal in the app
const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="efm-overlay" @click.self="emit('close')">
      <div class="efm-modal">
        <div class="efm-header">
          <div>
            <h3 class="efm-title">{{ title }}</h3>
            <p v-if="description" class="efm-desc">{{ description }}</p>
          </div>
          <button class="efm-x" @click="emit('close')"><PhX :size="18" weight="bold" /></button>
        </div>

        <div class="efm-body">
          <slot />
        </div>

        <div class="efm-footer">
          <button class="efm-btn" @click="emit('close')">Cancel</button>
          <button
            class="efm-btn primary"
            :disabled="saving || doneDisabled"
            @click="emit('done')"
          >{{ saving ? '...' : (doneLabel || 'Done') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.efm-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 1100; /* above SettingsModal's own overlay */
}

.efm-modal {
  width: 440px; max-width: calc(100vw - 32px);
  background: var(--bg-chat); border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0,0,0,.5);
  font-family: var(--font-ui);
}

.efm-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 20px 0;
}
.efm-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.efm-desc  { font-size: 13px; color: var(--text-2); margin-top: 4px; line-height: 1.4; }
.efm-x {
  color: var(--text-3); width: 28px; height: 28px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s; flex-shrink: 0;
}
.efm-x:hover { background: var(--hover); color: var(--text-strong); }

.efm-body { padding: 16px 20px 4px; display: flex; flex-direction: column; gap: 14px; }

.efm-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 20px; margin-top: 4px;
}
.efm-btn {
  padding: 9px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--text-strong);
  background: transparent; transition: background .12s, transform .1s;
}
.efm-btn:hover { background: var(--hover); }
.efm-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.efm-btn.primary:hover { background: var(--accent-hover); }
.efm-btn:disabled { opacity: .5; cursor: not-allowed; }
.efm-btn:disabled:hover { background: var(--accent); }

/* Shared field styles, used by whatever the parent slots in */
:deep(.efm-field-label) { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: var(--text-2); margin-bottom: 6px; display: block; }
:deep(.efm-input) {
  width: 100%; background: var(--bg-input); border: 1px solid transparent; border-radius: 4px;
  padding: 9px 10px; font-size: 14px; color: var(--text-strong); outline: none;
  font-family: inherit; transition: border-color .12s;
}
:deep(.efm-input:focus) { border-color: var(--accent); }
:deep(.efm-hint) { font-size: 12px; color: var(--text-3); margin-top: 4px; }
:deep(.efm-err)  { font-size: 12px; color: #f23f42; margin-top: 4px; }
</style>
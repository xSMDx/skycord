<script setup lang="ts">
import { X } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'

defineProps<{
  title: string
  description?: string
  saving?: boolean
  doneLabel?: string
  doneDisabled?: boolean
}>()

const emit = defineEmits<{ close: []; done: [] }>()

// Escape is ModalBase's job now -- it owns the focus trap, so focus is always
// inside the dialog and a bubbling handler always sees the key. This listener
// was on window, which also fired for modals that were merely mounted, and
// ModalBase stops the event before it gets there anyway.
</script>

<template>
  <ModalBase width="440px" :z="1100" @close="emit('close')">
    <div class="efm-modal">
        <div class="efm-header">
          <div>
            <h3 class="efm-title">{{ title }}</h3>
            <p v-if="description" class="efm-desc">{{ description }}</p>
          </div>
          <button class="efm-x" aria-label="Close" @click="emit('close')"><X :size="18" :stroke-width="2.25" /></button>
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
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

/* ModalBase owns the overlay, the box chrome and (on a phone) the sheet
   presentation. All that's left here is what's INSIDE it. */
.efm-modal { font-family: var(--font-ui); }

.efm-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 20px 0;
}
.efm-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.efm-desc  { font-size: 13px; color: var(--text-2); margin-top: 4px; line-height: 1.4; }
.efm-x {
  color: var(--text-3); width: 28px; height: 28px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); flex-shrink: 0;
}
.efm-x:hover { background: var(--hover); color: var(--text-strong); }

.efm-body { padding: 16px 20px 4px; display: flex; flex-direction: column; gap: 14px; }

.efm-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 20px; margin-top: 4px;
}
.efm-btn {
  padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--text-strong);
  background: transparent; transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
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
  padding: 8px 10px; font-size: 14px; color: var(--text-strong); outline: none;
  font-family: inherit; transition: border-color var(--dur-1) var(--ease-out);
}
:deep(.efm-input:focus) { border-color: var(--accent); }
:deep(.efm-hint) { font-size: 12px; color: var(--text-3); margin-top: 4px; }
:deep(.efm-err)  { font-size: 12px; color: #f23f42; margin-top: 4px; }
</style>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ModalBase from './ModalBase.vue'

const props = withDefaults(defineProps<{
  title:         string
  message:       string
  /** Label for the affirmative button. Defaults to 'Confirm' — pass something
   *  more specific ('Leave', 'Delete') when the generic verb reads oddly. */
  confirmLabel?: string
  /** Styles the confirm button destructively (Discord red instead of accent). */
  danger?:       boolean
  /** Disables both buttons while the caller's async action runs. */
  busy?:         boolean
}>(), {
  confirmLabel: 'Confirm',
})

const emit = defineEmits<{ confirm: []; close: [] }>()

/**
 * Which button Enter answers.
 *
 * A focused button answers Enter with a click natively, so whichever one
 * holds focus on mount is the default action. For an ordinary confirm that
 * should be the affirmative button — you opened the dialog to say yes.
 *
 * For a destructive one it must not be. The dialog exists precisely because
 * the action cannot be taken back, and a keyboard user who hits Enter out of
 * habit — or who never saw the dialog because a screen reader was still
 * announcing it — would destroy the thing the dialog was protecting. Cancel
 * takes focus instead; Confirm is still one Tab away.
 */
const confirmBtn = ref<HTMLButtonElement | null>(null)
const cancelBtn  = ref<HTMLButtonElement | null>(null)
onMounted(() => (props.danger ? cancelBtn : confirmBtn).value?.focus())
</script>

<template>
  <ModalBase width="440px" @close="emit('close')">
    <div class="cfm-modal">
      <div class="cfm-header">
        <h2 class="cfm-title">{{ title }}</h2>
      </div>

      <div class="cfm-body">
        <p class="cfm-message">{{ message }}</p>
      </div>

      <div class="cfm-footer">
        <button ref="cancelBtn" class="cfm-cancel" :disabled="busy" @click="emit('close')">Cancel</button>
        <button
          ref="confirmBtn"
          class="cfm-confirm"
          :class="{ danger }"
          :disabled="busy"
          @click="emit('confirm')"
        >{{ busy ? 'Working…' : confirmLabel }}</button>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

/* ModalBase owns the overlay, the box chrome and (on a phone) the sheet
   presentation. All that's left here is what's INSIDE it. */
.cfm-modal { display: flex; flex-direction: column; font-family: var(--font-ui); }

.cfm-header { padding: 20px 20px 0; }
.cfm-title  { font-size: 18px; font-weight: 700; color: var(--text-strong); }

.cfm-body    { padding: 16px 20px; }
.cfm-message { font-size: 14px; color: var(--text-2); line-height: 1.5; }

.cfm-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.06);
}
/* Cancel is deliberately the quieter of the two — no fill, so the confirm
   button (accent or danger) is the one that reads as the default action. */
.cfm-cancel {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-1);
  transition: background var(--dur-1) var(--ease-out);
}
.cfm-cancel:hover:not(:disabled) { background: var(--hover); }
.cfm-cancel:disabled { opacity: .5; cursor: not-allowed; }

.cfm-confirm {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.cfm-confirm:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.cfm-confirm:disabled { opacity: .5; cursor: not-allowed; }

/* Destructive action: the app's established danger red (ContextMenu, Settings'
   Log Out, ProfilePopout's Unfriend) rather than the accent — Delete/Leave
   Server should not look like a routine confirm. */
.cfm-confirm.danger { background: #ed4245; }
.cfm-confirm.danger:hover:not(:disabled) { background: #c73e3e; }
</style>

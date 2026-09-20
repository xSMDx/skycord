<script setup lang="ts">
/**
 * A host's legal document, opened from the sign-up sentence or the line under
 * the sign-in card. Settings reads documents inside its own pane instead
 * (LegalPage.vue): a modal over the Settings modal breaks both.
 */
import { X } from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import LegalDocumentView from './LegalDocumentView.vue'
import { LEGAL_TITLES, formatUpdated, type DocumentEntry } from '@/composables/legalDocs'
import { fetchLegalDocument } from '@/composables/useInstance'

const props = defineProps<{ entry: DocumentEntry; instanceName: string }>()
const emit = defineEmits<{ close: [] }>()

const load = () => fetchLegalDocument(props.entry.href)
</script>

<template>
  <ModalBase width="720px" @close="emit('close')">
    <div class="ldm">
      <header class="ldm-head">
        <div class="ldm-titles">
          <h2 class="ldm-title">{{ LEGAL_TITLES[entry.kind] }}</h2>
          <p class="ldm-meta">{{ instanceName }} · Last updated {{ formatUpdated(entry.updated) }}</p>
        </div>
        <button type="button" class="ldm-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2" />
        </button>
      </header>
      <div class="ldm-body">
        <LegalDocumentView :load="load" format="markdown" />
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.ldm { display: flex; flex-direction: column; max-height: min(80vh, 760px); }
.ldm-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 18px 20px 12px; border-bottom: 1px solid var(--divider);
}
.ldm-titles { flex: 1; min-width: 0; }
.ldm-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-strong); }
.ldm-meta { margin: 4px 0 0; font-size: 12.5px; color: var(--text-3); }
.ldm-close {
  flex: none; width: 32px; height: 32px; border-radius: 6px; border: none; background: none;
  display: flex; align-items: center; justify-content: center; color: var(--icon); cursor: pointer;
}
.ldm-close:hover { background: var(--hover); color: var(--text-strong); }
.ldm-body { padding: 14px 20px 20px; overflow-y: auto; }
</style>

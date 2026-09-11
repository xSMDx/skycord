<script setup lang="ts">
/**
 * Search on a phone: a screen of its own. The chat header's row is a back
 * button, a two-line title and three 44px actions — there is no room there for
 * a usable field, and a squeezed one is worse than none. The field's popup
 * sits in the page under it; the results take its place once a search runs.
 */
import { ref, onMounted } from 'vue'
import { ChevronLeft } from 'lucide-vue-next'
import SearchField from './SearchField.vue'
import SearchResultsPanel from './SearchResultsPanel.vue'
import { useSearch, type SearchHit } from '@/composables/useSearch'
import type { SuggestMember, SuggestChannel } from '@/composables/searchSuggest'

defineProps<{
  placeholder: string
  members: SuggestMember[]
  channels: SuggestChannel[]
  activeId: string | null
}>()
const emit = defineEmits<{ close: []; open: [hit: SearchHit]; moreFilters: [] }>()

const { open } = useSearch()
const field = ref<InstanceType<typeof SearchField> | null>(null)

// Coming back to results you already have shows them; arriving fresh puts the
// cursor in the field with the keyboard up.
onMounted(() => { if (!open.value) field.value?.focus() })

/** A search just ran: put the keyboard away so the results can be seen. */
const settle = () => (document.activeElement as HTMLElement | null)?.blur()
</script>

<template>
  <div class="ss" role="dialog" aria-modal="true" aria-label="Search">
    <header class="ss-head">
      <button type="button" class="ss-back" aria-label="Close search" @click="emit('close')">
        <ChevronLeft :size="22" :stroke-width="2.25" aria-hidden="true" />
      </button>
      <SearchField
        ref="field" class="ss-field" inline
        :placeholder="placeholder" :members="members" :channels="channels"
        @more-filters="emit('moreFilters')" @submitted="settle"
      />
    </header>
    <SearchResultsPanel
      v-if="open && !field?.popupOpen" screen
      :channels="channels" :active-id="activeId" @open="h => emit('open', h)"
    />
  </div>
</template>

<style scoped>
.ss {
  position: fixed; inset: 0; z-index: 900;
  display: flex; flex-direction: column;
  padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-chat);
  animation: ss-in var(--dur-3) var(--ease-out);
}
@keyframes ss-in { from { opacity: 0; transform: translateX(16px); } }
.ss-head { flex: none; display: flex; align-items: flex-start; gap: 4px; padding: 8px 12px 8px 4px; }
.ss-back {
  width: 44px; height: 44px; flex: none; margin-top: -2px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; border-radius: 50%; color: var(--text-2); cursor: pointer;
}
.ss-back:active { background: var(--press-veil); }
.ss-field { flex: 1; min-width: 0; }
</style>

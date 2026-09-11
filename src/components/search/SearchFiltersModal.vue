<script setup lang="ts">
/**
 * More filters: every filter at once, laid out as the reference lays them. It
 * edits a copy of the search's filters — Apply writes the copy back and runs
 * the search, Cancel throws it away. Words typed in the header field are kept.
 */
import { ref, computed } from 'vue'
import { X, Plus, Trash2, ChevronDown } from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import SearchPicker from './SearchPicker.vue'
import { useSearch } from '@/composables/useSearch'
import { useSearchHistory } from '@/composables/useSearchHistory'
import { HAS_TYPES, isEmpty, type SearchChip } from '@/composables/searchQuery'
import type { SuggestMember, SuggestChannel, PickerOption } from '@/composables/searchSuggest'

const props = defineProps<{ members: SuggestMember[]; channels: SuggestChannel[] }>()
const emit  = defineEmits<{ close: [] }>()

const search  = useSearch()
const history = useSearchHistory()
const shell   = ref<InstanceType<typeof ModalBase> | null>(null)
/** Close through the shell, so the dialog plays its exit instead of vanishing. */
const dismiss = () => shell.value?.requestClose()

const isServer = computed(() => search.scope.value?.kind === 'server')
const valuesOf = (kind: SearchChip['kind']) =>
  search.query.value.chips.filter(c => c.kind === kind).map(c => c.value)

const from     = ref(valuesOf('from'))
const inIds    = ref(valuesOf('in'))
const has      = ref(valuesOf('has'))
const mentions = ref(valuesOf('mentions'))
const pinned   = ref(valuesOf('pinned')[0] ?? '')

type DateOp = 'before' | 'after' | 'during'
interface DateRow { id: number; op: DateOp; day: string }
const OPS: { op: DateOp; label: string }[] = [
  { op: 'before', label: 'Before' },
  { op: 'after',  label: 'After' },
  { op: 'during', label: 'On' },
]
let rowSeq = 0
const dates = ref<DateRow[]>(
  search.query.value.chips
    .filter((c): c is SearchChip & { kind: DateOp } => c.kind === 'before' || c.kind === 'after' || c.kind === 'during')
    .map(c => ({ id: rowSeq++, op: c.kind, day: c.value })),
)

/** "On" is a whole day by itself, so it is the only date row; Before and After make a range, one of each. */
const opAllowed = (op: DateOp, row: number) => {
  const others = dates.value.filter((_, i) => i !== row)
  return op === 'during' ? !others.length : !others.some(o => o.op === op || o.op === 'during')
}
const nextOp  = computed(() => OPS.find(o => opAllowed(o.op, -1))?.op)
const addDate = () => { if (nextOp.value) dates.value.push({ id: rowSeq++, op: nextOp.value, day: '' }) }

const memberOpts = computed<PickerOption[]>(() => props.members.map(m => ({
  value: m.id, label: m.name, sub: m.username || undefined, avatar: m.avatar ?? undefined, crop: m.crop ?? null,
})))
const channelOpts = computed<PickerOption[]>(() => props.channels.map(c => ({ value: c.id, label: `#${c.name}` })))
const hasOpts: PickerOption[] = HAS_TYPES.map(h => ({ value: h.value, label: h.label, soon: h.soon }))

const memberName  = (id: string) => props.members.find(m => m.id === id)?.name ?? id
const channelName = (id: string) => props.channels.find(c => c.id === id)?.name ?? id
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const clearAll = () => {
  from.value = []; inIds.value = []; has.value = []; mentions.value = []
  pinned.value = ''; dates.value = []
}

const apply = () => {
  const chips: SearchChip[] = [
    ...from.value.map(v => ({ kind: 'from' as const, value: v, label: memberName(v) })),
    ...(isServer.value ? inIds.value.map(v => ({ kind: 'in' as const, value: v, label: channelName(v) })) : []),
    ...has.value.map(v => ({ kind: 'has' as const, value: v, label: v })),
    ...mentions.value.map(v => ({ kind: 'mentions' as const, value: v, label: memberName(v) })),
    ...dates.value.filter(d => d.day).map(d => ({ kind: d.op, value: d.day, label: dayLabel(d.day) })),
    ...(pinned.value ? [{ kind: 'pinned' as const, value: pinned.value, label: pinned.value }] : []),
  ]
  const q = { text: search.query.value.text, chips }
  search.query.value = q
  if (search.scope.value && !isEmpty(q)) {
    history.remember(search.scope.value, q)
    void search.run()
  } else {
    search.close()
  }
  dismiss()
}
</script>

<template>
  <ModalBase ref="shell" width="520px" @close="emit('close')">
    <div class="smf">
      <header class="smf-head">
        <h2 class="smf-title">More filters</h2>
        <button type="button" class="smf-close" aria-label="Close" @click="dismiss">
          <X :size="18" :stroke-width="2.25" aria-hidden="true" />
        </button>
      </header>

      <div class="smf-body">
        <SearchPicker
          v-model="from" label="From" hint="Sent by any of these people"
          placeholder="Pick people" :options="memberOpts"
        />
        <SearchPicker
          v-if="isServer" v-model="inIds" label="In" hint="Sent in any of these channels"
          placeholder="Pick channels" :options="channelOpts"
        />
        <SearchPicker
          v-model="has" label="Has" hint="Includes any of these kinds of content"
          placeholder="Any content" :options="hasOpts"
        />
        <SearchPicker
          v-model="mentions" label="Mentions" hint="Mentions any of these people"
          placeholder="Pick people" :options="memberOpts"
        />

        <div class="smf-field" role="group" aria-labelledby="smf-date">
          <span id="smf-date" class="smf-label">Date</span>
          <p class="smf-hint">When the message was sent, by your own clock</p>
          <div v-for="(d, i) in dates" :key="d.id" class="smf-date">
            <span class="smf-select smf-op">
              <select v-model="d.op" class="smf-input" :aria-label="`Date filter ${i + 1}`">
                <option v-for="o in OPS" :key="o.op" :value="o.op" :disabled="!opAllowed(o.op, i)">{{ o.label }}</option>
              </select>
              <ChevronDown class="smf-chev" :size="16" :stroke-width="2.25" aria-hidden="true" />
            </span>
            <input v-model="d.day" type="date" class="smf-input smf-day" :aria-label="`Date ${i + 1}`" />
            <button type="button" class="smf-icon" :aria-label="`Remove date filter ${i + 1}`" @click="dates.splice(i, 1)">
              <Trash2 :size="16" :stroke-width="2.25" aria-hidden="true" />
            </button>
          </div>
          <button v-if="nextOp" type="button" class="smf-add" @click="addDate">
            <Plus :size="16" :stroke-width="2.25" aria-hidden="true" />
            <span>Add date</span>
          </button>
        </div>

        <div class="smf-field">
          <label class="smf-label" for="smf-author">Author Type <span class="smf-soon">Soon</span></label>
          <p class="smf-hint">Skycord has no bots or webhooks yet, so every message is from a person.</p>
          <span class="smf-select">
            <select id="smf-author" class="smf-input" disabled><option>ex. Bot</option></select>
            <ChevronDown class="smf-chev" :size="16" :stroke-width="2.25" aria-hidden="true" />
          </span>
        </div>

        <div class="smf-field">
          <label class="smf-label" for="smf-pinned">Pinned</label>
          <p class="smf-hint">Whether the message is pinned in its channel</p>
          <span class="smf-select">
            <select id="smf-pinned" v-model="pinned" class="smf-input">
              <option value="">Either</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
            <ChevronDown class="smf-chev" :size="16" :stroke-width="2.25" aria-hidden="true" />
          </span>
        </div>
      </div>

      <footer class="smf-foot">
        <button type="button" class="smf-clear" @click="clearAll">Clear Filters</button>
        <button type="button" class="smf-btn" @click="dismiss">Cancel</button>
        <button type="button" class="smf-btn primary" @click="apply">Apply Filters</button>
      </footer>
    </div>
  </ModalBase>
</template>

<style scoped>
.smf { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; font-family: var(--font-ui); }
.smf-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 22px 10px; }
.smf-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-strong); }
.smf-close {
  width: 30px; height: 30px; flex: none; margin-right: -6px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.smf-close:hover { background: var(--hover); color: var(--text-strong); }

.smf-body {
  flex: 1; min-height: 0; overflow: hidden auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 20px; padding: 6px 22px 22px;
}
.smf-field { display: flex; flex-direction: column; }
.smf-label {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2);
}
.smf-hint { margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: var(--text-3); }
.smf-soon {
  font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm);
  background: var(--hover-strong); color: var(--text-3);
}

.smf-input {
  width: 100%; height: 40px; padding: 0 12px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md);
  font: inherit; font-size: 14px; outline: none;
  color-scheme: dark;
  transition: border-color var(--dur-2) var(--ease-out);
}
/* The native date picker and select lists follow the theme's light or dark. */
[data-theme^="light"] .smf-input { color-scheme: light; }
.smf-input:focus { border-color: var(--accent); }
.smf-input:focus-visible { outline: none; }
.smf-input:disabled { color: var(--text-faint); cursor: not-allowed; }
/* The pickers' chevron, not the browser's arrow, so every dropdown here reads as one kind. */
.smf-select { position: relative; display: block; }
.smf-select select { appearance: none; padding-right: 36px; cursor: pointer; }
.smf-select select:disabled { cursor: not-allowed; }
.smf-chev { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-3); }

.smf-date { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.smf-op { width: 116px; flex: none; }
.smf-day { flex: 1; min-width: 0; }
.smf-icon {
  width: 36px; height: 36px; flex: none; border-radius: var(--edge-md);
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.smf-icon:hover { background: var(--hover); color: var(--text-strong); }
.smf-add {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; height: 40px; border: none; border-radius: var(--edge-md); cursor: pointer;
  background: var(--bg-input); color: var(--text-1); font: inherit; font-size: 14px; font-weight: 600;
  transition: background var(--dur-1) var(--ease-out);
}
.smf-add:hover { background: var(--hover-strong); }

.smf-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 22px; border-top: 1px solid var(--divider);
}
.smf-clear {
  margin-right: auto; padding: 9px 0;
  background: none; border: none; cursor: pointer;
  font: inherit; font-size: 14px; font-weight: 600; color: var(--text-2);
  transition: color var(--dur-1) var(--ease-out);
}
.smf-clear:hover { color: var(--text-strong); text-decoration: underline; }
.smf-btn {
  padding: 9px 18px; border-radius: var(--edge-md);
  background: none; border: none; cursor: pointer;
  font: inherit; font-size: 14px; font-weight: 600; color: var(--text-1);
  transition: background var(--dur-1) var(--ease-out);
}
.smf-btn:hover { background: var(--hover); }
.smf-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.smf-btn.primary:hover { background: var(--accent-hover); }
.smf-btn:active, .smf-add:active, .smf-icon:active { box-shadow: inset 0 0 0 100vmax var(--press-veil); }
</style>

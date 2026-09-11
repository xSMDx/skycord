<script setup lang="ts">
/**
 * One multi-select in More filters: what is chosen, as chips; a field that
 * narrows the list; and the list itself, floating under the field. Floating,
 * not in the flow: a list that pushed the fields below it down would pull them
 * back up as it closed on blur — under the pointer, between press and release
 * — and a click meant for "Add date" would land on nothing. The dialog's body
 * scrolls, and a floating list inside it still extends what the body can
 * scroll to, so the last picker's list is never cut off.
 */
import { ref, computed, watch } from 'vue'
import { X, ChevronDown, Check } from 'lucide-vue-next'
import type { PickerOption } from '@/composables/searchSuggest'

const props = defineProps<{
  label: string
  hint: string
  placeholder: string
  options: PickerOption[]
  modelValue: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()

const root   = ref<HTMLElement | null>(null)
const input  = ref<HTMLInputElement | null>(null)
const open   = ref(false)
const q      = ref('')
const active = ref(-1)
const uid = `sp-${Math.random().toString(36).slice(2, 8)}`

const byValue = computed(() => new Map(props.options.map(o => [o.value, o])))
const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return props.options
  return props.options.filter(o => o.label.toLowerCase().includes(s) || !!o.sub?.toLowerCase().includes(s))
})
const picked  = (v: string) => props.modelValue.includes(v)
const labelOf = (v: string) => byValue.value.get(v)?.label ?? v

watch(list, () => { active.value = -1 })

const toggle = (o: PickerOption) => {
  if (o.soon) return
  emit('update:modelValue', picked(o.value) ? props.modelValue.filter(v => v !== o.value) : [...props.modelValue, o.value])
  q.value = ''
  input.value?.focus()
}
const remove = (v: string) => emit('update:modelValue', props.modelValue.filter(x => x !== v))

/** Step over the options, skipping the ones marked Soon. */
const move = (step: 1 | -1) => {
  const l = list.value
  let i = active.value < 0 ? (step > 0 ? -1 : l.length) : active.value
  for (let n = 0; n < l.length; n++) {
    i = (i + step + l.length) % l.length
    if (!l[i].soon) { active.value = i; return }
  }
}

const onKey = (e: KeyboardEvent) => {
  if (e.isComposing) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    open.value = true
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'Enter') {
    const o = open.value ? list.value[active.value] : undefined
    if (o) { e.preventDefault(); toggle(o) }
  } else if (e.key === 'Escape' && open.value) {
    // The list closes first; the dialog closes on the Escape after that.
    e.stopPropagation()
    open.value = false
  } else if (e.key === 'Backspace' && !q.value && props.modelValue.length) {
    remove(props.modelValue[props.modelValue.length - 1])
  }
}
const onFocusOut = (e: FocusEvent) => {
  if (!root.value?.contains(e.relatedTarget as Node | null)) open.value = false
}
</script>

<template>
  <div ref="root" class="sp" @focusout="onFocusOut">
    <label class="sp-label" :for="uid">{{ label }}</label>
    <p class="sp-hint">{{ hint }}</p>
    <div class="sp-anchor">
      <div class="sp-box" @click="input?.focus()">
        <span v-for="v in modelValue" :key="v" class="sp-chip">
          <span class="sp-chip-label">{{ labelOf(v) }}</span>
          <button type="button" class="sp-chip-x" :aria-label="`Remove ${labelOf(v)}`" @click.stop="remove(v)">
            <X :size="12" :stroke-width="2.5" aria-hidden="true" />
          </button>
        </span>
        <input
          :id="uid" ref="input" v-model="q" class="sp-input" type="text"
          role="combobox" aria-autocomplete="list" autocomplete="off" spellcheck="false"
          :aria-expanded="open" :aria-controls="`${uid}-list`"
          :aria-activedescendant="open && active >= 0 ? `${uid}-o${active}` : undefined"
          :placeholder="modelValue.length ? '' : placeholder"
          @focus="open = true" @input="open = true" @keydown="onKey"
        />
        <ChevronDown class="sp-chev" :class="{ up: open }" :size="16" :stroke-width="2.25" aria-hidden="true" />
      </div>
      <ul
        v-if="open" :id="`${uid}-list`" class="sp-list" role="listbox"
        :aria-label="label" aria-multiselectable="true" @mousedown.prevent
      >
        <li
          v-for="(o, i) in list" :id="`${uid}-o${i}`" :key="o.value" role="option" class="sp-opt"
          :class="{ on: i === active, soon: o.soon, picked: picked(o.value) }"
          :aria-selected="picked(o.value)" :aria-disabled="o.soon || undefined"
          @mousemove="!o.soon && (active = i)" @click="toggle(o)"
        >
          <span v-if="o.avatar" class="sp-av"><Avatar :src="o.avatar" alt="" :crop="o.crop ?? null" /></span>
          <span class="sp-opt-label">{{ o.label }}</span>
          <span v-if="o.sub" class="sp-opt-sub">{{ o.sub }}</span>
          <span v-if="o.soon" class="sp-soon">Soon</span>
          <Check v-else-if="picked(o.value)" class="sp-check" :size="16" :stroke-width="2.5" aria-hidden="true" />
        </li>
        <li v-if="!list.length" class="sp-empty" role="presentation">No matches</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; }
.sp-label {
  display: block; margin-bottom: 4px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2);
}
.sp-hint { margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: var(--text-3); }

.sp-box {
  position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  min-height: 40px; padding: 5px 36px 5px 8px;
  background: var(--bg-input); border: 1px solid transparent; border-radius: var(--edge-md);
  cursor: text; transition: border-color var(--dur-2) var(--ease-out);
}
.sp-box:focus-within { border-color: var(--accent); }
.sp-input {
  flex: 1; min-width: 96px; height: 28px; padding: 0 4px;
  background: none; border: none; outline: none;
  color: var(--text-1); font: inherit; font-size: 14px;
}
.sp-input:focus-visible { outline: none; }
.sp-input::placeholder { color: var(--text-faint); }
.sp-chev {
  position: absolute; right: 12px; top: 11px; pointer-events: none;
  color: var(--text-3); transition: transform var(--dur-2) var(--ease-out);
}
.sp-chev.up { transform: rotate(180deg); }

.sp-chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 100%;
  height: 26px; padding: 0 2px 0 8px; border-radius: var(--edge-sm);
  background: var(--hover-strong); color: var(--text-1); font-size: 13px; font-weight: 500;
}
.sp-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-chip-x {
  display: flex; padding: 3px; border: none; border-radius: var(--edge-sm);
  background: none; color: var(--text-3); cursor: pointer;
  transition: color var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.sp-chip-x:hover { color: var(--text-strong); background: var(--hover); }

.sp-anchor { position: relative; }
/* A layer over the fields below, so it wears the menu elevation. */
.sp-list {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 5;
  list-style: none; margin: 0; padding: 4px;
  max-height: 216px; overflow: hidden auto; overscroll-behavior: contain;
  background: var(--bg-floor); border: 1px solid var(--border); border-radius: var(--edge-md);
  box-shadow: 0 8px 28px rgba(0,0,0,.55);
  animation: sp-in var(--dur-2) var(--ease-out);
}
@keyframes sp-in { from { opacity: 0; transform: translateY(-2px); } }
.sp-opt {
  display: flex; align-items: center; gap: 10px;
  min-height: 36px; padding: 6px 8px; border-radius: var(--edge-sm);
  color: var(--text-2); font-size: 14px; cursor: pointer; user-select: none;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.sp-opt.on { background: var(--hover-strong); color: var(--text-strong); }
.sp-opt.picked { color: var(--text-strong); }
.sp-opt:not(.soon):active { box-shadow: inset 0 0 0 100vmax var(--press-veil); }
.sp-opt.soon { color: var(--text-faint); cursor: default; }
.sp-av { display: flex; width: 20px; height: 20px; flex: none; }
.sp-opt-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.sp-opt-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-3); }
.sp-soon {
  margin-left: auto; flex: none;
  font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm);
  background: var(--hover-strong); color: var(--text-3);
}
.sp-check { margin-left: auto; flex: none; color: var(--accent); }
.sp-empty { padding: 8px; font-size: 13px; color: var(--text-3); }
</style>

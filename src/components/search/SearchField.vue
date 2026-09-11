<script setup lang="ts">
/**
 * The search field in the chat header, and the popup under it.
 *
 * Built to the user's reference — Discord's search — in this app's own
 * materials. Focus shows Filters and History; a trailing `from:`, `in:`,
 * `has:` or `mentions:` turns the popup into suggestions for that filter; a
 * chosen suggestion becomes a chip. It all goes through useSearch, so the
 * results panel and the phone screen are views of the same search.
 */
import { ref, computed, nextTick, watch } from 'vue'
import {
  Search, X, User, Hash, Paperclip, AtSign, SlidersHorizontal, Trash2, Clock,
  Image as ImageIcon, Video, Link as LinkIcon, File as FileIcon, LayoutTemplate,
  Volume2, ListChecks, Sticker, Forward,
} from 'lucide-vue-next'
import { useSearch } from '@/composables/useSearch'
import { useSearchHistory } from '@/composables/useSearchHistory'
import {
  tokenAtEnd, withoutTokenAtEnd, addChip, isEmpty,
  type SearchChip, type FilterKey,
} from '@/composables/searchQuery'
import {
  filterRows, suggestMembers, suggestChannels, suggestHas,
  type SuggestMember, type SuggestChannel, type FilterRow,
} from '@/composables/searchSuggest'

const props = defineProps<{
  placeholder: string
  members: SuggestMember[]
  channels: SuggestChannel[]
  /** Phone: full width, and the popup sits in the flow under the field. */
  inline?: boolean
}>()
const emit = defineEmits<{ moreFilters: []; submitted: [] }>()

const search  = useSearch()
const history = useSearchHistory()
const { query, scope } = search

const root     = ref<HTMLElement | null>(null)
const input    = ref<HTMLInputElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
/** The chip row has scrolled past its start; that edge fades so a cut-off chip reads as scrolled, not broken. */
const clipped  = ref(false)
const onChipScroll = () => { clipped.value = (scroller.value?.scrollLeft ?? 0) > 2 }
const focused  = ref(false)
/** Held shut by Escape or a search just run, until the next keystroke or click. */
const quiet    = ref(false)
const active   = ref(-1)
/**
 * Keeps the popup shut when focus comes back from More filters: the dialog
 * hands focus back to this field as it closes, and a popup opening over the
 * results just asked for is the last thing wanted.
 */
let holdClosed = false
const uid = `sf-${Math.random().toString(36).slice(2, 8)}`

const text = computed({
  get: () => query.value.text,
  set: (v: string) => { query.value = { ...query.value, text: v } },
})
const filled = computed(() => !isEmpty(query.value))
const token  = computed(() => tokenAtEnd(query.value.text))

const FILTER_ICON = { from: User, in: Hash, has: Paperclip, mentions: AtSign, more: SlidersHorizontal } as const
const HAS_ICON: Record<string, unknown> = {
  image: ImageIcon, video: Video, link: LinkIcon, file: FileIcon, embed: LayoutTemplate,
  sound: Volume2, poll: ListChecks, sticker: Sticker, forward: Forward,
}
const HEADING: Record<FilterKey, string> = {
  from: 'From User', mentions: 'Mentions User', in: 'In Channel', has: 'Message Contains',
}

type Option =
  | { type: 'filter'; row: FilterRow }
  | { type: 'member'; key: 'from' | 'mentions'; member: SuggestMember }
  | { type: 'channel'; channel: SuggestChannel }
  | { type: 'has'; value: string; soon: boolean }
  | { type: 'history'; label: string; index: number }
type HistoryOption = Extract<Option, { type: 'history' }>

const chosen = (kind: SearchChip['kind']) =>
  new Set(query.value.chips.filter(c => c.kind === kind).map(c => c.value))

/** The first list: Filters, or the suggestions for the filter being typed. */
const main = computed<Option[]>(() => {
  const t = token.value
  if (t && (t.key === 'from' || t.key === 'mentions')) {
    const key = t.key
    return suggestMembers(props.members, t.partial, chosen(key)).map(member => ({ type: 'member' as const, key, member }))
  }
  if (t?.key === 'in') {
    return suggestChannels(props.channels, t.partial, chosen('in')).map(channel => ({ type: 'channel' as const, channel }))
  }
  if (t?.key === 'has') {
    return suggestHas(t.partial, chosen('has')).map(h => ({ type: 'has' as const, value: h.value, soon: !!h.soon }))
  }
  return filterRows(scope.value?.kind ?? 'server').map(row => ({ type: 'filter' as const, row }))
})

/** The second list: recent searches here, only while nothing has been typed. */
const past = computed<HistoryOption[]>(() => {
  if (filled.value || !scope.value) return []
  return history.entries(scope.value).map((e, index) => ({ type: 'history' as const, label: e.label, index }))
})

const options   = computed<Option[]>(() => [...main.value, ...past.value])
const heading   = computed(() => (token.value ? HEADING[token.value.key] : 'Filters'))
const popupOpen = computed(() => focused.value && !quiet.value)
const isSoon    = (o: Option) => o.type === 'has' && o.soon
const optId     = (i: number) => `${uid}-o${i}`
const keyOf     = (o: Option) =>
  o.type === 'filter' ? `f:${o.row.key}` : o.type === 'member' ? `m:${o.member.id}`
  : o.type === 'channel' ? `c:${o.channel.id}` : o.type === 'has' ? `x:${o.value}` : `h:${o.index}`

// While a filter is being typed, Enter takes the top suggestion, the way the
// reference works. Otherwise nothing is highlighted and Enter runs the search.
watch(options, list => { active.value = token.value ? list.findIndex(o => !isSoon(o)) : -1 })
watch(active, i => {
  if (i >= 0) nextTick(() => document.getElementById(optId(i))?.scrollIntoView({ block: 'nearest' }))
})

/** Step over the options, skipping the ones marked Soon. */
const move = (step: 1 | -1) => {
  const list = options.value
  let i = active.value < 0 ? (step > 0 ? -1 : list.length) : active.value
  for (let n = 0; n < list.length; n++) {
    i = (i + step + list.length) % list.length
    if (!isSoon(list[i])) { active.value = i; return }
  }
}

const focusInput = () => nextTick(() => input.value?.focus())

const pickChip = (chip: SearchChip) => {
  const next = addChip(query.value, chip)
  const rest = withoutTokenAtEnd(next.text)
  query.value = { ...next, text: rest ? `${rest} ` : '' }
  nextTick(() => { const s = scroller.value; if (s) s.scrollLeft = s.scrollWidth })
}

const choose = (o: Option) => {
  if (isSoon(o)) return
  switch (o.type) {
    case 'filter': {
      if (o.row.key === 'more') { holdClosed = true; emit('moreFilters'); return }
      const t = text.value
      text.value = `${t && !/\s$/.test(t) ? `${t} ` : t}${o.row.key}:`
      break
    }
    case 'member':  pickChip({ kind: o.key, value: o.member.id, label: o.member.name }); break
    case 'channel': pickChip({ kind: 'in', value: o.channel.id, label: o.channel.name }); break
    case 'has':     pickChip({ kind: 'has', value: o.value, label: o.value }); break
    case 'history': {
      const entry = scope.value ? history.entries(scope.value)[o.index] : undefined
      if (!entry) return
      query.value = JSON.parse(JSON.stringify(entry.query))
      submit()
      return
    }
  }
  focusInput()
}

const submit = () => {
  if (!filled.value || !scope.value) return
  history.remember(scope.value, query.value)
  quiet.value = true
  void search.run()
  emit('submitted')
}

const clearAll = () => {
  query.value = { chips: [], text: '' }
  search.close()
  quiet.value = false
  focusInput()
}

const removeChip = (i: number) => {
  query.value = { ...query.value, chips: query.value.chips.filter((_, j) => j !== i) }
  focusInput()
}

const clearHistory = () => {
  if (scope.value) history.clear(scope.value)
  focusInput()
}

const onKey = (e: KeyboardEvent) => {
  if (e.isComposing) return
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); quiet.value = false; move(1); break
    case 'ArrowUp':   e.preventDefault(); quiet.value = false; move(-1); break
    case 'Enter': {
      e.preventDefault()
      const o = popupOpen.value ? options.value[active.value] : undefined
      if (o) choose(o)
      else submit()
      break
    }
    case 'Escape':
      // First Escape shuts the popup; the next clears the search and its results.
      e.stopPropagation()
      if (popupOpen.value) quiet.value = true
      else if (filled.value || search.open.value) clearAll()
      else input.value?.blur()
      break
    case 'Backspace':
      if (!query.value.text && query.value.chips.length) {
        e.preventDefault()
        removeChip(query.value.chips.length - 1)
      }
      break
  }
}

const onFocusIn = () => {
  if (!focused.value) { quiet.value = holdClosed; holdClosed = false }
  focused.value = true
}
const onFocusOut = (e: FocusEvent) => {
  if (!root.value?.contains(e.relatedTarget as Node | null)) focused.value = false
}
const onPointerDown = () => { holdClosed = false; quiet.value = false }

defineExpose({ focus: () => input.value?.focus(), popupOpen })
</script>

<template>
  <div ref="root" class="sf" :class="{ focused, filled, inline }" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="sf-box" @pointerdown="onPointerDown" @click="input?.focus()">
      <div ref="scroller" class="sf-scroll" :class="{ clipped }" @scroll="onChipScroll">
        <span v-for="(c, i) in query.chips" :key="`${c.kind}:${c.value}`" class="sf-chip">
          <span class="sf-chip-key">{{ c.kind }}:</span>
          <span class="sf-chip-val">{{ c.label }}</span>
          <button
            type="button" class="sf-chip-x" tabindex="-1" :aria-label="`Remove ${c.kind}: ${c.label}`"
            @mousedown.prevent @click.stop="removeChip(i)"
          >
            <X :size="12" :stroke-width="2.5" aria-hidden="true" />
          </button>
        </span>
        <input
          ref="input" v-model="text" class="sf-input" type="text"
          role="combobox" aria-autocomplete="list" autocomplete="off" spellcheck="false" enterkeyhint="search"
          :aria-label="placeholder" :placeholder="query.chips.length ? '' : placeholder"
          :aria-expanded="popupOpen" :aria-controls="`${uid}-l1 ${uid}-l2`"
          :aria-activedescendant="popupOpen && active >= 0 ? optId(active) : undefined"
          @keydown="onKey" @input="quiet = false"
        />
      </div>
      <button
        v-if="filled" type="button" class="sf-end sf-clear" aria-label="Clear search"
        @mousedown.prevent @click.stop="clearAll"
      >
        <X :size="16" :stroke-width="2.25" aria-hidden="true" />
      </button>
      <Search v-else class="sf-end" :size="16" :stroke-width="2.25" aria-hidden="true" />
    </div>

    <Transition name="sf-pop">
      <div v-if="popupOpen" class="sf-pop" @mousedown.prevent>
        <p :id="`${uid}-h1`" class="sf-head">{{ heading }}</p>
        <ul v-if="main.length" :id="`${uid}-l1`" role="listbox" class="sf-list" :aria-labelledby="`${uid}-h1`">
          <li
            v-for="(o, i) in main" :id="optId(i)" :key="keyOf(o)" role="option" class="sf-opt"
            :class="{ on: i === active, soon: isSoon(o), tall: o.type === 'filter' }"
            :aria-selected="i === active" :aria-disabled="isSoon(o) || undefined"
            @mousemove="!isSoon(o) && (active = i)" @click="choose(o)"
          >
            <template v-if="o.type === 'filter'">
              <component :is="FILTER_ICON[o.row.key]" class="sf-ic" :size="18" :stroke-width="2" aria-hidden="true" />
              <span class="sf-text">
                <span class="sf-title">{{ o.row.title }}</span>
                <span v-if="o.row.key !== 'more'" class="sf-hint">{{ o.row.key }}: <em>{{ o.row.hint }}</em></span>
                <span v-else class="sf-hint">{{ o.row.hint }}</span>
              </span>
            </template>
            <template v-else-if="o.type === 'member'">
              <span class="sf-av"><Avatar :src="o.member.avatar ?? ''" alt="" :crop="o.member.crop ?? null" /></span>
              <span class="sf-title sf-ellipsis">{{ o.member.name }}</span>
              <span v-if="o.member.username" class="sf-sub sf-ellipsis">{{ o.member.username }}</span>
            </template>
            <template v-else-if="o.type === 'channel'">
              <Hash class="sf-ic" :size="16" :stroke-width="2.25" aria-hidden="true" />
              <span class="sf-title sf-ellipsis">{{ o.channel.name }}</span>
            </template>
            <template v-else-if="o.type === 'has'">
              <component :is="HAS_ICON[o.value]" class="sf-ic" :size="16" :stroke-width="2.25" aria-hidden="true" />
              <span class="sf-title">{{ o.value }}</span>
              <span v-if="o.soon" class="sf-soon">Soon</span>
            </template>
          </li>
        </ul>
        <p v-else class="sf-empty">No matches</p>

        <template v-if="past.length">
          <div class="sf-head sf-head-row">
            <span :id="`${uid}-h2`">History</span>
            <button type="button" class="sf-bin" aria-label="Clear search history" @click="clearHistory">
              <Trash2 :size="14" :stroke-width="2.25" aria-hidden="true" />
            </button>
          </div>
          <ul :id="`${uid}-l2`" role="listbox" class="sf-list" :aria-labelledby="`${uid}-h2`">
            <li
              v-for="(o, j) in past" :id="optId(main.length + j)" :key="keyOf(o)" role="option" class="sf-opt"
              :class="{ on: main.length + j === active }" :aria-selected="main.length + j === active"
              @mousemove="active = main.length + j" @click="choose(o)"
            >
              <Clock class="sf-ic" :size="16" :stroke-width="2.25" aria-hidden="true" />
              <span class="sf-title sf-ellipsis">{{ o.label }}</span>
            </li>
          </ul>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Allowed to give up width in a crowded header, so its clear button never ends up under the results panel. */
.sf { position: relative; min-width: 0; font-family: var(--font-ui); }

/* ── The field ───────────────────────────────────────────────────────────
   Grows when it is in use, as the reference's does: at rest it only has to
   say "search is here", and the header has other things to hold. */
.sf-box {
  display: flex; align-items: center; gap: 2px;
  width: 200px; max-width: 100%; height: 30px; padding: 0 7px 0 3px;
  background: var(--bg-input); border: 1px solid transparent; border-radius: var(--edge-md);
  cursor: text;
  transition: border-color var(--dur-2) var(--ease-out), width var(--dur-3) var(--ease-out);
}
.sf.focused .sf-box, .sf.filled .sf-box { width: 280px; }
.sf.focused .sf-box { border-color: var(--accent); }
.sf-scroll {
  flex: 1; min-width: 0; height: 100%;
  display: flex; align-items: center; gap: 4px; padding-left: 4px;
  overflow-x: auto; scrollbar-width: none;
}
.sf-scroll::-webkit-scrollbar { display: none; }
.sf-scroll.clipped {
  -webkit-mask-image: linear-gradient(to right, transparent, black 16px);
  mask-image: linear-gradient(to right, transparent, black 16px);
}
.sf-input {
  flex: 1; min-width: 48px; height: 100%; padding: 0;
  background: none; border: none; outline: none;
  color: var(--text-1); font: inherit; font-size: 14px; text-overflow: ellipsis;
}
/* The box's accent border is the focus signal; a second ring inside it is noise. */
.sf-input:focus-visible { outline: none; }
.sf-input::placeholder { color: var(--text-faint); }
.sf-end { flex: none; color: var(--text-3); }
.sf-clear {
  display: flex; padding: 2px; margin-right: -2px;
  background: none; border: none; border-radius: var(--edge-sm); cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.sf-clear:hover { color: var(--text-strong); }

.sf-chip {
  display: inline-flex; align-items: center; gap: 2px; flex: none;
  height: 22px; padding: 0 2px 0 6px; border-radius: var(--edge-sm);
  background: var(--mention-bg); color: var(--accent-text);
  font-size: 13px; line-height: 1; white-space: nowrap;
}
.sf-chip-key { font-weight: 700; }
.sf-chip-val { max-width: 120px; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.sf-chip-x {
  display: flex; padding: 2px; border: none; border-radius: var(--edge-sm);
  background: none; color: inherit; cursor: pointer; opacity: .7;
  transition: opacity var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.sf-chip-x:hover { opacity: 1; background: var(--hover); }

/* ── The popup ───────────────────────────────────────────────────────────
   Wider than the field and hung from its right edge, where the reference
   hangs it. Menu elevation from DESIGN.md. */
.sf-pop {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 200;
  width: min(400px, calc(100vw - 24px)); max-height: min(70vh, 560px);
  overflow: hidden auto; overscroll-behavior: contain;
  padding: 4px 8px 8px; border-radius: var(--edge-lg);
  background: var(--bg-floor); border: 1px solid var(--border);
  box-shadow: 0 8px 28px rgba(0,0,0,.55);
  transform-origin: top right;
}
.sf-pop-enter-active { transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out); }
.sf-pop-leave-active { transition: opacity var(--dur-exit) var(--ease-in), transform var(--dur-exit) var(--ease-in); }
.sf-pop-enter-from, .sf-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(.98); }

.sf-head {
  margin: 0; padding: 10px 8px 6px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2);
}
.sf-head-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 6px; padding-right: 2px; border-top: 1px solid var(--divider);
}
.sf-bin {
  display: flex; padding: 4px; border: none; border-radius: var(--edge-sm);
  background: none; color: var(--text-3); cursor: pointer;
  transition: color var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.sf-bin:hover { color: var(--text-strong); background: var(--hover); }

.sf-list { list-style: none; margin: 0; padding: 0; }
.sf-opt {
  display: flex; align-items: center; gap: 10px;
  min-height: 34px; padding: 6px 8px; border-radius: var(--edge-md);
  color: var(--text-2); cursor: pointer; user-select: none;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.sf-opt.tall { min-height: 48px; gap: 12px; }
.sf-opt.on { background: var(--hover-strong); color: var(--text-strong); }
.sf-opt:not(.soon):active { box-shadow: inset 0 0 0 100vmax var(--press-veil); }
.sf-opt.soon { cursor: default; color: var(--text-faint); }
.sf-ic { flex: none; color: var(--text-3); transition: color var(--dur-1) var(--ease-out); }
.sf-opt.on .sf-ic { color: var(--text-strong); }
.sf-opt.soon .sf-ic { color: var(--text-faint); }
.sf-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sf-title { font-size: 14px; font-weight: 600; color: inherit; }
.sf-hint { font-size: 12px; color: var(--text-3); }
.sf-hint em {
  font-style: normal; padding: 0 4px; border-radius: var(--edge-sm);
  background: var(--mention-bg); color: var(--accent-text);
}
.sf-sub { font-size: 12px; color: var(--text-3); }
.sf-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sf-av { display: flex; width: 24px; height: 24px; flex: none; }
.sf-soon {
  margin-left: auto;
  font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm);
  background: var(--hover-strong); color: var(--text-3);
}
.sf-empty { margin: 0; padding: 6px 8px 10px; font-size: 13px; color: var(--text-3); }

/* ── Phone ───────────────────────────────────────────────────────────────
   The field owns its own screen there, so it is full width, touch-sized,
   and the popup is part of the page rather than a layer over it. 16px text
   stops iOS zooming the page when the field takes focus. */
.sf.inline .sf-box, .sf.inline.focused .sf-box, .sf.inline.filled .sf-box { width: 100%; height: 40px; }
.sf.inline .sf-input { font-size: 16px; }
.sf.inline .sf-pop {
  position: static; width: auto; max-height: calc(100dvh - 76px); margin-top: 8px; padding: 0;
  background: none; border: none; box-shadow: none;
}
.sf.inline .sf-pop-enter-from, .sf.inline .sf-pop-leave-to { transform: none; }
.sf.inline .sf-opt { min-height: 44px; }
.sf.inline .sf-opt.tall { min-height: 52px; }
</style>

# Message Search B2 — The Search UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The search people actually use: a permanent "Search …" field in the chat header with the Filters / History popup and per-filter suggestions from the user's reference screenshots, a More filters dialog, a results panel on the right, and a full-screen search on phones — all on top of plan B1's API and `useSearch`.

**Architecture:** Two pure helpers (`searchHighlight.ts`, `searchSuggest.ts`) carry the logic that can be unit-tested. Four components carry the UI: `SearchField` (field, chips, popup, keyboard), `SearchPicker` (the multi-select the dialog repeats), `SearchFiltersModal`, `SearchResultsPanel`; `SearchScreen` wraps the field and the panel for phones. ChatApp swaps its placeholder for them, keeps the search scope in step with the conversation, and opens a result through Part 1's `jumpToMessage`.

**Tech Stack:** Vue 3 `<script setup>`, lucide-vue-next, the app's tokens (`src/styles/tokens.css`, DESIGN.md), Vitest, Playwright MCP.

## Global Constraints

- No commits unless the user asks.
- The look is the user's reference (Discord's search) rendered in this app's own tokens. Operate mode: inherit the established world; DESIGN.md unchanged.
- DESIGN.md rules that bind every component here: `--dur-3` for popovers, `--dur-exit` exits, `--ease-out`; menu shadow `0 8px 28px rgba(0,0,0,.55)`; lucide at `:size="16" :stroke-width="2.25"`; inputs are a transparent border that becomes `--accent` on focus; one accent button per surface; round 30px close top-right in dialogs; Soon badges use the Badge pattern; empty states are plain text; no hex values in components; no placeholder as the only label; no tooltip to explain a control.
- Filter rows, copy verbatim from the reference: "From a specific user / from: user", "Sent in a specific channel / in: channel" (servers only), "Includes a specific type of data / has: link, embed or file", "Mentions a specific user / mentions: user", "More filters / dates, author type, and more", section headings "Filters" and "History"; suggestion headings "From User", "In Channel", "Message Contains", "Mentions User".
- `has:` lists all nine types; `file`, `sound`, `poll`, `sticker`, `forward` render with a Soon badge and cannot be chosen. Author Type renders, disabled, with Soon.
- Results panel is 360px, replacing the member list while open (the member list is 234px — too narrow for a result — and returns when search closes).

---

### Task 1: Pure helpers — highlighting and suggestions

**Files:**
- Create: `src/composables/searchHighlight.ts`, `src/composables/searchSuggest.ts`
- Test: `src/composables/__tests__/searchHighlight.test.ts`, `src/composables/__tests__/searchSuggest.test.ts`

**Interfaces:**
- Produces: `highlightTerms(q: string): string[]`, `highlightHtml(html: string, terms: string[]): string`; `SuggestMember { id; name; username; avatar? }`, `SuggestChannel { id; name }`, `SUGGEST_LIMIT = 10`, `suggestMembers(members, partial, exclude?)`, `suggestChannels(channels, partial, exclude?)`, `suggestHas(partial, exclude?)`, `FilterRow { key: 'from' | 'in' | 'has' | 'mentions' | 'more'; title; hint }`, `filterRows(kind: 'server' | 'group' | 'dm'): FilterRow[]`.

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/searchHighlight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { highlightTerms, highlightHtml } from '../searchHighlight'

describe('highlightTerms', () => {
  it('keeps words and phrases, drops exclusions and quotes', () => {
    expect(highlightTerms('plan "next week" -draft')).toEqual(['plan', 'next week'])
  })
})

describe('highlightHtml', () => {
  it('marks a word regardless of case', () => {
    expect(highlightHtml('The Plan is set', ['plan'])).toBe('The <mark class="sr-hit">Plan</mark> is set')
  })
  it('never touches tags or attributes', () => {
    const html = '<a href="https://x.io/plan" class="msg-link">see plan</a>'
    expect(highlightHtml(html, ['plan'])).toBe('<a href="https://x.io/plan" class="msg-link">see <mark class="sr-hit">plan</mark></a>')
  })
  it('prefers the longer phrase where both match', () => {
    expect(highlightHtml('next week plan', ['next', 'next week'])).toBe('<mark class="sr-hit">next week</mark> plan')
  })
  it('matches characters that were escaped when rendered, and never splits an entity', () => {
    expect(highlightHtml('a &lt;b&gt; c', ['<b>'])).toBe('a <mark class="sr-hit">&lt;b&gt;</mark> c')
    expect(highlightHtml('fish &amp; chips', ['amp'])).toBe('fish &amp; chips')
  })
  it('leaves the HTML alone with nothing to mark', () => {
    expect(highlightHtml('<b>x</b>', [])).toBe('<b>x</b>')
  })
})
```

`src/composables/__tests__/searchSuggest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { suggestMembers, suggestChannels, suggestHas, filterRows, SUGGEST_LIMIT } from '../searchSuggest'

const people = [
  { id: 'u1', name: 'Arta', username: 'arta_' },
  { id: 'u2', name: 'Bob', username: 'robert' },
  { id: 'u3', name: 'Gh', username: 'dr.gh' },
]

describe('suggestMembers', () => {
  it('matches a display name or a username, starts-with first', () => {
    expect(suggestMembers(people, 'r').map(p => p.id)).toEqual(['u2', 'u1'])
    expect(suggestMembers(people, 'gh').map(p => p.id)).toEqual(['u3'])
  })
  it('lists everyone for an empty partial, capped', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, username: `m${i}` }))
    expect(suggestMembers(many, '')).toHaveLength(SUGGEST_LIMIT)
  })
  it('leaves out anyone already chosen', () => {
    expect(suggestMembers(people, '', new Set(['u1'])).map(p => p.id)).toEqual(['u2', 'u3'])
  })
})

describe('suggestChannels', () => {
  it('matches by name, starts-with first', () => {
    const ch = [{ id: 'c1', name: 'music-commands' }, { id: 'c2', name: 'general-chat' }, { id: 'c3', name: 'mudae' }]
    expect(suggestChannels(ch, 'mu').map(c => c.id)).toEqual(['c1', 'c3'])
    expect(suggestChannels(ch, 'chat').map(c => c.id)).toEqual(['c2'])
  })
})

describe('suggestHas', () => {
  it('lists the nine types, filtered by what is typed, without the chosen ones', () => {
    expect(suggestHas('').map(h => h.value)).toHaveLength(9)
    expect(suggestHas('s').map(h => h.value)).toEqual(['sound', 'sticker'])
    expect(suggestHas('', new Set(['image'])).map(h => h.value)).not.toContain('image')
  })
})

describe('filterRows', () => {
  it('offers in: only in a server', () => {
    expect(filterRows('server').map(r => r.key)).toEqual(['from', 'in', 'has', 'mentions', 'more'])
    expect(filterRows('dm').map(r => r.key)).toEqual(['from', 'has', 'mentions', 'more'])
  })
  it('uses the reference wording', () => {
    expect(filterRows('server')[1]).toEqual({ key: 'in', title: 'Sent in a specific channel', hint: 'in: channel' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/composables/__tests__/searchHighlight.test.ts src/composables/__tests__/searchSuggest.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

> **As built:** the highlight code below went through two drafts that the shipped version replaced. `src/composables/searchHighlight.ts` reads each run of text between tags as units — single characters and whole entities, each entity counted as the character it stands for — matches the raw terms against that, and rebuilds the run. An entity can never be split, whatever else matches. `FilterRow.hint` holds only the placeholder word (`'channel'`), and the field renders `in: <em>channel</em>`; the tests match that.

`src/composables/searchHighlight.ts`:

```ts
/**
 * Mark the searched words inside a message's rendered HTML.
 *
 * Works on renderMessage's output and touches only the text between tags, so
 * a word inside a link's href or an emoji's alt is never split and no markup
 * can be injected. Entities are skipped whole: "amp" must not cut `&amp;` in
 * two. Matching ignores case; it does not fold accents, so a search for
 * "cafe" finds "Café" (the server folds them) without marking it.
 */
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words and phrases a query asks for — never the ones it excludes. */
export const highlightTerms = (q: string): string[] => {
  const out: string[] = []
  for (const m of q.matchAll(/(-?)"([^"]*)"|(-?)(\S+)/g)) {
    if (m[1] || m[3]) continue
    const t = (m[2] ?? m[4] ?? '').replace(/"/g, '').trim()
    if (t) out.push(t)
  }
  return out
}

export const highlightHtml = (html: string, terms: string[]): string => {
  const usable = terms.map(t => t.trim()).filter(Boolean)
  if (!usable.length) return html
  // Longest first, so "next week" wins over "next" where both match.
  const pattern = usable.map(t => escapeRe(escapeHtml(t))).sort((a, b) => b.length - a.length).join('|')
  const re = new RegExp(pattern, 'gi')
  return html
    .split(/(<[^>]*>)/)
    .map(part => part.startsWith('<')
      ? part
      : part.split(/(&[#a-z0-9]+;)/i).map(bit => /^&[#a-z0-9]+;$/i.test(bit) && !re.test(bit)
          ? bit
          : bit.replace(re, m => `<mark class="sr-hit">${m}</mark>`)).join(''))
    .join('')
}
```

Note the entity rule: a lone entity is left whole unless the entity itself is (part of) a term — which is exactly the `&lt;b&gt;` case. Because `re` is global, reset it before each `test` call:

```ts
      : part.split(/(&[#a-z0-9]+;)/i).map(bit => {
          if (/^&[#a-z0-9]+;$/i.test(bit)) { re.lastIndex = 0; if (!re.test(bit)) return bit }
          re.lastIndex = 0
          return bit.replace(re, m => `<mark class="sr-hit">${m}</mark>`)
        }).join(''))
```

(use this second form in the file; it replaces the one-line `.map` above).

For `&lt;b&gt;`: the text part is `a &lt;b&gt; c`, split on entities gives `a `, `&lt;`, `b`, `&gt;`, ` c` — a term spanning entities is matched on the unsplit part first. Implement by trying the whole part before splitting:

```ts
const markPart = (part: string, re: RegExp): string => {
  // A term that contains an entity (a searched "<b>") matches the part whole.
  const spansEntity = (m: string) => /&[#a-z0-9]+;/i.test(m)
  let whole = false
  part.replace(re, m => { if (spansEntity(m)) whole = true; return m })
  if (whole) return part.replace(re, m => `<mark class="sr-hit">${m}</mark>`)
  return part.split(/(&[#a-z0-9]+;)/i)
    .map(bit => /^&[#a-z0-9]+;$/i.test(bit) ? bit : bit.replace(re, m => `<mark class="sr-hit">${m}</mark>`))
    .join('')
}
```

and `highlightHtml` maps text parts through `markPart(part, re)`. This final form is the implementation; the two earlier fragments are superseded by it.

`src/composables/searchSuggest.ts`:

```ts
import { HAS_TYPES, type HasType } from './searchQuery'

export interface SuggestMember  { id: string; name: string; username: string; avatar?: string | null }
export interface SuggestChannel { id: string; name: string }
export const SUGGEST_LIMIT = 10

const lc = (s: string) => s.toLowerCase()

/** Matches first by whether the name starts with what was typed, then in order. */
const rank = <T>(items: T[], partial: string, keys: (t: T) => string[]): T[] => {
  const p = lc(partial)
  const hits = p ? items.filter(t => keys(t).some(k => lc(k).includes(p))) : items
  const starts = (t: T) => keys(t).some(k => lc(k).startsWith(p))
  return [...hits].sort((a, b) => Number(!starts(a)) - Number(!starts(b))).slice(0, SUGGEST_LIMIT)
}

export const suggestMembers = (members: SuggestMember[], partial: string, exclude: Set<string> = new Set()) =>
  rank(members.filter(m => !exclude.has(m.id)), partial, m => [m.name, m.username])

export const suggestChannels = (channels: SuggestChannel[], partial: string, exclude: Set<string> = new Set()) =>
  rank(channels.filter(c => !exclude.has(c.id)), partial, c => [c.name])

export const suggestHas = (partial: string, exclude: Set<string> = new Set()): HasType[] =>
  HAS_TYPES.filter(h => !exclude.has(h.value) && h.value.startsWith(lc(partial)))

export interface FilterRow { key: 'from' | 'in' | 'has' | 'mentions' | 'more'; title: string; hint: string }

/** The Filters list, in the reference's order and words. `in:` needs channels. */
export const filterRows = (kind: 'server' | 'group' | 'dm'): FilterRow[] => [
  { key: 'from', title: 'From a specific user', hint: 'from: user' },
  ...(kind === 'server' ? [{ key: 'in' as const, title: 'Sent in a specific channel', hint: 'in: channel' }] : []),
  { key: 'has', title: 'Includes a specific type of data', hint: 'has: link, embed or file' },
  { key: 'mentions', title: 'Mentions a specific user', hint: 'mentions: user' },
  { key: 'more', title: 'More filters', hint: 'dates, author type, and more' },
]
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/composables/__tests__/searchHighlight.test.ts src/composables/__tests__/searchSuggest.test.ts`
Expected: PASS.

---

### Task 2: `SearchField` — the header field, chips and popup

**Files:**
- Create: `src/components/search/SearchField.vue`

**Interfaces:**
- Consumes: `useSearch`, `useSearchHistory`, `searchQuery` (B1); Task 1.
- Produces: props `placeholder: string`, `members: SuggestMember[]`, `channels: SuggestChannel[]`, `inline?: boolean` (phone: popup in flow, full width); emits `moreFilters`, `submitted`; exposes `focus()`.

Behaviour contract (the component implements exactly this):

- Focus opens the popup. Empty field: **Filters** rows, then **History** (this scope, newest first, bin button clears). Typing words keeps the Filters rows and hides History.
- A trailing `from:` / `mentions:` / `in:` / `has:` switches the popup to that token's suggestions under its heading; `has:` shows all nine, Soon ones badged and skipped by the keyboard.
- Choosing a Filters row appends its `key:` to the text and keeps focus. Choosing a suggestion adds a chip and removes the token. Choosing History restores that search and runs it. "More filters" emits `moreFilters`.
- Keys: ↑/↓ move over choosable options, Enter picks the highlighted one or runs the search, Escape closes the popup (a second Escape clears the search and closes results), Backspace on an empty caret removes the last chip.
- Running a search remembers it in History, closes the popup, calls `useSearch().run()`, emits `submitted`.
- Chips show `key: label` with a small × (`aria-label="Remove from: Arta"`). A filled field shows a clear × instead of the magnifier.
- ARIA: the input is `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant`; options are `role="option"`; Soon options are `aria-disabled="true"`. The input has an `aria-label` equal to the placeholder, so the placeholder is never the only name.

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
/**
 * The search field in the chat header, and the popup under it.
 *
 * Built to the user's reference — Discord's search — in this app's own
 * materials. Everything it does goes through useSearch, so the results panel
 * and the phone screen stay three views of one search.
 */
import { ref, computed, nextTick, watch } from 'vue'
import {
  Search, X, User, Hash, Paperclip, AtSign, SlidersHorizontal, Trash2, Clock,
  Image, Video, Link, File, LayoutTemplate, Volume2, ListChecks, Sticker, Forward,
} from 'lucide-vue-next'
import { useSearch } from '@/composables/useSearch'
import { useSearchHistory } from '@/composables/useSearchHistory'
import { tokenAtEnd, withoutTokenAtEnd, addChip, isEmpty, type SearchChip, type FilterKey } from '@/composables/searchQuery'
import {
  filterRows, suggestMembers, suggestChannels, suggestHas,
  type SuggestMember, type SuggestChannel, type FilterRow,
} from '@/composables/searchSuggest'

const props = defineProps<{
  placeholder: string
  members: SuggestMember[]
  channels: SuggestChannel[]
  /** Phone: the popup sits in the flow under the field, full width. */
  inline?: boolean
}>()
const emit = defineEmits<{ moreFilters: []; submitted: [] }>()

const search  = useSearch()
const history = useSearchHistory()
const { query, scope } = search

const input   = ref<HTMLInputElement | null>(null)
const root    = ref<HTMLElement | null>(null)
const focused = ref(false)
/** Closed by Escape or a submitted search until the next keystroke. */
const quiet   = ref(false)
const active  = ref(-1)
const uid = `sf-${Math.random().toString(36).slice(2, 8)}`

const text = computed({
  get: () => query.value.text,
  set: (v: string) => { query.value = { ...query.value, text: v } },
})
const filled = computed(() => !isEmpty(query.value))
const token  = computed(() => tokenAtEnd(query.value.text))

const HAS_ICON: Record<string, unknown> = {
  image: Image, video: Video, link: Link, file: File, embed: LayoutTemplate,
  sound: Volume2, poll: ListChecks, sticker: Sticker, forward: Forward,
}
const FILTER_ICON: Record<FilterRow['key'], unknown> = {
  from: User, in: Hash, has: Paperclip, mentions: AtSign, more: SlidersHorizontal,
}
const HEADING: Record<FilterKey, string> = {
  from: 'From User', mentions: 'Mentions User', in: 'In Channel', has: 'Message Contains',
}

type Option =
  | { type: 'filter'; row: FilterRow }
  | { type: 'history'; label: string; index: number }
  | { type: 'member'; key: 'from' | 'mentions'; member: SuggestMember }
  | { type: 'channel'; channel: SuggestChannel }
  | { type: 'has'; value: string; soon: boolean }

const chosen = (kind: SearchChip['kind']) =>
  new Set(query.value.chips.filter(c => c.kind === kind).map(c => c.value))

const historyEntries = computed(() => (scope.value ? history.entries(scope.value) : []))

const options = computed<Option[]>(() => {
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
  const rows = filterRows(scope.value?.kind ?? 'server').map(row => ({ type: 'filter' as const, row }))
  const past = filled.value ? [] : historyEntries.value.map((e, index) => ({ type: 'history' as const, label: e.label, index }))
  return [...rows, ...past]
})

const heading   = computed(() => (token.value ? HEADING[token.value.key] : 'Filters'))
const popupOpen = computed(() => focused.value && !quiet.value)
const soon      = (o: Option) => o.type === 'has' && o.soon

watch(options, () => { active.value = -1 })

const move = (step: 1 | -1) => {
  const list = options.value
  if (!list.length) return
  let i = active.value
  for (let n = 0; n < list.length; n++) {
    i = (i + step + list.length) % list.length
    if (!soon(list[i])) { active.value = i; return }
  }
}

const focusInput = () => nextTick(() => input.value?.focus())

const addChipDroppingToken = (chip: SearchChip) => {
  const next = addChip(query.value, chip)
  query.value = { ...next, text: withoutTokenAtEnd(next.text) }
}

const choose = (o: Option) => {
  if (soon(o)) return
  if (o.type === 'filter') {
    if (o.row.key === 'more') { focused.value = false; emit('moreFilters'); return }
    const t = query.value.text
    text.value = `${t && !/\s$/.test(t) ? `${t} ` : t}${o.row.key}:`
  } else if (o.type === 'history') {
    const entry = historyEntries.value[o.index]
    if (!entry) return
    query.value = JSON.parse(JSON.stringify(entry.query))
    submit()
    return
  } else if (o.type === 'member') {
    addChipDroppingToken({ kind: o.key, value: o.member.id, label: o.member.name })
  } else if (o.type === 'channel') {
    addChipDroppingToken({ kind: 'in', value: o.channel.id, label: o.channel.name })
  } else {
    addChipDroppingToken({ kind: 'has', value: o.value, label: o.value })
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
  focusInput()
}

const removeChip = (i: number) => {
  query.value = { ...query.value, chips: query.value.chips.filter((_, j) => j !== i) }
  focusInput()
}

const clearHistory = () => { if (scope.value) history.clear(scope.value) }

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); quiet.value = false; move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); quiet.value = false; move(-1) }
  else if (e.key === 'Enter') {
    e.preventDefault()
    const o = options.value[active.value]
    if (popupOpen.value && o) choose(o)
    else submit()
  } else if (e.key === 'Escape') {
    if (popupOpen.value) quiet.value = true
    else clearAll()
  } else if (e.key === 'Backspace' && !query.value.text && query.value.chips.length) {
    e.preventDefault()
    removeChip(query.value.chips.length - 1)
  }
}

const onFocusOut = (e: FocusEvent) => {
  if (!root.value?.contains(e.relatedTarget as Node | null)) { focused.value = false; quiet.value = false }
}

const optionKey = (o: Option, i: number) =>
  o.type === 'filter' ? `f-${o.row.key}` : o.type === 'history' ? `h-${i}`
  : o.type === 'member' ? `m-${o.member.id}` : o.type === 'channel' ? `c-${o.channel.id}` : `x-${o.value}`

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div ref="root" class="sf" :class="{ focused, inline, filled }" @focusin="focused = true" @focusout="onFocusOut">
    <div class="sf-box" @click="input?.focus()">
      <span v-for="(c, i) in query.chips" :key="c.kind + c.value" class="sf-chip">
        <span class="sf-chip-key">{{ c.kind }}:</span>
        <span class="sf-chip-val">{{ c.label }}</span>
        <button type="button" class="sf-chip-x" :aria-label="`Remove ${c.kind}: ${c.label}`"
          @mousedown.prevent @click.stop="removeChip(i)">
          <X :size="12" :stroke-width="2.5" />
        </button>
      </span>
      <input
        ref="input" v-model="text" class="sf-input" type="text"
        role="combobox" aria-autocomplete="list" autocomplete="off" spellcheck="false"
        :aria-label="placeholder" :placeholder="query.chips.length ? '' : placeholder"
        :aria-expanded="popupOpen" :aria-controls="`${uid}-list`"
        :aria-activedescendant="popupOpen && active >= 0 ? `${uid}-o${active}` : undefined"
        @keydown="onKey" @input="quiet = false"
      />
      <button v-if="filled" type="button" class="sf-icon sf-clear" aria-label="Clear search"
        @mousedown.prevent @click.stop="clearAll">
        <X :size="16" :stroke-width="2.25" />
      </button>
      <Search v-else class="sf-icon" :size="16" :stroke-width="2.25" aria-hidden="true" />
    </div>

    <Transition name="sf-pop">
      <div v-if="popupOpen" class="sf-pop" @mousedown.prevent>
        <div class="sf-head">{{ heading }}</div>
        <ul :id="`${uid}-list`" role="listbox" class="sf-list" :aria-label="heading">
          <template v-for="(o, i) in options" :key="optionKey(o, i)">
            <li v-if="o.type === 'history' && o.index === 0" role="presentation" class="sf-head sf-head-row">
              <span>History</span>
              <button type="button" class="sf-bin" tabindex="-1" aria-label="Clear search history" @click="clearHistory">
                <Trash2 :size="14" :stroke-width="2.25" />
              </button>
            </li>
            <li
              :id="`${uid}-o${i}`" role="option" class="sf-opt"
              :class="{ on: i === active, soon: soon(o), tall: o.type === 'filter' }"
              :aria-selected="i === active" :aria-disabled="soon(o) || undefined"
              @mouseenter="!soon(o) && (active = i)" @click="choose(o)"
            >
              <template v-if="o.type === 'filter'">
                <component :is="FILTER_ICON[o.row.key]" class="sf-opt-ic" :size="18" :stroke-width="2" />
                <span class="sf-opt-text">
                  <span class="sf-opt-title">{{ o.row.title }}</span>
                  <span class="sf-opt-hint">{{ o.row.hint }}</span>
                </span>
              </template>
              <template v-else-if="o.type === 'history'">
                <Clock class="sf-opt-ic" :size="16" :stroke-width="2.25" />
                <span class="sf-opt-title sf-ellipsis">{{ o.label }}</span>
              </template>
              <template v-else-if="o.type === 'member'">
                <span class="sf-av"><Avatar :src="o.member.avatar ?? ''" :alt="o.member.name" /></span>
                <span class="sf-opt-title">{{ o.member.name }}</span>
                <span class="sf-opt-sub">{{ o.member.username }}</span>
              </template>
              <template v-else-if="o.type === 'channel'">
                <Hash class="sf-opt-ic" :size="16" :stroke-width="2.25" />
                <span class="sf-opt-title sf-ellipsis">{{ o.channel.name }}</span>
              </template>
              <template v-else>
                <component :is="HAS_ICON[o.value]" class="sf-opt-ic" :size="16" :stroke-width="2.25" />
                <span class="sf-opt-title">{{ o.value }}</span>
                <span v-if="o.soon" class="sf-soon">Soon</span>
              </template>
            </li>
          </template>
          <li v-if="token && !options.length" role="presentation" class="sf-empty">No matches</li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.sf { position: relative; font-family: var(--font-ui); }
.sf-box {
  display: flex; align-items: center; gap: 4px;
  width: 244px; height: 28px; padding: 0 6px 0 8px;
  background: var(--bg-input); border: 1px solid transparent; border-radius: var(--edge-md);
  overflow: hidden; cursor: text;
  transition: border-color var(--dur-2) var(--ease-out), width var(--dur-3) var(--ease-out);
}
.sf.focused .sf-box { border-color: var(--accent); }
.sf.inline .sf-box { width: 100%; height: 36px; }
.sf-input {
  flex: 1; min-width: 40px; height: 100%;
  background: none; border: none; outline: none; color: var(--text-1); font: inherit; font-size: 14px;
}
.sf-input::placeholder { color: var(--text-faint); }
.sf-icon { flex: none; color: var(--text-3); }
.sf-clear {
  display: flex; background: none; border: none; padding: 0; cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.sf-clear:hover { color: var(--text-strong); }

.sf-chip {
  display: inline-flex; align-items: center; gap: 3px; flex: none;
  height: 20px; padding: 0 2px 0 5px; border-radius: var(--edge-sm);
  background: var(--mention-bg); color: var(--mention-fg); font-size: 12px; white-space: nowrap;
}
.sf-chip-key { font-weight: 700; }
.sf-chip-val { max-width: 96px; overflow: hidden; text-overflow: ellipsis; }
.sf-chip-x {
  display: flex; background: none; border: none; padding: 1px; cursor: pointer; border-radius: 3px;
  color: inherit; opacity: .75; transition: opacity var(--dur-1) var(--ease-out);
}
.sf-chip-x:hover { opacity: 1; }

/* The popup: wider than the field and right-aligned under it, the way the
   reference sits against the window edge. Menu elevation from DESIGN.md. */
.sf-pop {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
  width: 356px; max-height: min(70vh, 520px); overflow: hidden auto;
  padding: 8px; border-radius: var(--edge-lg);
  background: var(--bg-floor); border: 1px solid var(--border);
  box-shadow: 0 8px 28px rgba(0,0,0,.55);
}
.sf.inline .sf-pop {
  position: static; width: 100%; max-height: none; margin-top: 8px;
  box-shadow: none; background: transparent; border: none; padding: 0;
}
.sf-pop-enter-active { transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out); }
.sf-pop-leave-active { transition: opacity var(--dur-exit) var(--ease-in), transform var(--dur-exit) var(--ease-in); }
.sf-pop-enter-from, .sf-pop-leave-to { opacity: 0; transform: translateY(-4px); }

.sf-head {
  padding: 6px 8px 4px; font-size: 12px; font-weight: 700; color: var(--text-3);
}
.sf-head-row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; list-style: none; }
.sf-bin {
  display: flex; background: none; border: none; padding: 4px; cursor: pointer; border-radius: var(--edge-sm);
  color: var(--text-3); transition: color var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.sf-bin:hover { color: var(--text-strong); background: var(--hover); }
.sf-list { list-style: none; margin: 0; padding: 0; }
.sf-opt {
  display: flex; align-items: center; gap: 10px;
  min-height: 32px; padding: 6px 8px; border-radius: var(--edge-md);
  color: var(--text-2); cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.sf-opt.tall { min-height: 44px; }
.sf-opt.on { background: var(--hover-strong); color: var(--text-strong); }
.sf-opt.soon { cursor: default; color: var(--text-faint); }
.sf-opt-ic { flex: none; color: var(--text-3); }
.sf-opt.on .sf-opt-ic { color: var(--text-strong); }
.sf-opt-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.sf-opt-title { font-size: 14px; font-weight: 600; color: inherit; }
.sf-opt-hint { font-size: 12px; color: var(--text-3); }
.sf-opt-sub { font-size: 12px; color: var(--text-3); margin-left: -4px; }
.sf-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sf-av { width: 20px; height: 20px; flex: none; border-radius: 50%; overflow: hidden; }
.sf-soon {
  margin-left: auto; font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm);
  background: rgba(var(--accent-rgb), .18); color: var(--accent-text);
}
.sf-empty { padding: 10px 8px; font-size: 13px; color: var(--text-3); list-style: none; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → PASS.

---

### Task 3: `SearchPicker` and `SearchFiltersModal` — More filters

**Files:**
- Create: `src/components/search/SearchPicker.vue`, `src/components/search/SearchFiltersModal.vue`

**Interfaces:**
- Produces: `SearchPicker` props `label`, `hint`, `placeholder`, `options: PickerOption[]` (`{ value; label; sub?; avatar?; soon? }`), `modelValue: string[]`; emits `update:modelValue`. `SearchFiltersModal` props `members: SuggestMember[]`, `channels: SuggestChannel[]`; emits `close`. Apply writes the dialog's chips into `useSearch().query` (words kept) and runs the search.

- [ ] **Step 1: `SearchPicker.vue`**

```vue
<script setup lang="ts">
/**
 * One multi-select in More filters: chosen values as chips, a field to narrow
 * the list, the list itself inline under it — the same inline pattern as the
 * Private-channel access list, so a dialog field never grows a floating layer
 * that the dialog's own scroll would clip.
 */
import { ref, computed } from 'vue'
import { X, ChevronDown } from 'lucide-vue-next'

export interface PickerOption { value: string; label: string; sub?: string; avatar?: string | null; soon?: boolean }

const props = defineProps<{
  label: string
  hint: string
  placeholder: string
  options: PickerOption[]
  modelValue: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()

const open  = ref(false)
const q     = ref('')
const uid   = `sp-${Math.random().toString(36).slice(2, 8)}`
const byVal = computed(() => new Map(props.options.map(o => [o.value, o])))
const list  = computed(() => {
  const s = q.value.trim().toLowerCase()
  return props.options.filter(o => !s || o.label.toLowerCase().includes(s) || (o.sub ?? '').toLowerCase().includes(s))
})

const toggle = (o: PickerOption) => {
  if (o.soon) return
  const has = props.modelValue.includes(o.value)
  emit('update:modelValue', has ? props.modelValue.filter(v => v !== o.value) : [...props.modelValue, o.value])
  q.value = ''
}
const remove = (v: string) => emit('update:modelValue', props.modelValue.filter(x => x !== v))
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && open.value) { e.stopPropagation(); open.value = false }
  if (e.key === 'Backspace' && !q.value && props.modelValue.length) remove(props.modelValue[props.modelValue.length - 1])
}
</script>

<template>
  <div class="sp">
    <label class="sp-label" :for="uid">{{ label }}</label>
    <p class="sp-hint">{{ hint }}</p>
    <div class="sp-box" :class="{ open }" @click="open = true">
      <span v-for="v in modelValue" :key="v" class="sp-chip">
        {{ byVal.get(v)?.label ?? v }}
        <button type="button" class="sp-chip-x" :aria-label="`Remove ${byVal.get(v)?.label ?? v}`" @click.stop="remove(v)">
          <X :size="12" :stroke-width="2.5" />
        </button>
      </span>
      <input :id="uid" v-model="q" class="sp-input" :placeholder="modelValue.length ? '' : placeholder"
        autocomplete="off" @focus="open = true" @keydown="onKey" />
      <ChevronDown class="sp-chev" :class="{ up: open }" :size="16" :stroke-width="2.25" aria-hidden="true" />
    </div>
    <ul v-if="open" class="sp-list" role="listbox" :aria-label="label" aria-multiselectable="true">
      <li v-for="o in list" :key="o.value" role="option" class="sp-opt"
        :class="{ soon: o.soon, on: modelValue.includes(o.value) }"
        :aria-selected="modelValue.includes(o.value)" :aria-disabled="o.soon || undefined"
        @mousedown.prevent @click="toggle(o)">
        <span v-if="o.avatar !== undefined" class="sp-av"><Avatar :src="o.avatar ?? ''" :alt="o.label" /></span>
        <span class="sp-opt-label">{{ o.label }}</span>
        <span v-if="o.sub" class="sp-opt-sub">{{ o.sub }}</span>
        <span v-if="o.soon" class="sp-soon">Soon</span>
      </li>
      <li v-if="!list.length" class="sp-empty">No matches</li>
    </ul>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; }
.sp-label { font-size: 14px; font-weight: 700; color: var(--text-strong); }
.sp-hint  { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 2px 0 8px; }
.sp-box {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  min-height: 40px; padding: 5px 34px 5px 10px; position: relative;
  background: var(--bg-input); border: 1px solid transparent; border-radius: var(--edge-md);
  cursor: text; transition: border-color var(--dur-2) var(--ease-out);
}
.sp-box.open, .sp-box:focus-within { border-color: var(--accent); }
.sp-input { flex: 1; min-width: 80px; background: none; border: none; outline: none; color: var(--text-1); font: inherit; font-size: 14px; }
.sp-input::placeholder { color: var(--text-faint); }
.sp-chev { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-3);
  transition: transform var(--dur-2) var(--ease-out); }
.sp-chev.up { transform: translateY(-50%) rotate(180deg); }
.sp-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 8px;
  border-radius: var(--edge-sm); background: var(--hover-strong); color: var(--text-1); font-size: 13px;
}
.sp-chip-x { display: flex; background: none; border: none; padding: 2px; cursor: pointer; color: var(--text-3); }
.sp-chip-x:hover { color: var(--text-strong); }
.sp-list {
  list-style: none; margin: 6px 0 0; padding: 4px; max-height: 184px; overflow: hidden auto;
  background: var(--bg-input); border-radius: var(--edge-md);
}
.sp-opt {
  display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: var(--edge-sm);
  font-size: 14px; color: var(--text-1); cursor: pointer; transition: background var(--dur-1) var(--ease-out);
}
@media (hover: hover) { .sp-opt:not(.soon):hover { background: var(--hover); } }
.sp-opt.on { color: var(--text-strong); font-weight: 600; }
.sp-opt.soon { color: var(--text-faint); cursor: default; }
.sp-av { width: 20px; height: 20px; border-radius: 50%; overflow: hidden; flex: none; }
.sp-opt-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-opt-sub { font-size: 12px; color: var(--text-3); }
.sp-soon {
  margin-left: auto; font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm); background: rgba(var(--accent-rgb), .18); color: var(--accent-text);
}
.sp-empty { padding: 8px; font-size: 13px; color: var(--text-3); }
</style>
```

- [ ] **Step 2: `SearchFiltersModal.vue`**

```vue
<script setup lang="ts">
/**
 * More filters: every filter at once, as the reference lays them out. Edits a
 * draft of the search's chips; Apply writes the draft back and runs it, Cancel
 * throws it away. Words typed in the header field are left alone.
 */
import { ref, computed } from 'vue'
import { X, Plus, Trash2 } from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import SearchPicker, { type PickerOption } from './SearchPicker.vue'
import { useSearch } from '@/composables/useSearch'
import { useSearchHistory } from '@/composables/useSearchHistory'
import { HAS_TYPES, type SearchChip } from '@/composables/searchQuery'
import type { SuggestMember, SuggestChannel } from '@/composables/searchSuggest'

const props = defineProps<{ members: SuggestMember[]; channels: SuggestChannel[] }>()
const emit  = defineEmits<{ close: [] }>()

const search  = useSearch()
const history = useSearchHistory()
const isServer = computed(() => search.scope.value?.kind === 'server')

const pick = (kind: SearchChip['kind']) => search.query.value.chips.filter(c => c.kind === kind).map(c => c.value)
const from     = ref(pick('from'))
const inIds    = ref(pick('in'))
const has      = ref(pick('has'))
const mentions = ref(pick('mentions'))
const pinned   = ref(pick('pinned')[0] ?? '')

type DateOp = 'before' | 'after' | 'during'
interface DateRow { op: DateOp; day: string }
const dates = ref<DateRow[]>(
  search.query.value.chips.filter(c => c.kind === 'before' || c.kind === 'after' || c.kind === 'during')
    .map(c => ({ op: c.kind as DateOp, day: c.value })))
const freeOps = computed(() => (['before', 'after', 'during'] as DateOp[]).filter(op => !dates.value.some(d => d.op === op)))
const addDate = () => { const op = freeOps.value[0]; if (op) dates.value.push({ op, day: '' }) }

const memberOpts  = computed<PickerOption[]>(() => props.members.map(m => ({ value: m.id, label: m.name, sub: m.username, avatar: m.avatar ?? null })))
const channelOpts = computed<PickerOption[]>(() => props.channels.map(c => ({ value: c.id, label: `#${c.name}` })))
const hasOpts     = HAS_TYPES.map(h => ({ value: h.value, label: h.label, soon: h.soon }))

const labelOf = (list: PickerOption[], v: string) => list.find(o => o.value === v)?.label ?? v
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const clearAll = () => {
  from.value = []; inIds.value = []; has.value = []; mentions.value = []; pinned.value = ''; dates.value = []
}

const apply = () => {
  const chips: SearchChip[] = [
    ...from.value.map(v => ({ kind: 'from' as const, value: v, label: labelOf(memberOpts.value, v) })),
    ...(isServer.value ? inIds.value.map(v => ({ kind: 'in' as const, value: v, label: labelOf(channelOpts.value, v).replace(/^#/, '') })) : []),
    ...has.value.map(v => ({ kind: 'has' as const, value: v, label: v })),
    ...mentions.value.map(v => ({ kind: 'mentions' as const, value: v, label: labelOf(memberOpts.value, v) })),
    ...(pinned.value ? [{ kind: 'pinned' as const, value: pinned.value, label: pinned.value === 'true' ? 'yes' : 'no' }] : []),
    ...dates.value.filter(d => d.day).map(d => ({ kind: d.op, value: d.day, label: dayLabel(d.day) })),
  ]
  search.query.value = { text: search.query.value.text, chips }
  if (search.scope.value) history.remember(search.scope.value, search.query.value)
  void search.run()
  emit('close')
}
</script>

<template>
  <ModalBase width="480px" @close="emit('close')">
    <div class="smf">
      <header class="smf-head">
        <h2 class="smf-title">Filters</h2>
        <button type="button" class="smf-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2.25" />
        </button>
      </header>

      <div class="smf-body">
        <SearchPicker v-model="from" label="From" hint="Sent by any of the selected users"
          placeholder="Pick someone" :options="memberOpts" />
        <SearchPicker v-if="isServer" v-model="inIds" label="In" hint="Sent in any of the selected channels"
          placeholder="Pick a channel" :options="channelOpts" />
        <SearchPicker v-model="has" label="Has" hint="Includes any of the selected types of data"
          placeholder="Any content" :options="hasOpts" />
        <SearchPicker v-model="mentions" label="Mentions" hint="Mentions any of the selected users"
          placeholder="Pick someone" :options="memberOpts" />

        <section class="smf-field">
          <span class="smf-label">Date</span>
          <p class="smf-hint">When the message was sent</p>
          <div v-for="(d, i) in dates" :key="d.op" class="smf-date">
            <select v-model="d.op" class="smf-input smf-op" :aria-label="`Date filter ${i + 1}`">
              <option v-for="op in ['before', 'after', 'during']" :key="op" :value="op"
                :disabled="op !== d.op && dates.some(x => x.op === op)">
                {{ op === 'during' ? 'On' : op === 'before' ? 'Before' : 'After' }}
              </option>
            </select>
            <input v-model="d.day" type="date" class="smf-input smf-day" :aria-label="`Date ${i + 1}`" />
            <button type="button" class="smf-icon-btn" aria-label="Remove date" @click="dates.splice(i, 1)">
              <Trash2 :size="16" :stroke-width="2.25" />
            </button>
          </div>
          <button v-if="freeOps.length" type="button" class="smf-add" @click="addDate">
            <Plus :size="16" :stroke-width="2.25" /> Add date
          </button>
        </section>

        <section class="smf-field">
          <span class="smf-label">Author Type <span class="smf-soon">Soon</span></span>
          <p class="smf-hint">Skycord has no bots or webhooks yet, so every message is from a person.</p>
          <select class="smf-input" disabled aria-label="Author type"><option>Any author</option></select>
        </section>

        <section class="smf-field">
          <label class="smf-label" for="smf-pinned">Pinned</label>
          <p class="smf-hint">If the message is pinned or not</p>
          <select id="smf-pinned" v-model="pinned" class="smf-input">
            <option value="">Either</option>
            <option value="true">Pinned</option>
            <option value="false">Not pinned</option>
          </select>
        </section>
      </div>

      <footer class="smf-foot">
        <button type="button" class="smf-clear" @click="clearAll">Clear Filters</button>
        <span class="smf-spacer" />
        <button type="button" class="smf-btn" @click="emit('close')">Cancel</button>
        <button type="button" class="smf-btn primary" @click="apply">Apply Filters</button>
      </footer>
    </div>
  </ModalBase>
</template>

<style scoped>
.smf { display: flex; flex-direction: column; max-height: 80vh; font-family: var(--font-ui); }
.smf-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 8px; }
.smf-title { font-size: 20px; font-weight: 700; color: var(--text-strong); }
.smf-close {
  width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.smf-close:hover { background: var(--hover); color: var(--text-strong); }
.smf-body { flex: 1; overflow: hidden auto; padding: 8px 20px 16px; display: flex; flex-direction: column; gap: 20px; }
.smf-field { display: flex; flex-direction: column; }
.smf-label { font-size: 14px; font-weight: 700; color: var(--text-strong); display: flex; align-items: center; gap: 8px; }
.smf-hint  { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 2px 0 8px; }
.smf-soon {
  font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm); background: rgba(var(--accent-rgb), .18); color: var(--accent-text);
}
.smf-input {
  width: 100%; height: 40px; padding: 0 10px; background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md); font: inherit; font-size: 14px; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.smf-input:focus { border-color: var(--accent); }
.smf-input:disabled { color: var(--text-faint); cursor: default; }
.smf-date { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.smf-op { width: 110px; flex: none; }
.smf-day { flex: 1; color-scheme: dark; }
:root[data-theme="light"] .smf-day { color-scheme: light; }
.smf-icon-btn {
  display: flex; background: none; border: none; padding: 6px; cursor: pointer; border-radius: var(--edge-sm);
  color: var(--text-3); transition: color var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.smf-icon-btn:hover { color: var(--text-strong); background: var(--hover); }
.smf-add {
  display: flex; align-items: center; justify-content: center; gap: 6px; height: 40px;
  background: var(--bg-input); border: none; border-radius: var(--edge-md); cursor: pointer;
  color: var(--text-1); font: inherit; font-size: 14px; font-weight: 600;
  transition: background var(--dur-1) var(--ease-out);
}
.smf-add:hover { background: var(--hover-strong); }
.smf-foot {
  display: flex; align-items: center; gap: 10px; padding: 16px 20px;
  border-top: 1px solid var(--divider);
}
.smf-spacer { flex: 1; }
.smf-clear { background: none; border: none; cursor: pointer; font: inherit; font-size: 14px; color: var(--accent-text); padding: 8px 0; }
.smf-clear:hover { text-decoration: underline; }
.smf-btn {
  padding: 9px 18px; border-radius: var(--edge-md); border: none; cursor: pointer;
  background: none; color: var(--text-1); font: inherit; font-size: 14px; font-weight: 600;
  transition: background var(--dur-1) var(--ease-out);
}
.smf-btn:hover { background: var(--hover); }
.smf-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.smf-btn.primary:hover { background: var(--accent-hover); }
</style>
```

- [ ] **Step 3: Typecheck** → `npm run typecheck` PASS.

---

### Task 4: `SearchResultsPanel`

**Files:**
- Create: `src/components/search/SearchResultsPanel.vue`

**Interfaces:**
- Consumes: `useSearch`, `searchHighlight`, `renderMessage` (`src/utils/richText.ts`), `avatarFor` (`src/composables/useAvatar.ts`).
- Produces: props `channels: SuggestChannel[]`, `activeId: string | null`, `screen?: boolean` (phone: full width, no side border, no header close); emits `open: [hit: SearchHit]`, `close: []`.

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
/**
 * Search results, in the right-hand column. Each result is drawn with the
 * chat's own renderer so mentions, links and emoji look the way they do in the
 * channel, with the searched words marked. Clicking one asks ChatApp to open
 * it; the panel stays, so the next result is one click away.
 */
import { computed } from 'vue'
import { X, Hash } from 'lucide-vue-next'
import Skeleton from '@/components/ui/Skeleton.vue'
import { useSearch, type SearchHit } from '@/composables/useSearch'
import { renderMessage } from '@/utils/richText'
import { avatarFor } from '@/composables/useAvatar'
import { highlightHtml, highlightTerms } from '@/composables/searchHighlight'
import type { SuggestChannel } from '@/composables/searchSuggest'

const props = defineProps<{ channels: SuggestChannel[]; activeId: string | null; screen?: boolean }>()
const emit  = defineEmits<{ open: [hit: SearchHit]; close: [] }>()

const { results, total, hasMore, loading, error, sort, query, setSort, loadMore, run } = useSearch()

const channelName = computed(() => new Map(props.channels.map(c => [c.id, c.name])))
const terms = computed(() => highlightTerms(query.value.text))
const countLabel = computed(() => {
  const n = total.value >= 1000 ? '1,000+' : total.value.toLocaleString()
  return `${n} ${total.value === 1 ? 'Result' : 'Results'}`
})
const GIF_RE = /^https?:\/\/\S+\.gif(\?\S*)?$/i
const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
const body = (content: string) => highlightHtml(renderMessage(content), terms.value)
const idOf = (h: SearchHit) => String(h.message._id ?? h.message.id)
</script>

<template>
  <aside class="srp" :class="{ screen }" aria-label="Search results">
    <header class="srp-head">
      <span class="srp-count" aria-live="polite">{{ loading && !results.length ? 'Searching…' : countLabel }}</span>
      <div class="srp-sort" role="group" aria-label="Sort results">
        <button type="button" class="srp-tab" :aria-pressed="sort === 'newest'" @click="setSort('newest')">Newest</button>
        <button type="button" class="srp-tab" :aria-pressed="sort === 'relevant'" @click="setSort('relevant')">Most relevant</button>
      </div>
      <button v-if="!screen" type="button" class="srp-close" aria-label="Close search results" @click="emit('close')">
        <X :size="16" :stroke-width="2.25" />
      </button>
    </header>

    <div class="srp-body">
      <div v-if="loading && !results.length" class="srp-sk" role="status" aria-label="Searching">
        <div v-for="n in 4" :key="n" class="srp-sk-row">
          <Skeleton circle :h="32" />
          <div class="srp-sk-lines"><Skeleton :w="110" :h="12" /><Skeleton w="85%" :h="12" :dim="0.8" /></div>
        </div>
      </div>

      <div v-else-if="error" class="srp-empty">
        <p>{{ error }}</p>
        <button type="button" class="srp-more" @click="run()">Try again</button>
      </div>

      <p v-else-if="!results.length" class="srp-empty">
        No results{{ query.text.trim() ? ` for “${query.text.trim()}”` : '' }}.
        <template v-if="query.chips.length"> Try removing a filter.</template>
      </p>

      <ul v-else class="srp-list">
        <li v-for="hit in results" :key="idOf(hit)">
          <div v-if="hit.channelId" class="srp-chan">
            <Hash :size="14" :stroke-width="2.25" />{{ channelName.get(hit.channelId) ?? 'unknown channel' }}
          </div>
          <button type="button" class="srp-hit" :class="{ on: activeId === idOf(hit) }" @click="emit('open', hit)">
            <span class="srp-av">
              <Avatar :src="hit.message.authorAvatar || avatarFor(hit.message.authorName)" :alt="hit.message.authorName"
                :crop="(hit.message as any).authorAvatarCrop ?? null" />
            </span>
            <span class="srp-main">
              <span class="srp-meta">
                <span class="srp-author">{{ hit.message.authorName }}</span>
                <time class="srp-time" :datetime="hit.message.createdAt">{{ when(hit.message.createdAt) }}</time>
              </span>
              <img v-if="GIF_RE.test(hit.message.content.trim())" :src="hit.message.content.trim()" class="srp-gif" alt="GIF" loading="lazy" />
              <span v-else class="srp-text" v-html="body(hit.message.content)" />
            </span>
          </button>
        </li>
      </ul>

      <button v-if="hasMore && results.length" type="button" class="srp-more" :disabled="loading" @click="loadMore()">
        {{ loading ? 'Loading…' : 'Load more' }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.srp {
  width: 360px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0;
  background: var(--bg-panel); border-left: 1px solid rgba(0,0,0,.25); font-family: var(--font-ui);
}
.srp.screen { width: 100%; border-left: none; background: transparent; }
.srp-head {
  height: 48px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px;
  border-bottom: 1px solid rgba(0,0,0,.25);
}
.srp-count { font-size: 14px; font-weight: 700; color: var(--text-strong); margin-right: auto; white-space: nowrap; }
.srp-sort { display: flex; gap: 2px; padding: 2px; border-radius: var(--edge-md); background: var(--bg-input); }
.srp-tab {
  padding: 4px 8px; border: none; border-radius: var(--edge-sm); background: none; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.srp-tab[aria-pressed="true"] { background: var(--hover-strong); color: var(--text-strong); }
.srp-close {
  width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.srp-close:hover { background: var(--hover); color: var(--text-strong); }
.srp-body { flex: 1; overflow: hidden auto; padding: 8px; }
.srp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.srp-chan {
  display: flex; align-items: center; gap: 4px; padding: 2px 6px 4px;
  font-size: 12px; font-weight: 700; color: var(--text-3);
}
.srp-hit {
  display: flex; gap: 10px; width: 100%; padding: 10px; text-align: left;
  background: var(--bg-chat); border: 1px solid transparent; border-radius: var(--edge-lg);
  cursor: pointer; color: inherit; font: inherit;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
@media (hover: hover) { .srp-hit:hover { background: var(--bg-chatbar); } }
.srp-hit.on { border-color: var(--active-ring); background: var(--bg-chatbar); }
.srp-av { width: 32px; height: 32px; flex: none; border-radius: 50%; overflow: hidden; }
.srp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.srp-meta { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.srp-author { font-size: 14px; font-weight: 600; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.srp-time { font-size: 11px; color: var(--text-faint); white-space: nowrap; }
.srp-text { font-size: 14px; line-height: 1.4; color: var(--text-1); word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.srp-text :deep(.sr-hit) { background: var(--mention-all-bg); color: var(--text-strong); border-radius: 2px; padding: 0 1px; }
.srp-text :deep(.mention) { color: var(--mention-fg); background: var(--mention-bg); border-radius: 3px; padding: 0 2px; }
.srp-text :deep(.emoji) { width: 1.2em; height: 1.2em; vertical-align: -0.2em; display: inline; }
.srp-gif { max-width: 160px; max-height: 120px; border-radius: var(--edge-md); margin-top: 4px; }
.srp-empty { padding: 16px 6px; font-size: 13px; line-height: 1.5; color: var(--text-3); }
.srp-more {
  display: block; width: 100%; margin-top: 8px; padding: 9px 18px; border: none; border-radius: var(--edge-md);
  background: var(--bg-input); color: var(--text-1); cursor: pointer; font: inherit; font-size: 14px; font-weight: 600;
  transition: background var(--dur-1) var(--ease-out);
}
.srp-more:hover:not(:disabled) { background: var(--hover-strong); }
.srp-more:disabled { opacity: .6; cursor: default; }
.srp-sk { display: flex; flex-direction: column; gap: 14px; padding: 8px 4px; }
.srp-sk-row { display: flex; gap: 10px; }
.srp-sk-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
</style>
```

- [ ] **Step 2: Typecheck** → PASS.

---

### Task 5: `SearchScreen` — search on a phone

**Files:**
- Create: `src/components/search/SearchScreen.vue`

**Interfaces:**
- Produces: props `placeholder`, `members`, `channels`, `activeId`; emits `close`, `open: [hit]`, `moreFilters`.

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
/**
 * Search on a phone: its own full-screen layer, because the chat header's row
 * is a back button, a two-line title and three 44px actions — there is no room
 * for a usable field there, and a squeezed one is worse than none. The field's
 * popup sits in the flow under it; results replace the popup once a search runs.
 */
import { ref, onMounted } from 'vue'
import { ChevronLeft } from 'lucide-vue-next'
import SearchField from './SearchField.vue'
import SearchResultsPanel from './SearchResultsPanel.vue'
import { useSearch, type SearchHit } from '@/composables/useSearch'
import type { SuggestMember, SuggestChannel } from '@/composables/searchSuggest'

defineProps<{ placeholder: string; members: SuggestMember[]; channels: SuggestChannel[]; activeId: string | null }>()
const emit = defineEmits<{ close: []; open: [hit: SearchHit]; moreFilters: [] }>()

const { open } = useSearch()
const field = ref<InstanceType<typeof SearchField> | null>(null)
onMounted(() => field.value?.focus())
</script>

<template>
  <div class="ss" role="dialog" aria-modal="true" aria-label="Search">
    <header class="ss-head">
      <button type="button" class="ss-back" aria-label="Close search" @click="emit('close')">
        <ChevronLeft :size="22" :stroke-width="2.25" />
      </button>
      <SearchField ref="field" class="ss-field" inline :placeholder="placeholder" :members="members" :channels="channels"
        @more-filters="emit('moreFilters')" />
    </header>
    <SearchResultsPanel v-if="open" screen :channels="channels" :active-id="activeId" @open="h => emit('open', h)" />
  </div>
</template>

<style scoped>
.ss {
  position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column;
  background: var(--bg-chat); padding-top: env(safe-area-inset-top);
}
.ss-head { display: flex; align-items: flex-start; gap: 6px; padding: 8px 10px; }
.ss-back {
  width: 44px; height: 44px; flex: none; display: flex; align-items: center; justify-content: center;
  background: none; border: none; border-radius: 50%; color: var(--text-2); cursor: pointer;
}
.ss-field { flex: 1; min-width: 0; padding-top: 4px; }
</style>
```

- [ ] **Step 2: Typecheck** → PASS.

---

### Task 6: ChatApp — wire it in

**Files:**
- Modify: `src/views/ChatApp.vue`

**Interfaces:**
- Consumes: Tasks 2–5; `useSearch` (B1); `jumpToMessage`, `selectChannel`, `groupedChannels`, `activeMembers` (existing).

- [ ] **Step 1: Remove the placeholder.** Delete the `// Header search (placeholder …)` block (`searchOpen`, `searchFocused`, `searchQuery`, `searchInputEl`, `openSearch`, `onSearchBlur`), the `<!-- Expanding search + filters popup (placeholder) -->` template block through its closing `</div>`, and its CSS (`.ch-search`, `.ch-search-box`, `.search-box-*`, `.filters-pop-*`, `.ch-search-input*`, `.ch-search-ico`, `.ch-filters*`, `.ch-filter-row*`, `.cf-*`). Remove `User`, `Paperclip`, `AtSign`, `SlidersHorizontal` from the lucide import if nothing else uses them (typecheck says).

- [ ] **Step 2: Imports and state**

```ts
import SearchField        from '@/components/search/SearchField.vue'
import SearchFiltersModal from '@/components/search/SearchFiltersModal.vue'
import SearchResultsPanel from '@/components/search/SearchResultsPanel.vue'
import SearchScreen       from '@/components/search/SearchScreen.vue'
import { useSearch, type SearchHit } from '@/composables/useSearch'
import type { SuggestMember, SuggestChannel } from '@/composables/searchSuggest'
```

```ts
// ── Search ──────────────────────────────────────────────────────────────────
const { open: searchResultsOpen, setScope: setSearchScope, close: closeSearch } = useSearch()
const showSearchFilters = ref(false)
const showSearchScreen  = ref(false)
const searchFieldRef    = ref<InstanceType<typeof SearchField> | null>(null)
/** The result last opened, marked in the panel so you can see where you were. */
const openedResultId    = ref<string | null>(null)

/** What a search covers here: the whole server, or this one DM or group. */
const searchScope = computed(() =>
  view.value === 'server' && activeServerId.value ? { kind: 'server' as const, id: activeServerId.value }
  : view.value === 'dm' && activeDM.value         ? { kind: 'dm' as const, id: activeDM.value.id }
  : view.value === 'group' && activeGroup.value   ? { kind: 'group' as const, id: activeGroup.value.id }
  : null)
watch(searchScope, s => { setSearchScope(s); openedResultId.value = null }, { immediate: true })

const searchPlaceholder = computed(() =>
  view.value === 'server' ? `Search ${activeServer.value?.name ?? ''}`
  : view.value === 'dm' && activeDM.value ? `Search @${activeDM.value.name}`
  : view.value === 'group' && activeGroup.value ? `Search ${groupDisplayName(activeGroup.value)}`
  : 'Search')

const searchMembers = computed<SuggestMember[]>(() => {
  if (view.value === 'server') {
    return [...activeMembers.value.online, ...activeMembers.value.offline]
      .map(m => ({ id: m.id, name: m.displayName || m.username, username: m.username, avatar: m.avatar || avatarFor(m.username) }))
  }
  if (view.value === 'group' && activeGroup.value) {
    return activeGroup.value.members.map(m => ({ id: m.id, name: m.displayName || m.username, username: m.username, avatar: m.avatar || avatarFor(m.username) }))
  }
  if (view.value === 'dm' && activeDM.value && authUser.value) {
    return [
      { id: activeDM.value.id, name: activeDM.value.name, username: activeDM.value.name, avatar: activeDM.value.avatar },
      { id: authUser.value.id, name: authUser.value.displayName || authUser.value.username, username: authUser.value.username, avatar: myAvatar.value },
    ]
  }
  return []
})

/** Text channels in sidebar order — the only ones a search can look in. */
const searchChannels = computed<SuggestChannel[]>(() =>
  view.value === 'server' ? groupedChannels.value.flatMap(g => g.text).map(c => ({ id: c.id, name: c.name })) : [])

/** The header's search icon: a phone gets its own screen; a desktop focuses the field. */
const onSearchTap = () => {
  if (isMobile.value) { showDetails.value = false; showSearchScreen.value = true; return }
  searchFieldRef.value?.focus()
}

/**
 * Open a result: switch to its channel when it is elsewhere in the server, then
 * jump — Part 1's jump loads the history around a message that is not loaded.
 */
const openSearchResult = async (hit: SearchHit) => {
  const dbId = String(hit.message._id ?? hit.message.id ?? '')
  if (!dbId) return
  openedResultId.value = dbId
  showSearchScreen.value = false
  if (hit.channelId && hit.channelId !== activeChannelId.value) {
    const ch = channelsByServer.value[activeServerId.value ?? '']?.find(c => c.id === hit.channelId)
    if (!ch) { showToast('That channel is no longer here'); return }
    await selectChannel(ch)
  }
  await jumpToMessage(dbId)
}
```

Replace the old `onSearchTap` definition with this one (the phone path used to open the details screen's field; that field now hands off here too — see Step 4).

- [ ] **Step 3: Header** — where the placeholder block was, inside `.chat-header-right`:

```html
              <!-- Search: a permanent field on desktop (the reference's
                   layout), an icon that opens its own screen on a phone. -->
              <SearchField v-if="!isMobile && searchScope" ref="searchFieldRef"
                :placeholder="searchPlaceholder" :members="searchMembers" :channels="searchChannels"
                @more-filters="showSearchFilters = true" />
              <button v-else-if="searchScope" class="icon-btn icon-btn-search" v-tip="'Search'" @click.stop="onSearchTap">
                <Search :size="18" :stroke-width="1.5"/>
              </button>
```

- [ ] **Step 4: Panel, dialog, screen.** Beside the members asides, before the server one:

```html
        <!-- Search results take the member list's column while open. -->
        <SearchResultsPanel v-if="searchResultsOpen && !isMobile" :channels="searchChannels"
          :active-id="openedResultId" @open="openSearchResult" @close="closeSearch()" />
```

and add `&& !(searchResultsOpen && !isMobile)` to both members asides' `v-if` conditions. Near the other modals:

```html
    <SearchFiltersModal v-if="showSearchFilters" :members="searchMembers" :channels="searchChannels"
      @close="showSearchFilters = false" />
    <SearchScreen v-if="showSearchScreen && isMobile" :placeholder="searchPlaceholder"
      :members="searchMembers" :channels="searchChannels" :active-id="openedResultId"
      @close="showSearchScreen = false" @open="openSearchResult" @more-filters="showSearchFilters = true" />
```

On `<ConversationDetails>`, change `@search="showDetails = false; openSearch()"` to `@search="showDetails = false; showSearchScreen = true"`.

- [ ] **Step 5: Typecheck, then the client suite**

Run: `npm run typecheck` then `npx vitest run src/` → PASS.

---

### Task 7: Verification

- [ ] **Step 1:** `npx vitest run src/`, `npm run typecheck`, `npm run build` → all pass.
- [ ] **Step 2: Browser, desktop (Playwright MCP, account A, dev servers on 4173/8990).** In "Channel Test": focus the field → Filters rows and (after one search) History; type `from:` → From User list; pick → chip; type `seed 10`, Enter → results panel "N Results", the result for "history seed #10" with its words marked; click it → #alpha-text jumps around it, bar shown; Newest / Most relevant toggles; `has:` → nine types, five Soon and skipped by ↓; More filters → pick From, Pinned: Pinned, Apply → results; Escape twice clears. Screenshot the popup, the suggestions, the dialog and the panel.
- [ ] **Step 3: Browser, phone (375×812).** The icon opens the screen; search; tap a result → the chat jumps. Screenshot.
- [ ] **Step 4:** `node <impeccable>/scripts/detect.mjs --json` on the five new components and ChatApp; fix what is mechanical. The finish review runs in-thread from the degraded reviewer (no subagents without the user's say-so), disclosed in the report.

---

## As built — deviations from this plan

Recorded after implementation and browser verification (2026-09-11).

- **SearchField:**
  - The field grows from 200px to 280px while in use, as the reference's does. impeccable's detector flags the `transition: width`; it is kept on purpose, since it animates one small header element.
  - The popup holds two listboxes: Filters or suggestions, then History. The History bin button cannot sit inside a listbox, so the input's `aria-controls` names both.
  - While a filter is being typed, the top suggestion is pre-selected and Enter takes it.
  - When focus comes back from More filters, the popup stays shut (`holdClosed`).
  - A chip cut off at the start of the chip row fades.
- **SearchPicker:**
  - The list floats over the fields below it rather than sitting in the flow. In the flow, closing it on blur moved the controls under the pointer between press and release, and the "Add date" click missed (found in the browser).
  - `PickerOption` lives in `searchSuggest.ts`, because `<script setup>` cannot export it.
- **SearchFiltersModal:**
  - It is titled "More filters", after the row that opens it.
  - The selects use the pickers' lucide chevron (`appearance: none`), not the browser's arrow.
  - "On" must be the only date row; Before and After can be combined.
  - It closes through the shell's `requestClose`, which `ModalBase` now exposes, so it plays its exit.
- **SearchResultsPanel:**
  - A channel label appears above the results whenever the channel changes.
  - Each card is an `<article>` with a Jump button, not a `<button>`, because rendered messages contain links.
  - The width is `clamp(300px, 30vw, 400px)`.
- **Tokens:** `--text-link` holds the value MessageItem used to hardcode (`#00a8fc`). MessageItem and the results panel both read it.
- **ChatApp:**
  - The header field needs no ref; the phone icon is the only caller of `onSearchTap`.
  - `detailsSearching` is gone. The details screen's search field emits `search`, which opens the search screen, instead of expanding a field that searched nothing.
  - The member-list toggle closes search results and brings the members back (`membersShown`, `toggleMembers`).
  - Scope changes compare kind and id, so switching channels inside one server keeps the results.
- **Verification note:** the Playwright window is occluded on this machine, so Chromium starves it of frames. Vue transitions (which wait on rAF) and CSS animations then freeze on their first frame: a popup present at opacity 0, or a dialog that never finishes closing. Force a few frames first, for example with repeated `page.screenshot()` calls, then measure or capture.
- **Fixed after B2 — whole-word matching.** Each word used to go to MongoDB as a quoted phrase. Phrases match as substrings, and a query with several terms lets any term's word make a message a candidate, so "seed 10" also found "#110".
  - Messages now store `words` (`server/utils/searchWords.ts`). The hook keeps it current and the backfill fills old messages.
  - `$text` still finds and ranks the candidates; `words` requires every word whole.
  - The highlighter marks the same whole words, and a parity test keeps its tokenizer identical to the server's.

# Menus and the settings shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menus can carry named sections, the server dropdown is sectioned with them, and Settings lists only the pages that exist.

**Architecture:** The menu model gains a fourth item kind, `MenuSection`, beside separators, sliders and actions. `ContextMenu.vue` groups the flat item list into labelled `role="group"` blocks through one pure helper, so the keyboard logic keeps using flat indices and nothing about positioning, focus or submenus changes. Settings drops its six "Soon" rows and the placeholder page they led to, under the owner's reversal of the badge-don't-hide directive for Settings.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest in the node environment (no DOM — components are covered through pure helpers and, where unavoidable, by reading their source).

## Global Constraints

Inherited from [the slice index](./2026-09-12-ui-audit-00-slices.md#global-constraints--every-slice). The ones that bite here:

- **Muscle memory is binding.** Menu rows keep their order and their actions. Sections add labels; they never move a row.
- **Only tokens** in any rule touched. No hex, no raw `rgba()`.
- **Five themes plus Material-You.** The section label is measured against `--bg-floor` in every theme family.
- **AA is the floor.** Normal text 4.5:1.
- **Colour is never the only signal.**
- **Mongo is 4.4 and the hardware is old.** No layout animation.

## Depends on

Nothing. Branch `ui-audit-07-menus-and-settings` is cut from `main`, so it can merge before or after slice 2. The two touch different lines of `ContextMenu.vue` and `SettingsModal.vue`.

## Decided, and not re-opened here

From the inventory's triage table (2026-09-12):

| # | Finding | Decision |
|---|---|---|
| 16 | Server dropdown | **Add sections to the `MenuItem` model**, then section the menu. |
| 17 | Settings "Soon" rows | **Hide until built.** The owner reversed the standing directive **for the Settings shell only**; permission rows and "Forgot?" keep the honesty pattern. |

## Section names — decided: A (owner, 2026-09-14)

**What the server dropdown's sections are called.** The triage decided *that* the menu is sectioned, not the names, and the names are copy the owner chose from the options below. Every candidate has to stay true for whatever subset of rows a viewer is allowed to see: a member under the default `@everyone` sees only *Invite to Server* in the add group, and only *Server Settings* in the settings group.

- **A — chosen.** Label only groups holding more than one row, with a name true to the rows actually present: `Invite & Create` (invite and channels), `Create` (channels without invite), `Manage` (Server Settings with Voice Servers). A member sees single-row groups and therefore no labels at all; their menu looks exactly as it does today. Code for A is written out in Task 3.
- **B.** Fixed labels whatever the viewer sees: `People & Channels`, `Server`. Simpler, but `People & Channels` sits over a lone *Invite to Server* for most members.
- **C.** No labels in this menu. Separators stay; the primitive from Task 1 remains for menus that need it. Finding 16 closes as "decided: separators are enough".

**Also for the owner, not blocking:** `SettingsModal.vue`'s Account page still has a **Two-Factor Authentication** row reading "Coming soon" with a disabled Enable button. It is inside Settings, so the reversed directive may cover it — but the finding was about the nav rows, and hiding a security row is the kind of call to make on purpose. Left as it is.

**Checked and gone:** the inventory's "there is also a search box in that shell". `SettingsModal.vue` has no search field on `main`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/composables/useContextMenu.ts` | The menu model: `MenuSection`, `isSection`, and the pure helpers `menuGroups`, `navigableIndices`, `actionOrdinal` | Modify |
| `src/composables/__tests__/useContextMenu.test.ts` | The helpers, in the node environment | **Create** |
| `src/components/ui/ContextMenu.vue` | Renders groups and labels; keyboard uses the helpers | Modify |
| `src/components/modals/SettingsModal.vue` | Nav lists built pages only; placeholder page and badge styles removed | Modify |
| `src/components/modals/__tests__/settingsNav.test.ts` | Every nav row has a page | **Create** |
| `src/composables/contextMenus/serverMenu.ts` | Sections in the server dropdown (Task 3, after the owner's choice) | Modify |
| `src/composables/contextMenus/__tests__/serverMenu.test.ts` | Exact row sequence including sections | Modify |
| `docs/ROADMAP.md` | The directive's Settings exception | Modify |
| `docs/superpowers/audits/2026-09-12-ui-ux-inventory.md` | Fixed markers on 16 and 17 | Modify |

---

### Task 1: Sections in the menu model, rendered

**Files:**
- Modify: `src/composables/useContextMenu.ts`
- Modify: `src/components/ui/ContextMenu.vue`
- Create: `src/composables/__tests__/useContextMenu.test.ts`

**Interfaces:**
- Produces: `interface MenuSection { section: string }`; `type MenuRow = MenuAction | MenuSeparator | MenuSlider`; `type MenuItem = MenuRow | MenuSection`; `isSection(i: MenuItem): i is MenuSection`; `interface MenuGroup { label?: string; rows: { item: MenuRow; index: number }[] }`; `menuGroups(items: MenuItem[]): MenuGroup[]`; `navigableIndices(items: MenuItem[]): number[]`; `actionOrdinal(items: MenuItem[], index: number): number`. `isAction` now also excludes sections.

Adding a member to the `MenuItem` union is expected to break the typecheck in `ContextMenu.vue` (`it.disabled` on a section, `select(it)` with a section) and in `prepare`. That is the point: the compiler lists every site that assumed three kinds.

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/useContextMenu.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isAction, isSection, menuGroups, navigableIndices, actionOrdinal,
  type MenuAction, type MenuItem,
} from '../useContextMenu'

const row = (label: string, extra: Partial<MenuAction> = {}): MenuItem => ({ label, ...extra })
const slider: MenuItem = { slider: true, label: 'User Volume', value: 100, onInput: () => {} }

describe('isSection', () => {
  it('recognises a section and never mistakes it for an action', () => {
    const s: MenuItem = { section: 'Manage' }
    expect(isSection(s)).toBe(true)
    expect(isAction(s)).toBe(false)
    expect(isSection(row('Server Settings'))).toBe(false)
  })
})

describe('menuGroups', () => {
  it('puts rows before the first section in an unlabelled group', () => {
    const items: MenuItem[] = [row('Mark As Read'), { sep: true }, { section: 'Manage' }, row('Server Settings')]
    expect(menuGroups(items)).toEqual([
      { rows: [{ item: items[0], index: 0 }, { item: items[1], index: 1 }] },
      { label: 'Manage', rows: [{ item: items[3], index: 3 }] },
    ])
  })

  it('keeps each row\'s index in the flat list, because keyboard state is keyed on it', () => {
    const items: MenuItem[] = [{ section: 'One' }, row('A'), { section: 'Two' }, row('B')]
    const indices = menuGroups(items).flatMap(g => g.rows.map(r => r.index))
    expect(indices).toEqual([1, 3])
  })

  it('drops a section with nothing under it, so a label never heads empty space', () => {
    const items: MenuItem[] = [{ section: 'Empty' }, { section: 'Manage' }, row('Server Settings')]
    expect(menuGroups(items).map(g => g.label)).toEqual(['Manage'])
  })

  it('drops a section holding only separators', () => {
    const items: MenuItem[] = [row('A'), { section: 'Lines' }, { sep: true }, { section: 'B' }, row('B1')]
    expect(menuGroups(items).map(g => g.label)).toEqual([undefined, 'B'])
  })

  it('keeps a group whose only row is a slider — it is a real row', () => {
    expect(menuGroups([{ section: 'Volume' }, slider]).map(g => g.label)).toEqual(['Volume'])
  })

  it('returns no groups for an empty menu', () => {
    expect(menuGroups([])).toEqual([])
  })
})

describe('navigableIndices', () => {
  it('stops on enabled actions only — never a section, separator, slider or disabled row', () => {
    const items: MenuItem[] = [
      { section: 'S' }, row('One'), { sep: true }, slider, row('Off', { disabled: true }), row('Two'),
    ]
    expect(navigableIndices(items)).toEqual([1, 5])
  })
})

describe('actionOrdinal', () => {
  it('counts only rows that render a button, so sections and sliders do not shift the lookup', () => {
    // ContextMenu finds a submenu row's element as the Nth `.cm-row`. Only
    // actions render one; counting sliders or sections here would open the
    // flyout beside the wrong row.
    const items: MenuItem[] = [{ section: 'S' }, slider, row('One'), { sep: true }, row('Two')]
    expect(actionOrdinal(items, 2)).toBe(0)
    expect(actionOrdinal(items, 4)).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/useContextMenu.test.ts`
Expected: FAIL — `menuGroups`, `navigableIndices`, `actionOrdinal` and `isSection` are not exported.

- [ ] **Step 3: The model**

In `src/composables/useContextMenu.ts`, replace the block from `export interface MenuSeparator { sep: true }` down to and including the `hasSubmenu` export with:

```ts
export interface MenuSeparator { sep: true }

/** A live control rather than an action — User Volume is the recurring case.
 *  It gets its own item type rather than the header slot because it recurs; the
 *  slot is for genuinely one-off content. Selecting it must NOT close the menu,
 *  or you couldn't drag the handle. */
export interface MenuSlider {
  slider:  true
  label:   string
  value:   number
  min?:    number
  max?:    number
  /** Formats the readout; defaults to the raw number. */
  format?: (v: number) => string
  onInput: (v: number) => void
}

/** Names the rows after it, up to the next section. A label, not a row: it is
 *  never focused or selected, and the arrow keys pass over it. A separator
 *  between two groups stays the builder's job, as it always was. */
export interface MenuSection { section: string }

/** Everything that renders as a row. */
export type MenuRow  = MenuAction | MenuSeparator | MenuSlider
export type MenuItem = MenuRow | MenuSection

export const isSeparator = (i: MenuItem): i is MenuSeparator => 'sep' in i
export const isSlider    = (i: MenuItem): i is MenuSlider    => 'slider' in i
export const isSection   = (i: MenuItem): i is MenuSection   => 'section' in i
/** Rows that behave like buttons — everything that isn't a separator, slider or section. */
export const isAction    = (i: MenuItem): i is MenuAction    => !isSeparator(i) && !isSlider(i) && !isSection(i)
export const hasSubmenu  = (i: MenuItem): i is MenuAction & { submenu: MenuItem[] } =>
  isAction(i) && !!i.submenu?.length

export interface MenuGroup {
  /** Absent for the rows above the first section. */
  label?: string
  /** Each row with its index in the flat list — active row, open flyout and
   *  the arrow keys all address rows by that index, not by group. */
  rows: { item: MenuRow; index: number }[]
}

/**
 * The flat list, split at each section.
 *
 * A section with no real row under it is dropped, so a builder that filters
 * rows by permission can never leave a label heading empty space.
 */
export const menuGroups = (items: MenuItem[]): MenuGroup[] => {
  const groups: MenuGroup[] = [{ rows: [] }]
  items.forEach((item, index) => {
    if (isSection(item)) groups.push({ label: item.section, rows: [] })
    else groups[groups.length - 1].rows.push({ item, index })
  })
  return groups.filter(g => g.rows.some(r => !isSeparator(r.item)))
}

/** Indices the arrow keys stop on: enabled actions only. A slider is dragged,
 *  not selected, so landing on one would be a dead stop. */
export const navigableIndices = (items: MenuItem[]): number[] =>
  items.flatMap((it, i) => (isAction(it) && !it.disabled ? [i] : []))

/** Position of the action at `index` among the rendered `.cm-row` buttons —
 *  only actions render one. */
export const actionOrdinal = (items: MenuItem[], index: number): number =>
  items.slice(0, index).filter(isAction).length
```

In the same file, `prepare` must spread only actions:

```ts
const prepare = (items: MenuItem[]): MenuItem[] =>
  items.map(i => !isAction(i) ? i : {
    ...i,
    icon:    i.icon ? markRaw(i.icon) : undefined,
    submenu: i.submenu ? prepare(i.submenu) : undefined,
  })
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/composables/__tests__/useContextMenu.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Render groups in `ContextMenu.vue`**

Imports — replace the `useContextMenu` import line with:

```ts
import { menu, menuItems as items, closeMenu, isSeparator, isSlider, isAction, hasSubmenu, menuGroups, navigableIndices, actionOrdinal, type MenuAction, type MenuItem } from '@/composables/useContextMenu'
```

Replace the `navigable` definition and its comment with:

```ts
// Separators, sliders, sections and disabled rows are skipped by the arrow
// keys rather than swallowing a keypress.
const navigable = () => navigableIndices(items.value)
```

After `const rows = computed<MenuItem[]>(...)`, add:

```ts
/** What the menu and the flyout render: the rows split at each section. */
const groups    = computed(() => menuGroups(rows.value))
const subGroups = computed(() => menuGroups(sub.value?.items ?? []))
```

In `onKey`, the flyout's Enter branch — replace `if (it && !isSeparator(it))` with `if (it && isAction(it))`.

In `onKey`, the `ArrowRight` case — replace the `const row = …` statement with:

```ts
        const row = el.value?.querySelectorAll('.cm-row')[actionOrdinal(items.value, active.value)] as HTMLElement | undefined
```

In `onKey`, the top-level Enter branch — replace `if (it && !isSeparator(it))` with `if (it && isAction(it))`.

In the template, replace the main menu's `<template v-for="(item, i) in rows" :key="i"> … </template>` with the same rows wrapped in groups. The three row branches inside are **unchanged** apart from the loop variables:

```vue
      <div
        v-for="(group, g) in groups" :key="g"
        class="cm-group"
        :role="group.label ? 'group' : undefined"
        :aria-labelledby="group.label ? `cm-sec-${g}` : undefined"
      >
        <!-- Hidden from assistive tech because the group is named BY it: read
             once as the group's name, not again as stray text between rows. -->
        <div v-if="group.label" :id="`cm-sec-${g}`" class="cm-section" aria-hidden="true">{{ group.label }}</div>
        <template v-for="{ item, index: i } in group.rows" :key="i">
          <!-- existing separator, slider and action branches, exactly as they were -->
        </template>
      </div>
```

Do the same in the flyout: replace `<template v-for="(item, j) in sub.items" :key="j"> … </template>` with a `v-for="(group, g) in subGroups"` wrapper using ids `cm-subsec-${g}`, and `v-for="{ item, index: j } in group.rows"` inside, the two row branches unchanged.

In `<style scoped>`, after the `.cm-sep` rule, add:

```css
/* A group's name, in DESIGN.md's section-label style. Not a row: no hover, no
   pointer, and the arrow keys pass over it. --text-2 on --bg-floor measures
   9.60:1 default, 6.37:1 light, 4.97:1 light-dim (the lowest). */
.cm-section {
  padding: 8px 14px 4px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2);
  cursor: default; user-select: none;
}
```

and, with the other `.cm.sheet` rules:

```css
.cm.sheet .cm-section { padding: 12px 18px 6px; }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — clean.
Run: `npx vitest run src/` — all pass, including the untouched menu builder suites (`serverMenu`, `channelMenu`, `categoryMenu`), which prove `isAction` still selects exactly the rows it did.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useContextMenu.ts src/composables/__tests__/useContextMenu.test.ts src/components/ui/ContextMenu.vue
git commit -m "feat(menu): named sections in the menu model, rendered as labelled groups"
```

---

### Task 2: Settings lists only the pages that exist

**Files:**
- Modify: `src/components/modals/SettingsModal.vue`
- Create: `src/components/modals/__tests__/settingsNav.test.ts`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/superpowers/audits/2026-09-12-ui-ux-inventory.md`

**Interfaces:** none shared. `NavItem` loses `soon`.

- [ ] **Step 1: Write the failing test**

Create `src/components/modals/__tests__/settingsNav.test.ts`:

```ts
/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// SettingsModal cannot be mounted in the node environment, so this reads its
// source: the nav list, and the template branch each page renders in.
const src = readFileSync(resolve(__dirname, '../SettingsModal.vue'), 'utf8')
const navBlock = /const navSections: NavSection\[\] = \[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
const navIds  = [...navBlock.matchAll(/id:\s*'([\w-]+)'/g)].map(m => m[1])
const pageIds = [...src.matchAll(/<template v-(?:else-)?if="page === '([\w-]+)'">/g)].map(m => m[1])

describe('Settings navigation', () => {
  it('finds both lists, so the checks below cannot pass vacuously', () => {
    expect(navIds.length).toBeGreaterThan(0)
    expect(pageIds.length).toBeGreaterThan(0)
  })

  it('lists only pages that exist', () => {
    // Hide until built (owner, 2026-09-12). A row is added the day its page is.
    expect(navIds.filter(id => !pageIds.includes(id))).toEqual([])
  })

  it('has no Soon badge and no placeholder page left to land on', () => {
    expect(navBlock).not.toMatch(/soon/)
    expect(src).not.toMatch(/wip-page/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/modals/__tests__/settingsNav.test.ts`
Expected: FAIL — six nav ids with no page (`content-social`, `data-privacy`, `authorized-apps`, `connections`, `notifs`, `language`), and `soon` and `wip-page` still present.

- [ ] **Step 3: The nav model**

Replace the `NavItem` doc comment, the `NavItem` interface and `navSections` with:

```ts
/**
 * Only pages that exist are listed. Six of these twelve rows used to be
 * unbuilt, badged "Soon" — most of the first thing anyone read here. The
 * owner reversed the badge-don't-hide directive for Settings on 2026-09-12:
 * a page joins this list the day it is built. See docs/ROADMAP.md.
 */
interface NavItem    { id: string; label: string; icon?: any }
```

```ts
const navSections: NavSection[] = [
  {
    label: '',
    items: [
      { id: 'account',  label: 'Account'  },
      { id: 'profile',  label: 'Profile'  },
      { id: 'devices',  label: 'Devices'  },
    ]
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance'    },
      { id: 'voice',      label: 'Voice & Video' },
      { id: 'keybinds',   label: 'Keybinds'      },
    ]
  },
]
```

(`interface NavSection` above the comment stays as it is.)

- [ ] **Step 4: The template**

The nav button loses the badge, the class and the label override:

```vue
              <button
                class="sm-nav-item"
                :class="{ active: page === item.id }"
                @click="selectPage(item.id)"
              >
                {{ item.label }}
                <!-- A chevron says "this pushes a screen". Without it a phone
                     user can't tell a list row from a toggle. -->
                <ChevronRight v-if="isMobile" class="sm-nav-chev" :size="14" :stroke-width="2.25" />
              </button>
```

Delete the placeholder page — the `<!-- ── WIP pages ── -->` comment and the whole `<template v-else> … </template>` holding `.wip-page`. Every listed page now has its own branch, so nothing can reach it.

- [ ] **Step 5: The styles**

Delete, each with the comment directly above it:
- `.sm-nav-item.soon`, `.sm-nav-item.soon.active`, `.sm-soon`, `.sm-nav-item.active .sm-soon`
- `.sm-soon + .sm-nav-chev`
- `.wip-page`, `.wip-icon`, `.wip-page h2`, `.wip-page p`

**Keep** `.st-field.soon` and `.st-field.soon .st-btn` — the Two-Factor row still uses them (see "Open" above).

- [ ] **Step 6: The directive and the inventory**

In `docs/ROADMAP.md`, the standing directive currently ends "Absent capabilities are badged "Soon" in the UI rather than hidden, so shipping without them is honest rather than misleading." Append, in the same paragraph:

```markdown
The one exception is the Settings shell, where an unbuilt page is hidden until it is built
(owner, 2026-09-12); permission rows and "Forgot?" keep the pattern.
```

In `docs/superpowers/audits/2026-09-12-ui-ux-inventory.md`, under finding **17**, add a marker in the form the file already uses:

```markdown

    **Fixed** on `ui-audit-07-menus-and-settings`: Settings lists only built pages;
    the six "Soon" rows and the placeholder page are gone. The Account page's
    Two-Factor row is left for the owner.
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/components/modals/__tests__/settingsNav.test.ts` — PASS.
Run: `npm run typecheck` — clean.
Run: `npx vitest run src/` — all pass.
Run: `git grep -nE "sm-soon|wip-" -- src/` — no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/modals/SettingsModal.vue src/components/modals/__tests__/settingsNav.test.ts docs/ROADMAP.md docs/superpowers/audits/2026-09-12-ui-ux-inventory.md
git commit -m "feat(settings): list only the pages that exist"
```

---

### Task 3: The server dropdown, sectioned — option A, chosen by the owner

**Files:**
- Modify: `src/composables/contextMenus/serverMenu.ts`
- Modify: `src/composables/contextMenus/__tests__/serverMenu.test.ts`
- Modify: `docs/superpowers/audits/2026-09-12-ui-ux-inventory.md`

**Interfaces:**
- Consumes: `MenuSection`, `isSection`, `menuGroups` from Task 1.

Written for option **A**. For B, replace `addLabel` and `manageLabel` with the fixed strings. For C, skip Steps 1–4 and mark finding 16 "decided: separators are enough" instead.

- [ ] **Step 1: Write the failing tests**

In `serverMenu.test.ts`, extend the import from `../../useContextMenu` with `isSection`, add a helper beside `labels`:

```ts
/** The whole sequence: rows by label, separators as —, sections as § Name. */
const shape = (items: MenuItem[]) =>
  items.map(i => (isSeparator(i) ? '—' : isSection(i) ? `§ ${i.section}` : isAction(i) ? i.label : '(slider)'))
```

and add inside `describe('buildServerMenu', …)`:

```ts
  it('sections the owner\'s menu without moving a row', () => {
    expect(shape(buildServerMenu(mine, 'me', handlers(), ALL))).toEqual([
      'Mark As Read', '—',
      '§ Invite & Create', 'Invite to Server', 'Create Channel', 'Create Category', '—',
      '§ Manage', 'Server Settings', 'Voice Servers', '—',
      'Delete Server', '—',
      'Copy Server ID',
    ])
  })

  it('gives an ordinary member no labels — every group they see is one row', () => {
    expect(buildServerMenu(theirs, 'me', handlers(), MEMBER).some(isSection)).toBe(false)
  })

  it('calls the add group Create when inviting is off but channels are not', () => {
    const items = buildServerMenu(theirs, 'me', handlers(), { ...NOTHING, manageChannels: true })
    expect(shape(items)).toContain('§ Create')
    expect(shape(items)).not.toContain('§ Invite & Create')
  })

  it('only ever places a section straight after a separator, over at least two rows', () => {
    for (const can of [ALL, MEMBER, NOTHING, { ...MEMBER, manageChannels: true }, { ...NOTHING, manageServer: true }]) {
      const items = buildServerMenu(mine, 'me', handlers(), can)
      items.forEach((it, i) => {
        if (!isSection(it)) return
        expect(isSeparator(items[i - 1])).toBe(true)
        expect(items.slice(i + 1).findIndex(isSeparator)).toBeGreaterThanOrEqual(2)
      })
    }
  })
```

The existing exhaustive `labels(...)` tests stay as they are: `labels` filters to actions, so they now also prove no row moved or vanished.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/composables/contextMenus/__tests__/serverMenu.test.ts`
Expected: the four new tests FAIL; the existing 16 pass.

- [ ] **Step 3: Implement**

In `serverMenu.ts`, below `buildAddRows`, add:

```ts
/**
 * Names for the two groups that can hold more than one row. Each must stay
 * true for whatever the viewer is allowed to see, so it is chosen from their
 * access rather than fixed — and a group of one row gets no name, because a
 * label over a single row only repeats it. An ordinary member therefore sees
 * no labels at all, and their menu is exactly what it was.
 */
const addLabel = (can: ServerMenuAccess): string | null =>
  can.manageChannels ? (can.invite ? 'Invite & Create' : 'Create') : null
const manageLabel = (can: ServerMenuAccess): string | null =>
  can.manageServer ? 'Manage' : null
```

In `buildServerMenu`, replace `if (add.length) items.push(...add, { sep: true })` with:

```ts
  if (add.length) {
    const label = addLabel(can)
    items.push(...(label ? [{ section: label }] : []), ...add, { sep: true })
  }
```

and at the start of the following `items.push(`, before the Server Settings row, insert:

```ts
    ...(manageLabel(can) ? [{ section: manageLabel(can)! }] : []),
```

`buildSidebarMenu` is untouched: right-click on empty sidebar space shows only the add rows, and a single group needs no name.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/composables/contextMenus/__tests__/serverMenu.test.ts` — all pass.
Run: `npm run typecheck` — clean. Run: `npx vitest run src/` — all pass.

- [ ] **Step 5: Inventory, and commit**

Under finding **16**, add:

```markdown

    **Fixed** on `ui-audit-07-menus-and-settings`: the menu model has sections, and the
    server dropdown uses them for the groups that hold more than one row.
```

```bash
git add src/composables/contextMenus/serverMenu.ts src/composables/contextMenus/__tests__/serverMenu.test.ts docs/superpowers/audits/2026-09-12-ui-ux-inventory.md
git commit -m "feat(menu): the server dropdown names its groups"
```

---

### Task 4: See it

- [ ] **Step 1:** As the owner of a server, open the header dropdown with the mouse and with Enter on the header. Arrow through it: the labels are passed over, Home and End land on the first and last rows, and Escape returns focus to the header.
- [ ] **Step 2:** The same menu as a member under the default `@everyone`: no labels, identical to `main`.
- [ ] **Step 3:** At phone width the menu is a sheet; the labels sit inside it with sheet padding.
- [ ] **Step 4:** Settings, desktop and phone width: Account, Profile, Devices; App Settings: Appearance, Voice & Video, Keybinds. No badges.
- [ ] **Step 5:** `light` and `light-dim` for the dropdown labels. Screenshot each surface for the owner.

---

## Self-review

**Spec coverage.** Finding 16's decision has two halves: the model (Task 1) and the menu (Task 3). Finding 17's is Task 2, including the directive text the reversal changes. The two owner questions — section names and the Two-Factor row — are stated where a reader meets them, not buried.

**Placeholders.** None in Tasks 1 and 2. Task 3 is complete for option A and says precisely what changes for B or C.

**Type consistency.** `MenuSection`, `MenuRow`, `MenuGroup`, `menuGroups`, `navigableIndices`, `actionOrdinal` and `isSection` are defined in Task 1 and used unchanged in Task 3's tests. `hasSubmenu` keeps its signature.

**The risk worth naming.** `isAction` changes meaning for every menu in the app. The existing builder suites filter with it, and pass unchanged only if no row was reclassified — which is why Step 6 of Task 1 names them.

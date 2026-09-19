# Presence, one source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person's status is the same colour everywhere, readable on every theme, and never carried by colour alone.

**Architecture:** Status colours become tokens, tuned per theme the way the accent is. `usePresence.ts` stays the one place that maps a status to a colour and a label, and the six components that inline their own maps import it instead. A `StatusDot` component draws the status as a **shape** — filled, crescent, bar, ring — with an accessible name, and every dot in the app renders through it.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, CSS custom properties, Vitest (node environment; source-reading guards where a component cannot be mounted).

## Global Constraints

Inherited from [the slice index](./2026-09-12-ui-audit-00-slices.md#global-constraints--every-slice). The ones that bite here:

- **Colour is never the only signal.** This slice exists to make that true of presence.
- **Five themes plus Material-You.** Every status colour is measured against every surface a dot sits on, in every theme family.
- **AA is the floor.** A status dot is a graphical object: **3:1** against the surface it sits on (WCAG 1.4.11).
- **Only tokens** in any rule touched.
- **Muscle memory is binding.** Dots keep their size, position and ring. The shapes are Discord's — online filled, idle crescent, do-not-disturb bar, offline ring — so they read as familiar, not new.

## Depends on

Slice 2 (merged 2026-09-14): `--green` and `--danger` exist and are the sources for online and do-not-disturb. Independent of slice 3, which is in flight; if slice 3 lands first, its `--warning` token and this plan's idle colour are the same value (`#f0b232`) and should be unified then.

## What was measured (2026-09-14, on `main` at `886b0c0`)

**Six inline maps**, besides the canonical one in `usePresence.ts`: `AddFriendModal.vue`, `InviteGroupModal.vue`, `NewDMModal.vue`, `QuickSwitcherModal.vue` (same values as the canon), and `ProfileCard.vue`, `UserProfileModal.vue` (idle `#f0b232` and DND `#f23f43` against the canon's `#f0a500` and `#ed4245` — one person, two colours, one click apart).

**Nineteen render sites** paint a dot with `:style="{ background: … }"` — 10 in `ChatApp.vue`, 2 each in `QuickSwitcherModal.vue` and `ProfilePopout.vue`, 1 each in `ConversationDetails.vue`, `AddFriendModal.vue`, `InviteGroupModal.vue`, `NewDMModal.vue`, `UserProfileModal.vue` — plus `ProfileCard.vue`'s `dotColor`. Only `ConversationDetails.vue` gives its dot an accessible name.

**Contrast, 3:1 needed** (minimum across the surfaces `--bg-floor`, `--bg-deep`, `--bg-raised`, `--bg-panel`, `--bg-chat` of each theme):

| Status | Value | Dark (default) | Light | Light Dim |
|---|---|---|---|---|
| online | `#23a55a` | 3.97 | **2.52** | **1.97** |
| idle | `#f0b232` | 6.69 | **1.50** | **1.17** |
| dnd | `#ed4245` | 3.29 | 3.04 | **2.38** |
| offline | `#80848e` | 3.38 | **2.97** | **2.32** |

Every status clears 3:1 on dark. **On the light themes all four fail, and idle is close to invisible** (1.17:1 on Light Dim). A darker tuning per theme is needed — the same principle as Sky: one hue family, tuned per theme.

## Decided here, and why

- **Idle is `#f0b232` on dark**, not the canon's `#f0a500`: it is already `--mention-row-bar`, it is slice 3's `--warning`, and it is what Discord users expect. The change on dark is slight (6.69 vs 6.07 minimum contrast).
- **Light-theme values are derived, not picked:** lower OKLCH lightness with hue and chroma held until the colour clears **3.1:1** against the *lightest* surface of `light` and `light-dim` together, so one value serves both. An RGB darkening to the same target gives `#1b7f45`, `#8e691d`, `#c9383b`, `#6c6f77` — the OKLCH result should be close in lightness and keep more colour; record whichever the test verifies.
- **The shape carries the status; colour confirms it.** With shapes, a colour-blind member and a member on Light Dim both read the status correctly.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/styles/tokens.css` | `--status-online`, `--status-idle`, `--status-dnd`, `--status-offline`, light overrides | 1 |
| `src/styles/__tests__/statusTokens.test.ts` | Each status clears 3:1 on each surface of each theme | 1 (create) |
| `src/composables/usePresence.ts` | The one map: statuses to token colours and labels | 2 |
| `src/composables/__tests__/presenceSource.test.ts` | No component defines its own status map | 2 (create) |
| six components with inline maps | Import from `usePresence` | 2 |
| `src/components/ui/StatusDot.vue` | Shape per status, accessible name | 3 (create) |
| `src/components/ui/statusShape.ts` | Pure status-to-shape mapping | 3 (create) |
| `src/components/ui/__tests__/statusShape.test.ts` | Its tests, and the guard that every dot uses `StatusDot` | 3 (create) |
| nineteen render sites | Render `StatusDot` | 3 |

---

### Task 1: Status colours as tokens, measured

**Files:** Modify `src/styles/tokens.css`. Create `src/styles/__tests__/statusTokens.test.ts`.

- [ ] **Step 1: Failing test.** It parses `tokens.css` into theme blocks (`:root` and each `[data-theme="…"]`), resolves each block's effective `--status-*` (a block without its own falls back to `:root`; resolve `var(--green)`/`var(--danger)` references within the file) and each block's own `--bg-floor|deep|raised|panel|chat` (falling back to `:root`), and asserts every status clears **3:1** against every surface in every block. Use an independent relative-luminance helper in the test file, as `onAccent.test.ts` does. Print failures as `theme  status  value  surface  ratio`.

Run it: FAIL — the tokens do not exist.

- [ ] **Step 2: Tokens.** In `:root`:

```css
  /* Presence. Graphical objects, so the floor is 3:1 against every surface a
     dot sits on (WCAG 1.4.11) — and the shape, not the colour, carries the
     status (StatusDot.vue). Online and DND follow the semantic colours so a
     change there changes presence with them. */
  --status-online:  var(--green);
  --status-idle:    #f0b232;
  --status-dnd:     var(--danger);
  --status-offline: #80848e;
```

In `[data-theme="light"]` and `[data-theme="light-dim"]`, the four derived values (see "Decided here"), each with the ratio it measures on the lightest surface of the pair in a comment.

- [ ] **Step 3:** The test passes for every theme block, studio themes included. If a studio theme's surfaces make a status fail, report it with the numbers rather than adding a per-theme override without saying so.

- [ ] **Step 4:** `npm run typecheck`, `npx vitest run src/`. Commit: `feat(presence): status colours are tokens, legible on every theme`

---

### Task 2: One map

**Files:** Modify `src/composables/usePresence.ts`, `AddFriendModal.vue`, `InviteGroupModal.vue`, `NewDMModal.vue`, `QuickSwitcherModal.vue`, `ProfileCard.vue`, `UserProfileModal.vue`, and any presence test asserting hex values. Create `src/composables/__tests__/presenceSource.test.ts`.

- [ ] **Step 1: Failing guard.** Reads every `.vue` and `.ts` under `src/` except `usePresence.ts` and `__tests__`, and fails on any status map: an object literal with an `online` or `idle` or `dnd` key whose value is a colour (`/\b(online|idle|dnd)\s*:\s*['"]#/`), or an identifier named like `STATUS_COLOR`/`statusColors`. Run: FAIL, listing the six files.

- [ ] **Step 2: The canon reads the tokens.**

```ts
const COLORS: Record<string, string> = {
  online: 'var(--status-online)', idle: 'var(--status-idle)', dnd: 'var(--status-dnd)',
  offline: 'var(--status-offline)', invisible: 'var(--status-offline)',
}
```

`statusColor` and `statusLabel` keep their signatures. Search `src/` for any consumer that uses a `statusColor` result as a *hex* — in a canvas, a colour mix, or string maths — and list each in the report; a `var()` string there would break silently.

- [ ] **Step 3: The six components import it.** Delete each local map. Render sites that indexed the map (`statusColor[u.status] || '#80848e'`) call `statusColor(u.status)`, which already falls back to offline. `ProfileCard.vue`'s `dotColor` becomes `computed(() => statusColor(props.status))`.

- [ ] **Step 4:** Update any existing test that asserted a status hex to assert the token string. Guard passes; typecheck; tests. Commit: `fix(presence): one status map, so a person is one colour everywhere`

---

### Task 3: The shape carries the status

**Files:** Create `src/components/ui/statusShape.ts`, `src/components/ui/StatusDot.vue`, `src/components/ui/__tests__/statusShape.test.ts`. Modify the nineteen render sites and `ProfileCard.vue`.

- [ ] **Step 1: Failing tests** — `statusShape.test.ts`:

```ts
/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { statusShape } from '../statusShape'

describe('statusShape', () => {
  it('draws each status as its own shape', () => {
    expect(statusShape('online')).toBe('filled')
    expect(statusShape('idle')).toBe('crescent')
    expect(statusShape('dnd')).toBe('bar')
    expect(statusShape('offline')).toBe('ring')
  })
  it('shows invisible, unknown and missing as offline — what everyone else sees', () => {
    expect(statusShape('invisible')).toBe('ring')
    expect(statusShape('away-on-holiday')).toBe('ring')
    expect(statusShape(undefined)).toBe('ring')
    expect(statusShape(null)).toBe('ring')
  })
})

// Every dot goes through StatusDot, or a colour-only dot can come back
// unnoticed. Reads component source; the node environment cannot mount them.
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? (f === '__tests__' ? [] : walk(p)) : p.endsWith('.vue') ? [p] : []
})
describe('status dots', () => {
  it('are all drawn by StatusDot', () => {
    const offenders = walk(resolve(__dirname, '../../..'))
      .filter(f => /background:\s*statusColor\(/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
```

Run: FAIL (module missing; nineteen sites).

- [ ] **Step 2: The mapping** — `statusShape.ts`:

```ts
export type StatusShape = 'filled' | 'crescent' | 'bar' | 'ring'

/** Invisible is drawn as offline: that is what everyone else sees, and the
 *  one place that shows your own choice (your status picker) labels it. */
export const statusShape = (s: string | null | undefined): StatusShape =>
  s === 'online' ? 'filled' : s === 'idle' ? 'crescent' : s === 'dnd' ? 'bar' : 'ring'
```

- [ ] **Step 3: The component** — `StatusDot.vue`. One SVG, shapes cut with a mask so the holes show the dot's own background, which each call site sets to its ring colour:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { statusColor, statusLabel } from '@/composables/usePresence'
import { statusShape } from './statusShape'

const props = withDefaults(defineProps<{
  status?: string | null
  /** False where visible text next to the dot already names the status —
   *  the status picker — so it is not announced twice. */
  named?: boolean
}>(), { named: true })

const shape = computed(() => statusShape(props.status))
// One mask id per shape is enough: the masks are identical wherever they appear.
const maskId = computed(() => `sd-${shape.value}`)
</script>

<template>
  <span
    class="sd"
    :style="{ color: statusColor(status) }"
    :role="named ? 'img' : undefined"
    :aria-label="named ? statusLabel(status) : undefined"
    :aria-hidden="named ? undefined : 'true'"
  >
    <svg viewBox="0 0 10 10" width="100%" height="100%" aria-hidden="true" focusable="false">
      <mask :id="maskId">
        <rect width="10" height="10" fill="white" />
        <circle v-if="shape === 'crescent'" cx="2.6" cy="2.6" r="3.6" fill="black" />
        <rect v-else-if="shape === 'bar'" x="2.2" y="4.1" width="5.6" height="1.8" rx=".9" fill="black" />
        <circle v-else-if="shape === 'ring'" cx="5" cy="5" r="2.5" fill="black" />
      </mask>
      <circle cx="5" cy="5" r="5" fill="currentColor" :mask="shape === 'filled' ? undefined : `url(#${maskId})`" />
    </svg>
  </span>
</template>

<style scoped>
.sd { display: inline-block; line-height: 0; }
.sd svg { display: block; }
</style>
```

The geometry above is a starting point: at 9–12px, check each shape in the browser and adjust the cut sizes until the crescent, the bar and the ring are each unmistakable at the smallest dot (`.dm-header-dot`, 9px). Keep the shapes Discord's.

- [ ] **Step 4: The call sites.** Each `<span class="X" :style="{ background: statusColor(S) }"/>` becomes `<StatusDot class="X" :status="S" />`. In each `X` rule, set `background:` to **the same token as its ring border** (e.g. `.mp-dot` has `border: 2px solid var(--bg-panel)`, so `background: var(--bg-panel)`), so a shape's holes read as cut out of the surface. The `up-status-dot` rule's `background:#80848e` fallback is replaced the same way.
  - Self dot (`up-status-dot`): `:status="chosenStatus"`, so invisible shows as a ring to you, labelled "Invisible".
  - `ProfilePopout.vue` status picker: `:named="false"` — the option's text says the status.
  - `ConversationDetails.vue`: drop its own `aria-label`; `StatusDot` provides it.
  - `ProfileCard.vue`: the `pc-dot` span becomes `<StatusDot class="pc-dot" :status="status" />` and `dotColor` goes.

- [ ] **Step 5:** Tests pass (the guard lists no file); typecheck; `grep -rn "background: statusColor" src/` empty. Commit: `feat(presence): status is a shape as well as a colour, and has a name`

---

### Task 4: See it

- [ ] **Step 1:** Members list, DM list, friends, profile card and popout, quick switcher, user panel — in `default`, `light`, `light-dim`, `amoled`, and one studio theme. Screenshot a server with members in all four states.
- [ ] **Step 2:** Zoom to the smallest dot: the crescent, bar and ring are each distinguishable.
- [ ] **Step 3:** A screen reader pass on the member list: each member is followed by their status name, once.
- [ ] **Step 4:** Tick findings 4 and 4b in the inventory.

---

## Self-review

**Spec coverage.** Finding 4 (six maps, two disagreeing) — Task 2. Finding 4's second half (dots carry status by hue alone, no accessible name) — Task 3. The contrast failures on light themes, found while planning — Task 1. The slice index's "status stops being colour-only" — Task 3.

**Placeholders.** Light-theme values are derived by a stated method against a stated target and verified by Task 1's test, not guessed. The mask geometry is explicitly a starting point to be tuned in the browser, with the acceptance test stated.

**Type consistency.** `statusShape` returns `StatusShape` in Task 3 only. `statusColor` and `statusLabel` keep their signatures from Task 2 onward.

**The risk worth naming.** `statusColor` changes from returning hex to returning `var()` strings. Any consumer doing colour maths on the result breaks silently; Task 2 Step 2 makes finding them an explicit step.

# Loose ends — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the inventory's remaining small defects: Home reachable by keyboard, the member search actually searching, identity images that survive a broken URL, `lottie-web` out of the main bundle, AuthPage on Lucide, no layout-property animation, durations from tokens — plus the two items waiting on the owner, host-facing copy and the consent links.

**Architecture:** Each task is independent and separately reviewable. Logic goes into small pure modules with node tests where there is logic (member filtering). Template-only accessibility and markup rules are pinned by source-reading tests, the pattern `onAccentUsage.test.ts` established. Bundle and motion changes are verified by a production build and in the browser.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vite, Vitest (node environment), `lucide-vue-next`, `lottie-web`.

## Global Constraints

Inherited from [the slice index](./2026-09-12-ui-audit-00-slices.md#global-constraints--every-slice). The ones that bite here:

- **Muscle memory is binding.** Nothing moves; what clicks do does not change.
- **Only tokens** in any rule touched.
- **Reduced motion substitutes, it does not delete.**
- **Mongo is 4.4 and the hardware is old.** No animation on layout properties. Bundle weight is a real cost.
- **The two audiences.** A host sees a terminal; a member never should.
- **AA is the floor.**

## Depends on

Slice 2 merged (`ui-audit-02-tokens-and-type`). It changes `AuthPage.vue`'s wordmark, the Home icon's colour source (`accentHex` instead of `appearance.accent`) and the duration-adjacent tokens. **Cut this branch from `main` after slice 2 lands** — done 2026-09-14, from `886b0c0`. Measured on `main` at `c4b29db`; re-run each task's guard before starting it, because slice 2 moved lines.

**Tasks 6 and 7 wait for slice 3 to merge.** `ChatApp.vue` writes most rules on one line, so a transition and a colour literal share lines: the colour sweep and the motion tasks would conflict on nearly every rule they both touch. Tasks 1–5 and 8 change markup and script and can go ahead.

## Re-measured, not copied from the inventory

- **Finding 20 was partly a false positive.** It named `Avatar.vue:8`, `ProfileCard.vue:68` and `:72`, `CountryFlag.vue:65` — three of those lines are *comments* containing the word `<img>`. The real tree has **18 `<img>` tags, 16 without error handling.** The ones showing *identity* — avatars, server icons, the invite card's icon, flags — are this slice. The GIF embeds (`MessageItem`, `ReplyTreeModal`, `SearchResultsPanel`, `GifPickerModal`, `ChangeIconModal`) are listed for the owner below, not silently dropped.
- **Finding 19 counted 11 layout animations; 13 declarations match** (table in Task 6).
- **Finding 23 counted 69 raw durations across 26 files; the stricter pattern finds 57 across 27.** Task 7's guard produces the live list.
- **Finding 25 said six hand-rolled SVGs; `AuthPage.vue` has 31 `<svg>` elements** — six *shapes*, repeated across the login, register and reset forms.

## Owner decisions (2026-09-14)

**Task 8 — host-facing copy.** **Approved as proposed** in Task 8's table.

**Task 9 — consent links.** **Option A: the host supplies the terms.** Still needs a short design pass with the "about this instance" surface before it is planned; it is not executed from this plan.

**Still open:**

**GIF embeds with no error handling** — a removed Tenor GIF shows a broken-image icon in the message list. Cheap to fix alongside Task 3, but it adds a visible placeholder and copy, so it is the owner's call to include.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/views/ChatApp.vue` | Home control; member search wiring; rail icon fallback; layout transitions | 1, 2, 3, 6 |
| `src/views/__tests__/railHome.test.ts` | Home carries the same keyboard contract as a server icon | 1 (create) |
| `src/composables/memberFilter.ts` | Pure member filtering | 2 (create) |
| `src/composables/__tests__/memberFilter.test.ts` | Its tests | 2 (create) |
| `src/components/ui/Avatar.vue` | Falls back on a broken URL | 3 |
| `src/components/chat/ServerInviteCard.vue` | Falls back on a broken icon | 3 |
| `src/components/settings/CountryFlag.vue` | Hides a flag that fails | 3 |
| `src/components/__tests__/imageFallbacks.test.ts` | Every identity `<img>` handles `error` | 3 (create) |
| `src/components/SkycordIcon.vue` | Loads `lottie-web` on first use | 4 |
| `src/views/AuthPage.vue` | Lucide icons | 5 |
| `src/styles/__tests__/noLayoutAnimation.test.ts` | Guard | 6 (create) |
| `src/styles/__tests__/durationTokens.test.ts` | Guard | 7 (create) |
| `src/composables/useAuth.ts`, `src/views/AuthPage.vue`, `src/components/voice/VoiceConnectedPanel.vue` | Member-facing copy | 8 |

---

### Task 1: Home is a real control

Finding 14. `ChatApp.vue`'s Home rail item is a bare `<div>` with a click handler, while every server icon below it was fixed to `role="button"`, `tabindex="0"`, an `aria-label`, `aria-current` and Enter/Space. Home is DMs and Friends — the most visited rail destination.

**Files:** Modify `src/views/ChatApp.vue`. Create `src/views/__tests__/railHome.test.ts`.

- [ ] **Step 1: Failing test**

```ts
/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ChatApp cannot be mounted in the node environment; this reads the rail's
// markup. The server icons below Home already carry this exact contract.
const src = readFileSync(resolve(__dirname, '../ChatApp.vue'), 'utf8')
const home = /<div[^>]*class="ri home"[^>]*>/.exec(src)?.[0] ?? ''

describe('the Home rail item', () => {
  it('is found, so the checks below cannot pass vacuously', () => {
    expect(home).not.toBe('')
  })
  it('is a focusable button with a name', () => {
    expect(home).toContain('role="button"')
    expect(home).toContain('tabindex="0"')
    expect(home).toContain('aria-label="Home"')
  })
  it('says when it is the current place', () => {
    expect(home).toMatch(/:aria-current="[^"]*'page'[^"]*"/)
  })
  it('opens on Enter and on Space, like a server icon', () => {
    expect(home).toMatch(/@keydown\.self\.enter\.prevent="openFriends"/)
    expect(home).toMatch(/@keydown\.self\.space\.prevent="openFriends"/)
  })
})
```

Run: `npx vitest run src/views/__tests__/railHome.test.ts` — FAIL on the last three.

- [ ] **Step 2: Implement** — the opening tag becomes (the tag spans lines; keep `v-tip`):

```vue
        <div class="ri home" :class="{ active: homeActive }" v-tip:right="'Home'"
          role="button" tabindex="0" aria-label="Home"
          :aria-current="homeActive ? 'page' : undefined"
          @keydown.self.enter.prevent="openFriends" @keydown.self.space.prevent="openFriends"
          @click.stop="openFriends">
```

`homeActive` already exists (the icon's colour reads it). Confirm it is exactly `view==='friends'||view==='dm'` before replacing the inline expression; if it differs, keep the inline expression in both places instead.

The test's regex reads one tag, so keep the whole opening tag free of `>` inside attribute values.

- [ ] **Step 3:** `npm run typecheck`, `npx vitest run src/`. Commit: `fix(a11y): Home in the rail is reachable and operable by keyboard`

---

### Task 2: The member search searches

Finding 8. `<input type="text" aria-label="Search members" placeholder="Search members…"/>` has no binding and no handler: it focuses, accepts text and does nothing. Member lists cap at 100, so a client-side filter is cheap.

**Files:** Create `src/composables/memberFilter.ts` and its test. Modify `src/views/ChatApp.vue`.

**Interfaces:** Produces `filterMembers<T extends { username: string; displayName?: string | null }>(groups: { online: T[]; offline: T[] }, query: string): { online: T[]; offline: T[] }`.

- [ ] **Step 1: Failing test** — `src/composables/__tests__/memberFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterMembers } from '../memberFilter'

const m = (username: string, displayName?: string) => ({ id: username, username, displayName })
const groups = {
  online:  [m('owner', 'Sky Owner'), m('renée', 'Renée'), m('bob')],
  offline: [m('alice', 'Alice W'), m('zed')],
}
const ids = (g: ReturnType<typeof filterMembers>) => [g.online.map(x => x.id), g.offline.map(x => x.id)]

describe('filterMembers', () => {
  it('returns the groups untouched for an empty or blank query', () => {
    expect(filterMembers(groups, '')).toEqual(groups)
    expect(filterMembers(groups, '   ')).toEqual(groups)
  })
  it('matches display name or username, anywhere, ignoring case', () => {
    expect(ids(filterMembers(groups, 'OWN'))).toEqual([['owner'], []])
    expect(ids(filterMembers(groups, 'w'))).toEqual([['owner'], ['alice']])
  })
  it('ignores accents, so "renee" finds Renée', () => {
    expect(ids(filterMembers(groups, 'renee'))).toEqual([['renée'], []])
  })
  it('keeps each group\'s order', () => {
    expect(ids(filterMembers(groups, 'e'))).toEqual([['owner', 'renée'], ['alice', 'zed']])
  })
})
```

Run it — FAIL (module missing).

- [ ] **Step 2: Implement** — `src/composables/memberFilter.ts`:

```ts
/**
 * The member list's search. Client-side because a server's member list is
 * capped at 100 — a request per keystroke would cost more than it saves.
 * Accents are folded so a name typed without them still matches.
 */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()

export const filterMembers = <T extends { username: string; displayName?: string | null }>(
  groups: { online: T[]; offline: T[] },
  query: string,
): { online: T[]; offline: T[] } => {
  const q = fold(query.trim())
  if (!q) return groups
  const hit = (x: T) => fold(x.displayName ?? '').includes(q) || fold(x.username).includes(q)
  return { online: groups.online.filter(hit), offline: groups.offline.filter(hit) }
}
```

- [ ] **Step 3: Wire it in `ChatApp.vue`**
  - `const memberQuery = ref('')` and `const shownMembers = computed(() => filterMembers(activeMembers.value, memberQuery.value))`.
  - Clear it when the server changes: `watch(activeServerId, () => { memberQuery.value = '' })` — a filter left over from another server hides people with no visible cause.
  - The input: `v-model="memberQuery"` and `@keydown.esc.stop="memberQuery = ''"` (stop, so Escape clears the field instead of closing whatever is open).
  - The two `v-for`s and the two section counts read `shownMembers`. **The header count keeps `activeMembers`** — it is the size of the server, not of the search.
  - When a non-blank query matches nobody, the list shows one line: `<div class="mp-empty">No one matches “{{ memberQuery.trim() }}”</div>`, styled `color: var(--text-3); font-size: 13px; padding: 12px 8px;`.

- [ ] **Step 4:** typecheck, `npx vitest run src/`. Commit: `fix(members): the member search filters the list`

---

### Task 3: Identity images survive a broken URL

Finding 20, re-measured (see above). An uploaded avatar or server icon whose file is gone renders the browser's broken-image glyph.

**Files:** `Avatar.vue`, `ChatApp.vue` (rail icon), `ServerInviteCard.vue`, `CountryFlag.vue`; create `src/components/__tests__/imageFallbacks.test.ts`.

- [ ] **Step 1: Failing guard** — reads the four files and asserts each identity `<img>` tag carries `@error`:

```ts
/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SITES: Array<[file: string, marker: RegExp]> = [
  ['components/ui/Avatar.vue',              /<img ref="el"[^>]*>/],
  ['views/ChatApp.vue',                     /<img :src="srv\.img"[^>]*>/],
  ['components/chat/ServerInviteCard.vue',  /<img class="ic-icon ic-icon--img"[^>]*>/],
  ['components/settings/CountryFlag.vue',   /<img v-if="src" class="cf"[^>]*>/],
]

describe('identity images', () => {
  for (const [file, marker] of SITES) {
    it(`${file} handles a failed load`, () => {
      const tag = marker.exec(readFileSync(resolve(__dirname, '..', '..', file), 'utf8'))?.[0]
      expect(tag, `marker not found in ${file} — update this test`).toBeTruthy()
      expect(tag).toMatch(/@error=/)
    })
  }
})
```

(Adjust each `marker` to the tag's actual opening once edited; the point is one assertion per site.)

- [ ] **Step 2: Implement**
  - **Avatar.vue:** a `failed` ref, reset by `watch(() => props.src, () => { failed.value = false })`. `@error="failed = true"`. While failed, `shownSrc` returns `defaultAvatar(props.alt || '?')` from `useAvatar.ts` — the generator every user without an avatar already gets, so a failure looks like "no picture", not like an error.
  - **ChatApp.vue rail icon:** `@error="(e) => ((e.target as HTMLImageElement).src = serverIconFor(srv.name))"` — the same initials tile a server with no icon already shows. `serverIconFor` with no icon returns a data URL, so it cannot fail in turn.
  - **ServerInviteCard.vue:** same, with `serverInfo?.name ?? '?'`.
  - **CountryFlag.vue:** `@error="src = null"`. The row already renders correctly with no flag.

- [ ] **Step 3:** typecheck, tests. Commit: `fix(images): avatars, server icons and flags fall back instead of breaking`

---

### Task 4: `lottie-web` leaves the main bundle

Finding 26. `SkycordIcon.vue` imports `lottie-web` and the spin JSON statically, so both ship in the entry chunk even for `mode="static"`, whose own comment promises "no lottie-web loaded at all".

**Files:** Modify `src/components/SkycordIcon.vue`.

- [ ] **Step 1: Measure the before.** `npx vite build`, then `ls -la dist/assets/*.js` and `grep -l "loadAnimation" dist/assets/*.js`. Record the entry chunk's size and that it contains `loadAnimation`.

- [ ] **Step 2: Implement.** Replace the two static imports with a type-only import and a memoised loader:

```ts
import type { AnimationItem } from 'lottie-web'

// lottie-web and the spin data are only needed by the animated modes. Loaded
// on first use: 'static' costs nothing, and the animated modes arrive after
// the shell has painted instead of holding it up.
type Lottie = typeof import('lottie-web')['default']
let loading: Promise<[Lottie, unknown]> | null = null
const loadLottie = () => (loading ??= Promise.all([
  import('lottie-web').then(m => m.default),
  import('@/assets/lottie/skycord-spin.json').then(m => m.default as unknown),
]))
```

`buildRecoloredData(rawColor, data)` takes the data as a parameter and clones *it*. `buildAnim` becomes async and guards against every way the component can move on while the import is in flight:

```ts
// Bumped by every destroy and build, so a build that finishes late — after an
// unmount, a rebuild or a switch to static — knows it is stale and does nothing.
let generation = 0
const buildAnim = async () => {
  const mine = ++generation
  const [lottie, data] = await loadLottie()
  if (mine !== generation || !lottieEl.value || props.mode === 'static') return
  anim = lottie.loadAnimation({
    container: lottieEl.value,
    renderer: 'svg',
    loop:     props.mode === 'loading',
    autoplay: props.mode === 'loading',
    animationData: buildRecoloredData(props.color, data),
  })
  if (props.mode === 'hover' || props.mode === 'lucky') {
    anim.addEventListener('complete', () => anim?.goToAndStop(0, true))
  }
}
const destroyAnim = () => { generation++; anim?.destroy(); anim = null }
```

`onEnter` for hover mode becomes `destroyAnim(); void buildAnim().then(() => anim?.play())`. Every other call site can call `void buildAnim()`.

- [ ] **Step 3: Measure the after.** Rebuild. Expected: `loadAnimation` appears only in a separate chunk, the entry chunk is smaller by roughly lottie's size, and the build prints no new warnings. Put both numbers in the commit message.

- [ ] **Step 4:** typecheck, tests. In the browser: Home's lucky spin still works, the splash's loading spinner still spins, and the static logo renders with **no** lottie chunk requested (network panel). Commit: `perf(bundle): lottie-web loads on first animated use, not with the app`

---

### Task 5: AuthPage on Lucide

Finding 25. `AuthPage.vue` hand-draws six icon shapes — user, lock, eye, eye-off, alert, spinner — 31 times across its forms, at `stroke-width="2"`, while `DESIGN.md` forbids custom SVGs for anything Lucide has. One of them hardcodes `stroke="#23a55a"`.

**Files:** Modify `src/views/AuthPage.vue`.

- [ ] **Step 1:** List every `<svg>` with its line and which shape it is (read each path). Map: user → `User`, lock → `Lock`, eye → `Eye`, eye-off → `EyeOff`, alert → `CircleAlert`, spinner → `LoaderCircle`, the confirm tick → `Check`. Any shape that is none of these is reported, not guessed.
- [ ] **Step 2:** Replace each with the Lucide component at the **same pixel size** (`:size="15"`, the spinner `16`, the tick `14`), carrying over `class` (`fi`, `spin`, `check`) and `v-if`/`v-else`. Stroke: the house pairing from `DESIGN.md` is `2.25` at 16px — use `:stroke-width="2"` here to match what exists, since this is a swap, not a restyle.
- [ ] **Step 3:** The tick's colour moves to CSS: `.check { color: var(--green); }` with the component's default `currentColor` stroke.
- [ ] **Step 4:** `grep -c "<svg" src/views/AuthPage.vue` → `0`. typecheck, tests. Screenshot login, register and reset in a throwaway browser session with no saved profile (no sign-in needed to view them), dark and light, against the same screens on `main`. Commit: `refactor(auth): Lucide icons instead of hand-drawn copies`

---

### Task 6: No animation on a layout property

Finding 19. Triage: fix. `DESIGN.md` and the hardware constraint rule out animating width, height, padding, margin or grid tracks.

**Files:** Create `src/styles/__tests__/noLayoutAnimation.test.ts` (reads every `.vue` `<style>` and `src/**/*.css`, lists each `transition`/`transition-property` naming `width|height|min-height|max-height|padding*|margin*|top|right|bottom|left|flex-basis|grid-template-*`). Modify the sites below.

Each site gets a decision — **the effect is preserved through transform or opacity where it carries meaning, and dropped where it does not**:

| Site | Now | Decision |
|---|---|---|
| `MicFlyout.vue` `.mf-fill`, `VoiceVideoSettings.vue` `.vv-meter-fill` | `width .05s linear` on a level meter | `transform: scaleX(var(--level))`, `transform-origin: left`, `transition: transform .05s linear`. Identical look, no layout. **Keep the raw `.05s`** — it smooths a live signal, it is not a UI duration (Task 7 exception). |
| `ChatApp.vue` `.ri-pip` | `height` grows on hover/active | `transform: scaleY()` on a pip at its full active height, `transform-origin: center`. |
| `ChatApp.vue` `.ch-item` | `padding-left` nudges on hover | `transform: translateX()` on the row's content, or drop the nudge. Reviewer decides by looking; muscle memory is unaffected either way. |
| `ChatApp.vue` `.sidebar`, `.members-panel` | `width` + `opacity` on collapse | **Drop the width transition, keep opacity.** Animating a column's width reflows the chat on every frame — the costliest case in the app. |
| `ChatApp.vue` shell `height` + `margin-top` (connection strip) | follows `--conn-h` | Drop both transitions. The strip's own entrance can animate by transform. |
| `ChatApp.vue` `.ch-fold` | `height` with `interpolate-size` (category collapse) | Drop the height transition; fade the channels in with opacity. |
| `SettingsModal.vue` `.sm-subnav-wrap` | `grid-template-rows` 0fr→1fr | Drop the track transition, keep opacity. **Check the comment above it first:** it exists so Log Out does not jump. A snap is honest; a jump that looks like a bug is not — if it reads as a bug in the browser, report it rather than reintroducing the layout animation. |
| `SearchField.vue` width expand; `ConversationDetails.vue` `.cd-searchfield` width/padding, `.cd-head-actions` width | search field grows | Drop the width transitions; the field's border and background still transition. |

- [ ] **Step 1:** Guard test, failing with the live list. Record the count.
- [ ] **Step 2:** One site at a time, per the table. Reduced motion: every surviving transform/opacity transition is already covered by the global reduced-motion rules — confirm, don't assume.
- [ ] **Step 3:** Guard passes. Browser: each site, once, at normal and reduced motion.
- [ ] **Step 4:** Commit: `perf(motion): nothing animates a layout property`

---

### Task 7: Durations come from tokens

Finding 23. Triage: fix. Tokens: `--dur-1 120ms`, `--dur-2 180ms`, `--dur-3 240ms`, `--dur-4 340ms`, `--dur-exit 140ms`, with `--ease-out` / `--ease-in`.

**Files:** Create `src/styles/__tests__/durationTokens.test.ts` — lists each `transition`/`animation` declaration containing a literal time.

**The mapping rule, by role not by nearest number:**
- Hover, press, colour change → `--dur-1`.
- Small reveal: tooltip, chip, dropdown → `--dur-2`.
- Popover, menu, panel → `--dur-3`.
- Modal, sheet, page-scale motion → `--dur-4`.
- Anything leaving → `--dur-exit` with `--ease-in`.

**Allowed literals, each with a one-line comment at the site:** continuous loops (a spinner's `infinite` period), live-signal smoothing (meters, Task 6), and `ModalBase.vue`'s sheet physics only if it is tuned against a drag. The guard's allowlist names each by `file:selector`, never by value.

`ModalBase.vue:267` (`transform .26s cubic-bezier(.2,.8,.3,1)`) goes first — it is the component the rest are meant to copy.

- [ ] **Step 1:** Guard, failing, count recorded.
- [ ] **Step 2:** File by file. Bounce easings (`cubic-bezier(.34, 1.56, .64, 1)`) stay — triaged as character.
- [ ] **Step 3:** Guard passes except the named allowlist. Commit: `refactor(motion): durations come from the motion tokens`

---

### Task 8: Host-facing copy, rewritten for the member — wording approved by the owner

Triage: "rewrite for the member, move host detail where a host would look". Slice 1 fixed `mic needs HTTPS`; these three remain.

| Where | Now | Proposed |
|---|---|---|
| `useAuth.ts` `OFFLINE_MSG` | "Skycord server is offline — start the API server (start-dev.cmd), it will reconnect automatically." | **Member:** "Can't reach the server. Retrying automatically…" **Developer build only** (`import.meta.env.DEV`): the same, plus " Is the API running? (start-dev.cmd)" |
| `AuthPage.vue` offline banner | "Server offline — start the API server (start-dev.cmd). Retrying automatically…" | Same split as above. |
| `VoiceConnectedPanel.vue` footer | "Encrypted in transit (DTLS-SRTP)" | "Encrypted in transit". The protocol stays where a host looks: `RtcDebugModal` already shows the DTLS state. |

`import.meta.env.DEV` is false in every production image, so a member on a real instance can never see a script name — and the developer at this desk still gets the hint they rely on.

- [ ] Steps once approved: a test that `OFFLINE_MSG` for a production build contains no `.cmd`; the swap; typecheck; tests; commit `fix(copy): members are never told to run a script`.

---

### Task 9: The consent links — option A chosen; design pass before planning

Finding 13. "By registering you agree to our Terms & Privacy Policy" links both words to `#`. A draft exists at the repo root (`Skycord — Terms of Service Draft Outline vision 1.md`, with a `REVIEW.md`). The question is whose terms these are on an instance someone else runs.

- **A — chosen.** The instance supplies them. Two optional settings, `TERMS_URL` and `PRIVACY_URL`, exposed through the existing public instance endpoint. Set → the sentence links to them. Unset → **the sentence is not shown**: agreeing to nothing is not a claim the page should make. This is the same data the triaged "about this instance" surface needs, so it is designed once.
- **B.** Skycord ships its own terms and privacy pages from the draft, shown on every instance. Only right if the project, not each host, is the party people agree with.
- **C.** Remove the sentence until A or B exists.

A needs a small design pass with the "about this instance" work before a plan — it touches the server, the deploy `.env` and the installer's prompts.

---

## Self-review

**Spec coverage.** Slice 8 in the index lists: member search (Task 2), consent links (Task 9, owner), `.ri.home` (Task 1), image errors (Task 3), the lottie import (Task 4), AuthPage's SVGs (Task 5), layout animations (Task 6), raw durations (Task 7). Host-facing copy was assigned here by slice 1's self-review (Task 8). Finding 22's contrast misses belong to slice 3's sweep.

**Placeholders.** Tasks 1–5 carry the code. Tasks 6 and 7 are driven by guard tests that produce the live site list, because slice 2 and slice 3 both move these lines — a frozen list would be stale before the task starts; the per-site decisions and the mapping rule are concrete. Tasks 8 and 9 are explicitly blocked, with proposals.

**Type consistency.** `filterMembers` is defined once (Task 2). `serverIconFor` and `defaultAvatar` are existing exports reused unchanged (Task 3).

**The risk worth naming.** Task 6 removes motion people have seen. Every removal keeps a transform or opacity cue where the motion carried meaning, and the browser pass is at normal and reduced motion — but the owner should see the sidebar and member-panel collapse before merge, because that is the change most likely to feel different.

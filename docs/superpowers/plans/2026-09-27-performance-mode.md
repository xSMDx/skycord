# Performance mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give Skycord a Performance setting with three levels that cuts what the app holds in memory on a slow PC, and stops it growing over a long session.

**Architecture:** one composable resolves a level (`full` / `balanced` / `light`) plus per-switch overrides into a single reactive object every consumer reads by name. Consumers are the message store (eviction), the call layer (tile cap, incoming quality, pause when hidden), media (GIFs on tap), and the Electron shell (title-bar mode, graphics card, heap cap, cache trim). A Playwright memory harness measures every claim before and after.

**Tech Stack:** Vue 3 + TypeScript client, Vitest (node env, no jsdom), Electron 44 shell, livekit-client 2.20, Playwright for the harness.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-26-performance-mode-design.md`. Read it before Task 1.
- Measured baseline to beat: **275 MB private / 471 MB working set**.
- Targets: **Light ≤ 170 MB private**, **Balanced ≤ 220 MB private**, Full no worse than today, and **no growth beyond ±10% over an idle hour**.
- **Any switch worth less than ~5 MB does not ship.** Task 8 removes it.
- Process-level switches (graphics card, heap cap, title-bar mode) apply **on restart only**, are never applied automatically, and the app never changes level by itself.
- Renderer caches are trimmed with `webFrame.clearCache()`. **Never `session.clearCache()`** — that throws away the HTTP cache the app relies on.
- Full and Balanced keep Skycord's own title bar. Only Light uses the plain Windows frame.
- The harness runs against the local dev stack only, never a live server, and reads its test account from a git-ignored file. No credentials in the repo, the script, or chat.
- Every colour is an existing token; no new hex values. Touch targets ≥40px. Reduced motion is honoured.
- There is no jsdom or component-test setup in this repo. Logic is unit tested; Vue components are verified by typecheck and a stated manual check.

---

## File Structure

| File | Responsibility |
|---|---|
| `desktop/scripts/memory-probe.mjs` (create) | Drives the packaged app through a scripted session and samples every process |
| `desktop/scripts/.probe.env.example` (create) | Names the two variables the harness needs; the real file is git-ignored |
| `docs/performance-baseline.md` (create) | The numbers, per run, so claims can be checked later |
| `src/composables/usePerformance.ts` (create) | Level, overrides, resolved switches, persistence, the suggestion rule, restart tracking |
| `src/composables/__tests__/usePerformance.test.ts` (create) | Its tests |
| `src/composables/useMessages.ts` (modify) | Eviction: per-conversation cap and an LRU across conversations |
| `src/composables/__tests__/messageEviction.test.ts` (create) | Its tests |
| `src/composables/callLimits.ts` (create) | Pure: which tiles are visible, what incoming quality to ask for |
| `src/composables/__tests__/callLimits.test.ts` (create) | Its tests |
| `src/components/settings/PerformancePage.vue` (create) | The three levels, Advanced, the memory readout, the restart prompt |
| `src/components/modals/SettingsModal.vue` (modify) | One nav item and one page slot |
| `src/composables/desktopBridge.ts` (modify) | Types for the two new bridge calls |
| `desktop/src/perf.ts` (create) | Pure: stored level → the flags and window mode the shell applies |
| `desktop/src/__tests__/perf.test.ts` (create) | Its tests |
| `desktop/src/main.ts` (modify) | Applies the flags before ready; the IPC for level changes and memory figures |
| `desktop/src/appWindow.ts` (modify) | Builds the window with or without Skycord's title bar |
| `desktop/src/store.ts` (modify) | One more stored key |
| `desktop/src/preload.ts` (modify) | Exposes the two new calls |

---

## Task 1: The memory harness and a baseline

**Files:**
- Create: `desktop/scripts/memory-probe.mjs`
- Create: `desktop/scripts/.probe.env.example`
- Create: `docs/performance-baseline.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `node desktop/scripts/memory-probe.mjs --label <name>` writes `desktop/.probe/<name>.csv` and prints a summary table. Later tasks quote its numbers.

- [ ] **Step 1: Write the environment example and ignore the real one**

`desktop/scripts/.probe.env.example`:

```
PROBE_ORIGIN=http://localhost:4175
PROBE_EMAIL=probe@example.test
PROBE_PASSWORD=
```

Append to `.gitignore`:

```
desktop/scripts/.probe.env
desktop/.probe/
```

- [ ] **Step 2: Write the harness**

`desktop/scripts/memory-probe.mjs`:

```js
// Samples the packaged app's memory through a scripted session.
// Local dev stack only: it refuses any origin that is not localhost.
import { createRequire } from 'module'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
const { _electron } = createRequire('H:/projects/sykord-wt/desktop/desktop/package.json')('playwright')

const env = Object.fromEntries(readFileSync(new URL('./.probe.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const origin = env.PROBE_ORIGIN || ''
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  console.error('PROBE_ORIGIN must be the local dev stack, not a live server.'); process.exit(1)
}
const label = (process.argv[process.argv.indexOf('--label') + 1] || 'run').replace(/[^a-z0-9-]/gi, '')
const wait = ms => new Promise(r => setTimeout(r, ms))

const app = await _electron.launch({ args: ['.'], cwd: new URL('..', import.meta.url).pathname.slice(1) })
const samples = []
const sample = async (phase) => {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
  const rows = metrics.map(m => ({ type: m.type, ws: Math.round((m.memory?.workingSetSize ?? 0) / 1024), priv: Math.round((m.memory?.privateBytes ?? 0) / 1024) }))
  samples.push({ t: Date.now(), phase, total_ws: rows.reduce((s, r) => s + r.ws, 0), total_priv: rows.reduce((s, r) => s + r.priv, 0), rows })
}
const every10s = setInterval(() => sample('tick'), 10_000)

const page = await (async () => {
  for (let i = 0; i < 200; i++) { const p = app.windows().find(w => w.url().startsWith(origin)); if (p) return p; await wait(100) }
  throw new Error('the app never opened the dev stack — is desk-web running?')
})()

await sample('loaded')
await page.fill('input[type="email"]', env.PROBE_EMAIL)
await page.fill('input[type="password"]', env.PROBE_PASSWORD)
await page.keyboard.press('Enter')
await page.waitForSelector('[data-testid="channel-list"], .ch', { timeout: 30_000 })
await sample('signed-in')

for (const ch of await page.$$('.ch')) {
  await ch.click(); await wait(1500)
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -4000); await wait(900) }
  await sample('scrolled')
}
await sample('channels-open')
await wait(20 * 60_000)
await sample('idle-20m')

clearInterval(every10s)
mkdirSync(new URL('../.probe/', import.meta.url), { recursive: true })
const csv = ['phase,total_ws_kb,total_priv_kb,' + samples[0].rows.map(r => r.type).join(',')]
  .concat(samples.map(s => [s.phase, s.total_ws, s.total_priv, ...s.rows.map(r => r.ws)].join(',')))
writeFileSync(new URL(`../.probe/${label}.csv`, import.meta.url), csv.join('\n'))
const last = samples[samples.length - 1]
console.log(`${label}: ${Math.round(last.total_priv / 1024)} MB private, ${Math.round(last.total_ws / 1024)} MB working set after idle`)
await app.close()
```

- [ ] **Step 3: Run it at today's code and capture the baseline**

Start the dev stack first (preview entries `desk-api` and `desk-web`), copy `.probe.env.example` to `.probe.env`, fill in the seeded test account, then:

Run: `node desktop/scripts/memory-probe.mjs --label baseline`
Expected: a final line like `baseline: 275 MB private, 471 MB working set after idle`, and `desktop/.probe/baseline.csv` written.

- [ ] **Step 4: Record the numbers**

Write `docs/performance-baseline.md` with a table of the run: date, commit, label, private and working set at each phase, and the per-process split at the last sample. This file grows by one row per run; Task 8 adds the Balanced and Light rows.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/memory-probe.mjs desktop/scripts/.probe.env.example docs/performance-baseline.md .gitignore
git commit -m "test(desktop): a memory harness, and today's numbers"
```

---

## Task 2: The performance composable

**Files:**
- Create: `src/composables/usePerformance.ts`
- Create: `src/composables/__tests__/usePerformance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PerfLevel = 'full' | 'balanced' | 'light'`
  - `interface PerfSwitches { keepConversations: number; messagesPerConversation: number; animatedMedia: 'play' | 'tap'; imageTrimMinutes: number | null; maxCallTiles: number; incomingVideo: 'auto' | '720p' | '360p'; pauseVideoWhenHidden: boolean; motion: 'full' | 'reduced' | 'off'; skycordTitleBar: boolean; hardwareAcceleration: boolean; heapCapMb: number | null }`
  - `const PERF_LEVELS: Record<PerfLevel, PerfSwitches>`
  - `const perf: PerfSwitches` (reactive, resolved)
  - `const perfState: { level: PerfLevel; overrides: Partial<PerfSwitches>; dismissedSuggestion: boolean }`
  - `setPerfLevel(level: PerfLevel): void`, `setPerfOverride<K extends keyof PerfSwitches>(key: K, value: PerfSwitches[K]): void`, `clearPerfOverrides(): void`, `dismissSuggestion(): void`
  - `resolve(level: PerfLevel, overrides: Partial<PerfSwitches>): PerfSwitches`
  - `suggestsLight(totalMemoryGb: number | undefined): boolean`
  - `RESTART_KEYS: readonly ['skycordTitleBar', 'hardwareAcceleration', 'heapCapMb']`
  - `restartNeeded(applied: Pick<PerfSwitches, typeof RESTART_KEYS[number]> | null): boolean`

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/usePerformance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PERF_LEVELS, resolve, suggestsLight, restartNeeded } from '../usePerformance'

describe('levels', () => {
  it('keeps everything at full', () => {
    expect(PERF_LEVELS.full.keepConversations).toBe(Infinity)
    expect(PERF_LEVELS.full.messagesPerConversation).toBe(Infinity)
    expect(PERF_LEVELS.full.animatedMedia).toBe('play')
    expect(PERF_LEVELS.full.skycordTitleBar).toBe(true)
    expect(PERF_LEVELS.full.hardwareAcceleration).toBe(true)
  })

  it('trades progressively more at balanced and light', () => {
    expect(PERF_LEVELS.balanced.keepConversations).toBe(3)
    expect(PERF_LEVELS.balanced.messagesPerConversation).toBe(200)
    expect(PERF_LEVELS.balanced.maxCallTiles).toBe(4)
    expect(PERF_LEVELS.light.keepConversations).toBe(1)
    expect(PERF_LEVELS.light.messagesPerConversation).toBe(100)
    expect(PERF_LEVELS.light.maxCallTiles).toBe(2)
  })

  it('only light gives up the Skycord title bar and the graphics card', () => {
    expect(PERF_LEVELS.balanced.skycordTitleBar).toBe(true)
    expect(PERF_LEVELS.balanced.hardwareAcceleration).toBe(true)
    expect(PERF_LEVELS.light.skycordTitleBar).toBe(false)
    expect(PERF_LEVELS.light.hardwareAcceleration).toBe(false)
    expect(PERF_LEVELS.light.heapCapMb).toBe(192)
  })
})

describe('resolve', () => {
  it('is the level when nothing is overridden', () => {
    expect(resolve('balanced', {})).toEqual(PERF_LEVELS.balanced)
  })

  it('lets one switch be overridden without touching the rest', () => {
    const r = resolve('light', { hardwareAcceleration: true })
    expect(r.hardwareAcceleration).toBe(true)
    expect(r.maxCallTiles).toBe(PERF_LEVELS.light.maxCallTiles)
  })
})

describe('suggestsLight', () => {
  it('suggests light below six gigabytes', () => {
    expect(suggestsLight(4)).toBe(true)
    expect(suggestsLight(5.9)).toBe(true)
  })

  it('says nothing when there is enough memory, or none reported', () => {
    expect(suggestsLight(8)).toBe(false)
    expect(suggestsLight(undefined)).toBe(false)
  })
})

describe('restartNeeded', () => {
  it('is false when the applied switches match the current ones', () => {
    expect(restartNeeded({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null })).toBe(false)
  })

  it('is true when a restart-only switch has changed since launch', () => {
    expect(restartNeeded({ skycordTitleBar: false, hardwareAcceleration: true, heapCapMb: null })).toBe(true)
  })

  it('is false when nothing was applied yet, as on the web', () => {
    expect(restartNeeded(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/composables/__tests__/usePerformance.test.ts`
Expected: FAIL, `Failed to resolve import "../usePerformance"`.

- [ ] **Step 3: Write the composable**

`src/composables/usePerformance.ts`:

```ts
/**
 * What the app is allowed to spend, in one place.
 *
 * A level is a named set of switches; an override changes one of them without
 * leaving the level. Everything that costs memory reads the resolved object by
 * name, so a switch is added here and consumed by meaning, never by asking
 * "which level is this?".
 *
 * Three switches only take effect when the shell restarts, because Chromium
 * reads them at startup: see RESTART_KEYS.
 */
import { reactive, computed, watch } from 'vue'

export type PerfLevel = 'full' | 'balanced' | 'light'

export interface PerfSwitches {
  /** Conversations kept in memory at once; the open one is never evicted. */
  keepConversations: number
  /** Messages kept per conversation; older ones are dropped and refetched. */
  messagesPerConversation: number
  animatedMedia: 'play' | 'tap'
  /** Trim the renderer's image cache after this long hidden; null = never. */
  imageTrimMinutes: number | null
  maxCallTiles: number
  incomingVideo: 'auto' | '720p' | '360p'
  pauseVideoWhenHidden: boolean
  motion: 'full' | 'reduced' | 'off'
  /** Desktop only. false = the plain Windows frame, which is one process less. */
  skycordTitleBar: boolean
  /** Desktop only, restart. */
  hardwareAcceleration: boolean
  /** Desktop only, restart. null = the engine's own ceiling. */
  heapCapMb: number | null
}

export const PERF_LEVELS: Record<PerfLevel, PerfSwitches> = {
  full: {
    keepConversations: Infinity, messagesPerConversation: Infinity,
    animatedMedia: 'play', imageTrimMinutes: null,
    maxCallTiles: Infinity, incomingVideo: 'auto', pauseVideoWhenHidden: false,
    motion: 'full', skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null,
  },
  balanced: {
    keepConversations: 3, messagesPerConversation: 200,
    animatedMedia: 'tap', imageTrimMinutes: 5,
    maxCallTiles: 4, incomingVideo: '720p', pauseVideoWhenHidden: true,
    motion: 'reduced', skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null,
  },
  light: {
    keepConversations: 1, messagesPerConversation: 100,
    animatedMedia: 'tap', imageTrimMinutes: 1,
    maxCallTiles: 2, incomingVideo: '360p', pauseVideoWhenHidden: true,
    motion: 'off', skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192,
  },
}

export const RESTART_KEYS = ['skycordTitleBar', 'hardwareAcceleration', 'heapCapMb'] as const
type RestartKey = typeof RESTART_KEYS[number]

export const resolve = (level: PerfLevel, overrides: Partial<PerfSwitches>): PerfSwitches =>
  ({ ...PERF_LEVELS[level], ...overrides })

/** Under six gigabytes the app offers Light once. It never switches by itself. */
export const suggestsLight = (totalMemoryGb: number | undefined): boolean =>
  typeof totalMemoryGb === 'number' && totalMemoryGb < 6

const KEY = 'sykord_perf'

interface PerfState { level: PerfLevel; overrides: Partial<PerfSwitches>; dismissedSuggestion: boolean }
const DEFAULT_STATE: PerfState = { level: 'full', overrides: {}, dismissedSuggestion: false }

const load = (): PerfState => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const level: PerfLevel = raw.level === 'balanced' || raw.level === 'light' ? raw.level : 'full'
    const overrides = raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {}
    return { level, overrides, dismissedSuggestion: raw.dismissedSuggestion === true }
  } catch { return { ...DEFAULT_STATE } }
}

export const perfState = reactive<PerfState>(load())
export const perf = reactive<PerfSwitches>(resolve(perfState.level, perfState.overrides))

const save = () => localStorage.setItem(KEY, JSON.stringify({
  level: perfState.level, overrides: perfState.overrides, dismissedSuggestion: perfState.dismissedSuggestion,
}))

const apply = () => { Object.assign(perf, resolve(perfState.level, perfState.overrides)); save() }

export const setPerfLevel = (level: PerfLevel) => { perfState.level = level; perfState.overrides = {}; apply() }
export const setPerfOverride = <K extends keyof PerfSwitches>(key: K, value: PerfSwitches[K]) => {
  perfState.overrides = { ...perfState.overrides, [key]: value }; apply()
}
export const clearPerfOverrides = () => { perfState.overrides = {}; apply() }
export const dismissSuggestion = () => { perfState.dismissedSuggestion = true; save() }

/** What the shell started with, so the page can say a restart is needed. */
export const restartNeeded = (applied: Pick<PerfSwitches, RestartKey> | null): boolean =>
  applied !== null && RESTART_KEYS.some(k => applied[k] !== perf[k])

/**
 * Motion has one owner.
 *
 * `useAppearance` used to write `data-motion` itself; it now leaves it to this,
 * because two writers of one attribute means whoever ran last wins. The
 * person's own "reduce motion" always beats the level: asking for less motion
 * is never overridden by a performance level asking for more.
 */
export const effectiveMotion = computed<'full' | 'reduced' | 'off'>(() =>
  appearance.reduceMotion ? 'off' : perf.motion)

watch(effectiveMotion, (m) => {
  const root = document.documentElement
  if (m === 'full') delete root.dataset.motion
  else root.dataset.motion = m
}, { immediate: true })
```

with `import { appearance } from './useAppearance'` at the top. The dependency runs one way only — performance reads appearance, never the reverse — so there is no cycle.

Then remove the old writer in `src/composables/useAppearance.ts` (the `if (a.reduceMotion) root.dataset.motion = 'off'` line, currently line 169), and import `usePerformance` in `src/main.ts` beside the appearance restore, so the attribute is set before first paint.

Finally add the middle state to `src/styles/tokens.css`, beside the existing `:root[data-motion="off"]` block (line 843):

```css
/* Balanced: the bands, halved. Still alive, half the work. Off stays off. */
:root[data-motion="reduced"] {
  --dur-1: 60ms;
  --dur-2: 90ms;
  --dur-3: 120ms;
  --dur-4: 170ms;
  --dur-exit: 70ms;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/composables/__tests__/usePerformance.test.ts`
Expected: PASS, 9 tests.

Note: the tests import only pure exports, but the module — and `useAppearance`, which it imports for the motion rule — touches browser globals at load, and the repo's Vitest runs in the node environment. If the run reports `localStorage is not defined` or `matchMedia is not a function`, put these three stubs above the imports in the test file:

```ts
globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
globalThis.document = { documentElement: { dataset: {} } } as unknown as Document
globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
```

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/composables/usePerformance.ts src/composables/__tests__/usePerformance.test.ts
git commit -m "feat(perf): levels, switches and the rule that suggests Light"
```

---

## Task 3: Eviction in the message store

**Files:**
- Modify: `src/composables/useMessages.ts`
- Create: `src/composables/__tests__/messageEviction.test.ts`

**Interfaces:**
- Consumes: `perf.keepConversations`, `perf.messagesPerConversation` from Task 2.
- Produces, added to the object `useMessages()` returns:
  - `touchConversation(kind: ConvKind, id: string): void`
  - `evict(current: { kind: ConvKind; id: string } | null): void`
  - `evictedCount(): number` (for the test and the readout)

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/messageEviction.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessages } from '../useMessages'
import { setPerfLevel } from '../usePerformance'
import type { Message } from '@/types'

const msg = (n: number): Message => ({
  id: n, author: 'M', authorId: 'u1', content: `m${n}`, time: '12:00',
  timestamp: n, avatar: '', reactions: [], dbId: `db${n}`,
})
const many = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1))

describe('eviction', () => {
  const m = useMessages()

  beforeEach(() => {
    for (const id of ['c1', 'c2', 'c3', 'c4']) m.initChannel(id, [])
    setPerfLevel('balanced')
  })

  it('keeps every message at full', () => {
    setPerfLevel('full')
    m.initChannel('c1', many(500))
    m.evict({ kind: 'channel', id: 'c1' })
    expect(m.getChannelMessages('c1')).toHaveLength(500)
  })

  it('trims a conversation to the cap, dropping the oldest', () => {
    m.initChannel('c1', many(500))
    m.evict({ kind: 'channel', id: 'c1' })
    const kept = m.getChannelMessages('c1')
    expect(kept).toHaveLength(200)
    expect(kept[0].content).toBe('m301')
    expect(kept[kept.length - 1].content).toBe('m500')
  })

  it('says there is more above after trimming, so scrolling up refetches', () => {
    m.initChannel('c1', many(500))
    m.setWindow('channel', 'c1', many(500), { hasOlder: false, hasNewer: false })
    m.evict({ kind: 'channel', id: 'c1' })
    expect(m.windowOf('channel', 'c1').hasOlder).toBe(true)
  })

  it('drops the least recently opened conversations beyond the limit', () => {
    for (const id of ['c1', 'c2', 'c3', 'c4']) { m.initChannel(id, many(10)); m.touchConversation('channel', id) }
    m.evict({ kind: 'channel', id: 'c4' })
    expect(m.getChannelMessages('c1')).toHaveLength(0)
    expect(m.getChannelMessages('c2')).toHaveLength(10)
    expect(m.getChannelMessages('c4')).toHaveLength(10)
  })

  it('never evicts the conversation being read, however old its last touch', () => {
    for (const id of ['c1', 'c2', 'c3', 'c4']) { m.initChannel(id, many(10)); m.touchConversation('channel', id) }
    m.evict({ kind: 'channel', id: 'c1' })
    expect(m.getChannelMessages('c1')).toHaveLength(10)
  })

  it('leaves the other kinds alone when a channel is evicted', () => {
    m.initDM('d1', many(10)); m.touchConversation('dm', 'd1')
    for (const id of ['c1', 'c2', 'c3', 'c4']) { m.initChannel(id, many(10)); m.touchConversation('channel', id) }
    m.evict({ kind: 'channel', id: 'c4' })
    expect(m.getDMMessages('d1')).toHaveLength(10)
  })
})
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npx vitest run src/composables/__tests__/messageEviction.test.ts`
Expected: FAIL, `m.touchConversation is not a function`.

- [ ] **Step 3: Implement eviction**

In `src/composables/useMessages.ts`, add the import at the top:

```ts
import { perf } from './usePerformance'
```

Add module-level state beside `windowMeta` (after line 30):

```ts
/** When each conversation was last opened, for the least-recently-used limit. */
const touched: Record<string, number> = {}
let touchClock = 0
let evicted = 0
```

Add inside `useMessages()`, before the `return`:

```ts
  const touchConversation = (kind: ConvKind, id: string) => { touched[metaKey(kind, id)] = ++touchClock }

  /** Trim each conversation to the cap, then drop the least recently opened
   *  ones beyond the limit. The conversation on screen is never touched: its
   *  messages are what the person is reading. */
  const evict = (current: { kind: ConvKind; id: string } | null) => {
    const currentKey = current ? metaKey(current.kind, current.id) : ''
    const cap = perf.messagesPerConversation
    const keep = perf.keepConversations

    if (Number.isFinite(cap)) {
      for (const kind of ['dm', 'group', 'channel'] as ConvKind[]) {
        const store = listFor(kind)
        for (const [id, list] of Object.entries(store.value)) {
          if (list.length <= cap) continue
          store.value[id] = list.slice(list.length - cap)
          const key = metaKey(kind, id)
          windowMeta.value[key] = { ...windowOf(kind, id), hasOlder: true }
          evicted += list.length - cap
        }
      }
    }

    if (!Number.isFinite(keep)) return
    const loaded: { key: string; kind: ConvKind; id: string; at: number }[] = []
    for (const kind of ['dm', 'group', 'channel'] as ConvKind[]) {
      for (const [id, list] of Object.entries(listFor(kind).value)) {
        if (!list.length) continue
        const key = metaKey(kind, id)
        if (key !== currentKey) loaded.push({ key, kind, id, at: touched[key] ?? 0 })
      }
    }
    const spare = Math.max(0, keep - (current ? 1 : 0))
    loaded.sort((a, b) => b.at - a.at)
    for (const gone of loaded.slice(spare)) {
      evicted += listFor(gone.kind).value[gone.id]?.length ?? 0
      listFor(gone.kind).value[gone.id] = []
      delete windowMeta.value[gone.key]
      delete touched[gone.key]
    }
  }

  const evictedCount = () => evicted
```

Add the three names to the returned object:

```ts
    windowMeta, windowOf, setWindow, prependOlder, appendNewer, holdIfAway,
    touchConversation, evict, evictedCount,
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/composables/__tests__/messageEviction.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Call it when the conversation changes**

In `src/views/ChatApp.vue`, find where the open conversation changes (the watcher that loads a channel's history) and add, after the history has loaded:

```ts
  messages.touchConversation(kind, id)
  messages.evict({ kind, id })
```

`kind` is `'channel' | 'dm' | 'group'` as that watcher already knows it, and `messages` is the existing `useMessages()` instance in that file.

- [ ] **Step 6: Check the whole suite and the types**

Run: `npx vitest run && npm run typecheck`
Expected: every test passes, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useMessages.ts src/composables/__tests__/messageEviction.test.ts src/views/ChatApp.vue
git commit -m "feat(perf): forget conversations nobody is reading"
```

---

## Task 4: Animated images wait for a tap

**Files:**
- Modify: `src/composables/useGifPlayback.ts`
- Create: `src/composables/__tests__/gifPlayback.test.ts`
- Modify: `src/components/ui/AnimatedImage.vue`, `src/components/ui/Avatar.vue`, `src/components/modals/GifPickerModal.vue`

**Interfaces:**
- Consumes: `perf.animatedMedia` from Task 2.
- Produces, from `useGifPlayback.ts`:
  - `type PlaybackReason = 'always' | 'hover' | 'burst' | 'tap' | 'never'`
  - `playbackPolicy(o: { animated: boolean; alwaysAnimate: boolean; reduced: boolean; tapOnly: boolean; hasHover: boolean }): PlaybackReason`
  - `useTapToPlay(): { played: Ref<boolean>; play(): void }` — one image's "it was tapped, run a burst" state

**What is already there, and is not rebuilt:** animated avatars and banners already hold still and play on hover, or in a shared burst on touch devices, and `freezeFrame()` already makes the still. This task adds one more reason to hold still — the level — and a deliberate tap as the way to play. KLIPY GIFs are cross-origin, so `freezeFrame` returns null for them; those use `ApiGif.preview` instead, which the API already returns beside `full`.

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/gifPlayback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { playbackPolicy } from '../useGifPlayback'

const base = { animated: true, alwaysAnimate: false, reduced: false, tapOnly: false, hasHover: true }

describe('playbackPolicy', () => {
  it('plays a still image always — there is nothing to hold back', () => {
    expect(playbackPolicy({ ...base, animated: false })).toBe('always')
  })

  it('plays when the caller insists, as the crop editor does', () => {
    expect(playbackPolicy({ ...base, alwaysAnimate: true })).toBe('always')
  })

  it('never plays under reduced motion, whatever the level says', () => {
    expect(playbackPolicy({ ...base, reduced: true })).toBe('never')
    expect(playbackPolicy({ ...base, reduced: true, tapOnly: true })).toBe('never')
  })

  it('waits for a tap when the level says so, even where hover exists', () => {
    expect(playbackPolicy({ ...base, tapOnly: true })).toBe('tap')
    expect(playbackPolicy({ ...base, tapOnly: true, hasHover: false })).toBe('tap')
  })

  it('keeps today\'s behaviour when the level is not asking: hover, or the shared burst', () => {
    expect(playbackPolicy(base)).toBe('hover')
    expect(playbackPolicy({ ...base, hasHover: false })).toBe('burst')
  })
})
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npx vitest run src/composables/__tests__/gifPlayback.test.ts`
Expected: FAIL, `playbackPolicy is not a function`.

- [ ] **Step 3: Add the policy and the tap**

In `src/composables/useGifPlayback.ts`, add:

```ts
import { computed, ref, type Ref } from 'vue'
import { perf } from './usePerformance'

export type PlaybackReason = 'always' | 'hover' | 'burst' | 'tap' | 'never'

/**
 * Why an animated image would play, in one place, so the components only ask
 * "which reason applies to me?".
 *
 * Reduced motion outranks everything: a person who asked for stillness does not
 * get motion back because a performance level allows it. The level can only
 * take motion away, never add it.
 */
export const playbackPolicy = (o: {
  animated: boolean; alwaysAnimate: boolean; reduced: boolean; tapOnly: boolean; hasHover: boolean
}): PlaybackReason => {
  if (!o.animated || o.alwaysAnimate) return 'always'
  if (o.reduced) return 'never'
  if (o.tapOnly) return 'tap'
  return o.hasHover ? 'hover' : 'burst'
}

/** The level's answer, read where a component needs it. */
export const tapOnly = computed(() => perf.animatedMedia === 'tap')

/** One image's "somebody tapped it": plays a single burst, then holds still again. */
export const useTapToPlay = (): { played: Ref<boolean>; play: () => void } => {
  const played = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  const play = () => {
    played.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { played.value = false }, BURST_MS)
  }
  return { played, play }
}
```

Also skip the shared timer entirely when the level says tap-only — a wake-up every forty seconds is exactly the kind of background cost this feature exists to remove. In `useGifBurst`, widen the early return:

```ts
  if (hasHover || reduced || tapOnly.value) return { bursting: ref(false) }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/composables/__tests__/gifPlayback.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Use it in the three places that animate**

`src/components/ui/AnimatedImage.vue` and `src/components/ui/Avatar.vue`: replace the hand-rolled `playing` computed with the policy, and let a tap play it:

```ts
const { played, play } = useTapToPlay()
const reason = computed(() => playbackPolicy({
  animated: animated.value, alwaysAnimate: props.alwaysAnimate,
  reduced: !motionAllowed, tapOnly: tapOnly.value, hasHover,
}))
const playing = computed(() =>
  reason.value === 'always' ? true :
  reason.value === 'never' ? false :
  reason.value === 'hover' ? hovering.value :
  reason.value === 'burst' ? bursting.value :
  played.value)
```

When `reason.value === 'tap'`, the image is wrapped in a real `<button type="button" @click="play">` whose `aria-label` is `Play ${alt}` while still. In every other case the markup stays exactly as it is — no button appears where hover already works.

`src/components/modals/GifPickerModal.vue`: results render `gif.preview` while `tapOnly` and untapped, and `gif.full` once played or when the level allows motion. `ApiGif` already carries both.

- [ ] **Step 6: Check it by hand**

Set Balanced (until Task 6 exists: put `{"level":"balanced","overrides":{},"dismissedSuggestion":false}` in `localStorage.sykord_perf` and reload). Then: avatars in a member list hold still and no longer play on hover; clicking one plays it once; the GIF picker shows previews until clicked; at Full everything behaves exactly as it does today; with the OS set to reduce motion, nothing plays at any level.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useGifPlayback.ts src/composables/__tests__/gifPlayback.test.ts src/components/ui/AnimatedImage.vue src/components/ui/Avatar.vue src/components/modals/GifPickerModal.vue
git commit -m "feat(perf): animated pictures wait for a tap below Full"
```

---

## Task 5: Call limits

**Files:**
- Create: `src/composables/callLimits.ts`
- Create: `src/composables/__tests__/callLimits.test.ts`
- Modify: `src/components/voice/CallStage.vue`, `src/composables/useVoice.ts`

**Interfaces:**
- Consumes: `perf.maxCallTiles`, `perf.incomingVideo`, `perf.pauseVideoWhenHidden`.
- Produces:
  - `interface TileCandidate { id: string; isSelf: boolean; speaking: boolean; hasVideo: boolean; lastSpokeAt: number }`
  - `visibleTiles(all: TileCandidate[], max: number): string[]`
  - `qualityFor(cap: 'auto' | '720p' | '360p'): 'high' | 'medium' | 'low' | null`

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/callLimits.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { visibleTiles, qualityFor, type TileCandidate } from '../callLimits'

const t = (id: string, o: Partial<TileCandidate> = {}): TileCandidate =>
  ({ id, isSelf: false, speaking: false, hasVideo: true, lastSpokeAt: 0, ...o })

describe('visibleTiles', () => {
  it('shows everyone when there is no cap', () => {
    expect(visibleTiles([t('a'), t('b'), t('c')], Infinity)).toEqual(['a', 'b', 'c'])
  })

  it('keeps whoever is speaking', () => {
    const tiles = [t('a', { lastSpokeAt: 1 }), t('b', { speaking: true }), t('c', { lastSpokeAt: 2 })]
    expect(visibleTiles(tiles, 2)).toContain('b')
  })

  it('fills the rest with whoever spoke most recently', () => {
    const tiles = [t('a', { lastSpokeAt: 1 }), t('b', { lastSpokeAt: 9 }), t('c', { lastSpokeAt: 5 })]
    expect(visibleTiles(tiles, 2)).toEqual(['b', 'c'])
  })

  it('always keeps you, so your own camera never vanishes', () => {
    const tiles = [t('me', { isSelf: true, lastSpokeAt: 0 }), t('b', { lastSpokeAt: 9 }), t('c', { lastSpokeAt: 8 })]
    expect(visibleTiles(tiles, 2)).toContain('me')
  })

  it('prefers a camera to an avatar when the rest are equal', () => {
    const tiles = [t('a', { hasVideo: false }), t('b', { hasVideo: true })]
    expect(visibleTiles(tiles, 1)).toEqual(['b'])
  })
})

describe('qualityFor', () => {
  it('asks for nothing special when the cap is auto', () => {
    expect(qualityFor('auto')).toBeNull()
  })

  it('maps the caps onto the qualities LiveKit understands', () => {
    expect(qualityFor('720p')).toBe('high')
    expect(qualityFor('360p')).toBe('low')
  })
})
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npx vitest run src/composables/__tests__/callLimits.test.ts`
Expected: FAIL, cannot resolve `../callLimits`.

- [ ] **Step 3: Write the module**

`src/composables/callLimits.ts`:

```ts
/**
 * Who gets a video tile when there is a cap, and how good the incoming video
 * should be. Pure, so the rule can be tested without a call.
 *
 * Order: whoever is speaking, then whoever spoke most recently, and a camera
 * before an avatar when those are equal. You are always kept — a call where
 * your own camera disappears reads as broken, not as thrifty.
 */
export interface TileCandidate {
  id: string
  isSelf: boolean
  speaking: boolean
  hasVideo: boolean
  lastSpokeAt: number
}

export const visibleTiles = (all: TileCandidate[], max: number): string[] => {
  if (!Number.isFinite(max) || all.length <= max) return all.map(t => t.id)
  const self = all.filter(t => t.isSelf)
  const rest = all.filter(t => !t.isSelf).sort((a, b) =>
    Number(b.speaking) - Number(a.speaking) ||
    b.lastSpokeAt - a.lastSpokeAt ||
    Number(b.hasVideo) - Number(a.hasVideo))
  return [...self, ...rest].slice(0, max).map(t => t.id)
}

/** null = leave it to LiveKit's own adaptive streaming, which is the default. */
export const qualityFor = (cap: 'auto' | '720p' | '360p'): 'high' | 'medium' | 'low' | null =>
  cap === 'auto' ? null : cap === '720p' ? 'high' : 'low'
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/composables/__tests__/callLimits.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into the call**

In `src/components/voice/CallStage.vue`, compute the rendered tiles through `visibleTiles(candidates.value, perf.maxCallTiles)` and render the participants left out as a row of names under the grid, with the count, e.g. "+3 not shown to save memory".

In `src/composables/useVoice.ts`, where remote tracks are subscribed, apply the quality when it is not null:

```ts
import { VideoQuality } from 'livekit-client'
import { qualityFor } from './callLimits'
import { perf } from './usePerformance'

const QUALITY = { high: VideoQuality.HIGH, medium: VideoQuality.MEDIUM, low: VideoQuality.LOW } as const
const applyQuality = (pub: RemoteTrackPublication) => {
  const q = qualityFor(perf.incomingVideo)
  if (q) pub.setVideoQuality(QUALITY[q])
}
```

Call `applyQuality` for each remote video publication on subscribe and whenever `perf.incomingVideo` changes.

Add the hidden-window pause in the same file:

```ts
// Video is expensive and unwatched when the window is hidden; audio never pauses.
const remoteVideo = (r: Room) => [...r.remoteParticipants.values()]
  .flatMap(p => [...p.videoTrackPublications.values()])

document.addEventListener('visibilitychange', () => {
  const r = room.value
  if (!r || !perf.pauseVideoWhenHidden) return
  const hidden = document.visibilityState === 'hidden'
  for (const pub of remoteVideo(r)) pub.setEnabled(!hidden)
})
```

`room` is the existing ref in `useVoice.ts` holding the connected `Room`; `setEnabled(false)` stops the stream being sent to this client and `true` resumes it, which is what `adaptiveStream` does for off-screen tiles already.

- [ ] **Step 6: Check it by hand**

Two browsers on the dev stack, both in a call with cameras on: at Balanced the fourth camera becomes a name, at Light the third does; minimising the window stops incoming video and audio keeps going; back at Full, everything returns without rejoining.

- [ ] **Step 7: Commit**

```bash
git add src/composables/callLimits.ts src/composables/__tests__/callLimits.test.ts src/components/voice/CallStage.vue src/composables/useVoice.ts
git commit -m "feat(perf): cap the tiles and the incoming video in a call"
```

---

## Task 6: The Performance page

**Files:**
- Create: `src/components/settings/PerformancePage.vue`
- Modify: `src/components/modals/SettingsModal.vue` (nav item at the App Settings group, import and render the page)

**Interfaces:**
- Consumes: everything Task 2 exports; `window.skycordDesktop.performance` from Task 7 when it exists.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the page**

`src/components/settings/PerformancePage.vue`. It reuses the settings classes the other pages use (`st-card`, `st-field`, `st-field-left`, `st-field-label`, `st-field-value`, `st-btn`), so it inherits their tokens and spacing:

```vue
<script setup lang="ts">
/**
 * Settings › Performance. Three levels, the switches underneath for anyone who
 * wants them, and the real number.
 *
 * Every line says what it costs rather than what it saves: the saving depends
 * on the machine, and the readout below shows the truth for this one.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { desktopBridge } from '@/composables/desktopBridge'
import {
  perf, perfState, setPerfLevel, setPerfOverride, clearPerfOverrides,
  dismissSuggestion, suggestsLight, restartNeeded, type PerfLevel,
} from '@/composables/usePerformance'

const desktop = desktopBridge()

const LEVELS: { id: PerfLevel; name: string; line: string }[] = [
  { id: 'full', name: 'Full', line: 'Everything on. The default.' },
  { id: 'balanced', name: 'Balanced', line: 'Keeps three conversations in memory, four cameras at once, pictures that wait for a tap, and less motion.' },
  { id: 'light', name: 'Light', line: 'One conversation, two cameras, no motion, the plain Windows title bar, and the graphics card off. Best on an old machine, and video may look worse.' },
]

const memory = ref<{ privateMb: number; workingSetMb: number } | null>(null)
const applied = ref<{ skycordTitleBar: boolean; hardwareAcceleration: boolean; heapCapMb: number | null } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const readMemory = async () => { memory.value = (await desktop?.performance?.memory()) ?? null }
onMounted(async () => {
  applied.value = (await desktop?.performance?.applied()) ?? null
  await readMemory()
  timer = setInterval(readMemory, 5000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

/** The web can only see its own JavaScript heap, and says so. */
const heapMb = computed(() => {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return m ? Math.round(m.usedJSHeapSize / 1024 / 1024) : null
})
const deviceGb = computed(() => (navigator as { deviceMemory?: number }).deviceMemory)
const offerLight = computed(() =>
  perfState.level === 'full' && !perfState.dismissedSuggestion && suggestsLight(deviceGb.value))
const needsRestart = computed(() => restartNeeded(applied.value))
const overridden = computed(() => Object.keys(perfState.overrides).length > 0)
</script>

<template>
  <div class="st-card" v-if="offerLight">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">This machine has little memory</span>
        <span class="st-field-value">Light trades some looks for room to breathe. You can change it back any time.</span>
      </div>
      <button type="button" class="st-btn" @click="setPerfLevel('light')">Use Light</button>
      <button type="button" class="st-btn" @click="dismissSuggestion()">No thanks</button>
    </div>
  </div>

  <div class="st-card">
    <div class="levels" role="group" aria-label="Performance level">
      <button
        v-for="l in LEVELS" :key="l.id" type="button" class="level"
        :aria-pressed="perfState.level === l.id" @click="setPerfLevel(l.id)"
      >
        <span class="level-name">{{ l.name }}</span>
        <span class="level-line">{{ l.line }}</span>
      </button>
    </div>
  </div>

  <div class="st-card" v-if="needsRestart">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Restart to finish</span>
        <span class="st-field-value">The title bar, the graphics card and the memory ceiling only change when Skycord starts.</span>
      </div>
      <button type="button" class="st-btn" @click="desktop?.performance?.restart()">Restart now</button>
    </div>
  </div>

  <div class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Memory in use</span>
        <span class="st-field-value" v-if="memory">{{ memory.privateMb }} MB, across every part of the app</span>
        <span class="st-field-value" v-else-if="heapMb !== null">{{ heapMb }} MB of the page's own memory. A browser tab costs more than this on top.</span>
        <span class="st-field-value" v-else>This browser does not say.</span>
      </div>
    </div>
  </div>

  <details class="st-card">
    <summary class="st-field-label">Advanced</summary>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Conversations kept in memory</span>
        <span class="st-field-value">Fewer means less memory, and a short wait when you go back to one.</span>
      </div>
      <select :value="String(perf.keepConversations)" @change="setPerfOverride('keepConversations', Number(($event.target as HTMLSelectElement).value))">
        <option value="Infinity">Every one</option><option value="3">Three</option><option value="1">Just this one</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Messages kept per conversation</span>
        <span class="st-field-value">Scrolling up loads the rest again.</span>
      </div>
      <select :value="String(perf.messagesPerConversation)" @change="setPerfOverride('messagesPerConversation', Number(($event.target as HTMLSelectElement).value))">
        <option value="Infinity">All of them</option><option value="200">200</option><option value="100">100</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Animated pictures</span>
        <span class="st-field-value">Waiting for a tap stops a wall of GIFs decoding at once.</span>
      </div>
      <select :value="perf.animatedMedia" @change="setPerfOverride('animatedMedia', ($event.target as HTMLSelectElement).value as 'play' | 'tap')">
        <option value="play">Play on their own</option><option value="tap">Wait for a tap</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Cameras shown at once in a call</span>
        <span class="st-field-value">The rest become names. Everyone still hears everyone.</span>
      </div>
      <select :value="String(perf.maxCallTiles)" @change="setPerfOverride('maxCallTiles', Number(($event.target as HTMLSelectElement).value))">
        <option value="Infinity">All of them</option><option value="4">Four</option><option value="2">Two</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Incoming video quality</span>
        <span class="st-field-value">Lower is easier to decode on an old machine.</span>
      </div>
      <select :value="perf.incomingVideo" @change="setPerfOverride('incomingVideo', ($event.target as HTMLSelectElement).value as 'auto' | '720p' | '360p')">
        <option value="auto">Automatic</option><option value="720p">Up to 720p</option><option value="360p">Up to 360p</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Pause video when the window is hidden</span>
        <span class="st-field-value">Sound always keeps going.</span>
      </div>
      <input type="checkbox" :checked="perf.pauseVideoWhenHidden" @change="setPerfOverride('pauseVideoWhenHidden', ($event.target as HTMLInputElement).checked)">
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Motion</span>
        <span class="st-field-value">Your own reduce-motion setting always wins over this.</span>
      </div>
      <select :value="perf.motion" @change="setPerfOverride('motion', ($event.target as HTMLSelectElement).value as 'full' | 'reduced' | 'off')">
        <option value="full">Full</option><option value="reduced">Less</option><option value="off">None</option>
      </select>
    </div>

    <template v-if="desktop">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Skycord's title bar</span>
          <span class="st-field-value">Turning it off uses the plain Windows one and saves a whole process. Takes effect on restart.</span>
        </div>
        <input type="checkbox" :checked="perf.skycordTitleBar" @change="setPerfOverride('skycordTitleBar', ($event.target as HTMLInputElement).checked)">
      </div>

      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Use the graphics card</span>
          <span class="st-field-value">Off removes a process and can make video worse. Takes effect on restart.</span>
        </div>
        <input type="checkbox" :checked="perf.hardwareAcceleration" @change="setPerfOverride('hardwareAcceleration', ($event.target as HTMLInputElement).checked)">
      </div>

      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Memory ceiling</span>
          <span class="st-field-value">A cap makes the app tidy up sooner instead of holding on. Takes effect on restart.</span>
        </div>
        <select :value="String(perf.heapCapMb ?? 0)" @change="setPerfOverride('heapCapMb', Number(($event.target as HTMLSelectElement).value) || null)">
          <option value="0">No cap</option><option value="256">256 MB</option><option value="192">192 MB</option>
        </select>
      </div>
    </template>

    <div class="st-field" v-if="overridden">
      <div class="st-field-left">
        <span class="st-field-label">You have changed some switches by hand</span>
        <span class="st-field-value">Putting them back leaves the level as it was.</span>
      </div>
      <button type="button" class="st-btn" @click="clearPerfOverrides()">Back to the level</button>
    </div>
  </details>
</template>

<style scoped>
.levels { display: flex; flex-direction: column; gap: 8px; }
.level {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
  min-height: 40px; padding: 12px 14px; text-align: left;
  border: 1px solid var(--border); border-radius: var(--edge-lg);
  background: var(--bg-input); color: var(--text-1); font: inherit;
  transition: background var(--dur-1) var(--ease-out);
}
.level:hover { background: var(--hover); }
.level[aria-pressed="true"] { border-color: var(--accent); background: rgba(var(--accent-rgb), .12); }
.level-name { font-weight: 700; font-size: 15px; }
.level-line { font-size: 13px; color: var(--text-2); line-height: 1.4; }
</style>
```

Checks the reviewer should make on this step: every control has a label, the level buttons carry `aria-pressed`, nothing is smaller than 40px, and no hex value appears outside `rgba(var(--accent-rgb), …)`.

- [ ] **Step 2: Add it to Settings**

In `src/components/modals/SettingsModal.vue`, import the page beside the others:

```ts
import PerformancePage from '@/components/settings/PerformancePage.vue'
```

Add the nav item after Keybinds in the App Settings group:

```ts
      { id: 'performance', label: 'Performance' },
```

Render it where the other pages render:

```vue
            <PerformancePage v-else-if="page === 'performance'" />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Check it by hand**

In the dev stack: the page opens from Settings; switching level changes GIF behaviour and the call cap immediately; an override survives a reload; the desktop-only switches are absent in a browser; every control is reachable by Tab and the level cards announce their pressed state.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/PerformancePage.vue src/components/modals/SettingsModal.vue
git commit -m "feat(perf): a Performance page that says what each level costs"
```

---

## Task 7: The shell applies the process-level switches

**Files:**
- Create: `desktop/src/perf.ts`
- Create: `desktop/src/__tests__/perf.test.ts`
- Modify: `desktop/src/store.ts`, `desktop/src/main.ts`, `desktop/src/appWindow.ts`, `desktop/src/preload.ts`, `src/composables/desktopBridge.ts`

**Interfaces:**
- Consumes: the level the page saves (Task 2), sent over the bridge.
- Produces:
  - `desktop/src/perf.ts`: `interface ShellPerf { skycordTitleBar: boolean; hardwareAcceleration: boolean; heapCapMb: number | null }`, `readShellPerf(stored: unknown): ShellPerf`, `flagsFor(p: ShellPerf): { disableHardwareAcceleration: boolean; jsFlags: string | null }`, `readTrimMinutes(stored: unknown): number | null`
  - `store.ts`: `Stored` gains `perf?: unknown`
  - preload: `skycordDesktop.performance = { level(level: string, switches: unknown): void; memory(): Promise<{ privateMb: number; workingSetMb: number }>; applied(): Promise<ShellPerf>; restart(): void }`

- [ ] **Step 1: Write the failing tests**

`desktop/src/__tests__/perf.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readShellPerf, flagsFor } from '../perf'

describe('readShellPerf', () => {
  it('is the full experience when nothing is stored', () => {
    expect(readShellPerf(undefined)).toEqual({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null })
  })

  it('reads the three switches it cares about', () => {
    expect(readShellPerf({ skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192 }))
      .toEqual({ skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192 })
  })

  it('refuses nonsense rather than trusting the file', () => {
    expect(readShellPerf({ skycordTitleBar: 'no', hardwareAcceleration: 1, heapCapMb: 'lots' }))
      .toEqual({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null })
  })

  it('keeps a heap cap inside a sane range', () => {
    expect(readShellPerf({ heapCapMb: 8 }).heapCapMb).toBeNull()
    expect(readShellPerf({ heapCapMb: 9000 }).heapCapMb).toBeNull()
    expect(readShellPerf({ heapCapMb: 256 }).heapCapMb).toBe(256)
  })
})

describe('flagsFor', () => {
  it('asks for nothing at the full experience', () => {
    expect(flagsFor({ skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null }))
      .toEqual({ disableHardwareAcceleration: false, jsFlags: null })
  })

  it('turns off the graphics card and caps the heap for Light', () => {
    expect(flagsFor({ skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192 }))
      .toEqual({ disableHardwareAcceleration: true, jsFlags: '--max-old-space-size=192' })
  })
})
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npx vitest run desktop/src/__tests__/perf.test.ts`
Expected: FAIL, cannot resolve `../perf`.

- [ ] **Step 3: Write `desktop/src/perf.ts`**

```ts
/**
 * The three switches Chromium only reads at startup, and what the shell does
 * with them. Read from the store before the app is ready, and never trusted as
 * written: the file is editable by anything running as the user.
 */
export interface ShellPerf {
  skycordTitleBar: boolean
  hardwareAcceleration: boolean
  heapCapMb: number | null
}

const DEFAULTS: ShellPerf = { skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null }

/** A heap ceiling under 64 MB cannot hold a Chromium page, and over 4096 is not a cap. */
const heapOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 64 && v <= 4096 ? Math.round(v) : null

export const readShellPerf = (stored: unknown): ShellPerf => {
  if (!stored || typeof stored !== 'object') return { ...DEFAULTS }
  const s = stored as Record<string, unknown>
  return {
    skycordTitleBar: typeof s.skycordTitleBar === 'boolean' ? s.skycordTitleBar : DEFAULTS.skycordTitleBar,
    hardwareAcceleration: typeof s.hardwareAcceleration === 'boolean' ? s.hardwareAcceleration : DEFAULTS.hardwareAcceleration,
    heapCapMb: heapOf(s.heapCapMb),
  }
}

export const flagsFor = (p: ShellPerf) => ({
  disableHardwareAcceleration: !p.hardwareAcceleration,
  jsFlags: p.heapCapMb === null ? null : `--max-old-space-size=${p.heapCapMb}`,
})
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run desktop/src/__tests__/perf.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Store the switches**

In `desktop/src/store.ts`, widen the interface:

```ts
export interface Stored { instanceOrigin?: string; servers?: unknown; share?: unknown; perf?: unknown }
```

- [ ] **Step 6: Apply the flags before the app is ready**

In `desktop/src/main.ts`, beside the existing pre-ready switch (after line 36):

```ts
// Chromium reads these at startup only, so they come from what was saved last
// time; changing them in Settings asks for a restart rather than lying.
const shellPerf = readShellPerf(readStore().perf)
const perfFlags = flagsFor(shellPerf)
if (perfFlags.disableHardwareAcceleration) app.disableHardwareAcceleration()
if (perfFlags.jsFlags) app.commandLine.appendSwitch('js-flags', perfFlags.jsFlags)
```

with `import { readShellPerf, flagsFor, type ShellPerf } from './perf'` at the top.

- [ ] **Step 7: Build the window the level asks for**

In `desktop/src/appWindow.ts`, give `createAppWindow` a third parameter `skycordTitleBar: boolean`. When it is false: create the window with `frame: true`, no `titleBarStyle`, no `titleBarOverlay`, no `WebContentsView` and no title-bar page — the instance page becomes the window's own `webContents`, `page` returns it, `setTitle` calls `win.setTitle(state.title)`, `setColors` does nothing, and `layout()` is not needed. The signature and the rest of the shape stay as they are, so `main.ts` does not care which window it got. Pass `shellPerf.skycordTitleBar` at the one call site.

- [ ] **Step 8: Carry the level over the bridge**

In `desktop/src/preload.ts`, inside the `skycordDesktop` object:

```ts
    performance: {
      // The page decides; the shell stores it for the next start.
      level: (level: string, switches: unknown) => ipcRenderer.send('desktop:perf', { level, switches }),
      memory: () => ipcRenderer.invoke('desktop:perfMemory'),
      applied: () => ipcRenderer.invoke('desktop:perfApplied'),
      restart: () => ipcRenderer.send('desktop:perfRestart'),
    },
```

In `desktop/src/main.ts`, beside the other handlers, with `guard`-style sender checks matching the existing ones:

```ts
ipcMain.on('desktop:perf', (event, payload: unknown) => {
  if (!fromInstance(event)) return
  const p = payload as { switches?: unknown } | null
  const next = readShellPerf(p?.switches)
  writeStore({ ...readStore(), perf: next })
  trimMinutes = readTrimMinutes(p?.switches)
})
ipcMain.handle('desktop:perfApplied', (event): ShellPerf | null => fromInstance(event) ? shellPerf : null)
ipcMain.handle('desktop:perfMemory', (event) => {
  if (!fromInstance(event)) return null
  const metrics = app.getAppMetrics()
  const sum = (pick: (m: Electron.ProcessMetric) => number) => metrics.reduce((t, m) => t + pick(m), 0)
  return {
    privateMb: Math.round(sum(m => m.memory.privateBytes ?? 0) / 1024),
    workingSetMb: Math.round(sum(m => m.memory.workingSetSize) / 1024),
  }
})
ipcMain.on('desktop:perfRestart', (event) => { if (!fromInstance(event)) return; app.relaunch(); app.exit(0) })
```

`fromInstance` is the existing check that the sender is the instance page (`desktop/src/main.ts:180`), used by every other `desktop:*` handler in that file. Reuse it; do not write a second one. `readTrimMinutes` comes from Step 9.

- [ ] **Step 9: Trim the renderer's caches when the window hides**

Add to `desktop/src/perf.ts`, with a test in the same file's suite asserting `readTrimMinutes({ imageTrimMinutes: 5 }) === 5`, `readTrimMinutes({ imageTrimMinutes: 0 }) === null` and `readTrimMinutes(undefined) === null`:

```ts
/** How long hidden before the page drops its decoded images; null = never. */
export const readTrimMinutes = (stored: unknown): number | null => {
  const v = (stored as Record<string, unknown> | null)?.imageTrimMinutes
  return typeof v === 'number' && v > 0 && v <= 60 ? v : null
}
```

In `desktop/src/preload.ts`, in the instance-page branch, import `webFrame` from electron and listen:

```ts
  // The shell asks when the window has been hidden a while. Only the renderer
  // can drop its own decoded images, and only webFrame reaches them.
  ipcRenderer.on('desktop:trimCache', () => webFrame.clearCache())
```

In `desktop/src/main.ts`, beside the window handling:

```ts
// Hidden and idle: let the page drop its decoded images. Never
// session.clearCache(), which would throw away the HTTP cache the next start
// depends on — that cache is what keeps the app from re-downloading itself.
let trimMinutes = readTrimMinutes(readStore().perf)
let trimTimer: ReturnType<typeof setTimeout> | null = null
const cancelTrim = () => { if (trimTimer) { clearTimeout(trimTimer); trimTimer = null } }
const armTrim = () => {
  cancelTrim()
  if (trimMinutes === null) return
  trimTimer = setTimeout(() => shellWin?.page.send('desktop:trimCache'), trimMinutes * 60_000)
}
```

and, where the window is created, wire it:

```ts
  shellWin.win.on('hide', armTrim)
  shellWin.win.on('blur', armTrim)
  shellWin.win.on('show', cancelTrim)
  shellWin.win.on('focus', cancelTrim)
```

with `readTrimMinutes` added to the `./perf` import.

- [ ] **Step 10: Declare the bridge in the client's types**

In `src/composables/desktopBridge.ts`, add to the bridge interface:

```ts
  performance?: {
    level(level: string, switches: unknown): void
    memory(): Promise<{ privateMb: number; workingSetMb: number } | null>
    applied(): Promise<{ skycordTitleBar: boolean; hardwareAcceleration: boolean; heapCapMb: number | null } | null>
    restart(): void
  }
```

and have `usePerformance`'s `apply()` call `bridge()?.performance?.level(perfState.level, { skycordTitleBar: perf.skycordTitleBar, hardwareAcceleration: perf.hardwareAcceleration, heapCapMb: perf.heapCapMb })` whenever it saves, guarded so the web build does nothing.

- [ ] **Step 11: Build, test, typecheck**

Run: `cd desktop && npm run build && cd .. && npx vitest run && npm run typecheck`
Expected: tsc clean, every test passes, no type errors.

- [ ] **Step 12: Check it by hand**

Install or run the packaged app: switching to Light says a restart is needed; after restarting, the window has the plain Windows frame, Task Manager shows no GPU process for Skycord and one renderer fewer; switching back to Full and restarting brings the Skycord bar back.

- [ ] **Step 13: Commit**

```bash
git add desktop/src/perf.ts desktop/src/__tests__/perf.test.ts desktop/src/store.ts desktop/src/main.ts desktop/src/appWindow.ts desktop/src/preload.ts src/composables/desktopBridge.ts src/composables/usePerformance.ts
git commit -m "feat(perf): the shell honours the level it was left with"
```

---

## Task 8: Measure, prune, and write down what it bought

**Files:**
- Modify: `docs/performance-baseline.md`, `docs/superpowers/specs/2026-09-26-performance-mode-design.md`, and whichever switch turns out not to earn its place

**Interfaces:**
- Consumes: the harness from Task 1 and everything since.
- Produces: the real numbers, and a level table with nothing in it that does not pay.

- [ ] **Step 1: Measure all three levels**

Run, with the dev stack up and the app rebuilt:

```bash
node desktop/scripts/memory-probe.mjs --label full
node desktop/scripts/memory-probe.mjs --label balanced
node desktop/scripts/memory-probe.mjs --label light
```

Expected: three CSVs and three summary lines.

- [ ] **Step 2: Measure one switch at a time for the ones in doubt**

For `heapCapMb`, `imageTrimMinutes` and Chromium's low-end device mode if it was tried, run the harness with that switch alone overridden onto Full, and compare against the `full` run.

- [ ] **Step 3: Drop what does not pay**

Any switch worth less than 5 MB is removed: from `PERF_LEVELS`, from the Advanced list, from the page's copy, and from the shell if it was a flag. Delete its tests with it. Record in `docs/performance-baseline.md` what was dropped and what it measured, so nobody adds it back on a hunch.

- [ ] **Step 4: Check the targets**

Light must be at or under 170 MB private and Balanced at or under 220 after the scripted session, with the idle hour inside ±10%. If Light misses, the gap is reported with the per-process split rather than papered over, and the level's copy is corrected to what it actually does.

- [ ] **Step 5: Write the numbers where people will see them**

Update `docs/performance-baseline.md` with all runs, and replace the spec's "What done means" with the measured result. The Performance page's readout already shows the live figure; no claim in the UI may exceed what the harness measured.

- [ ] **Step 6: Commit**

```bash
git add docs/performance-baseline.md docs/superpowers/specs/2026-09-26-performance-mode-design.md
git commit -m "docs(perf): what each level actually saved"
```

---

## Notes for whoever runs this

- The dev stack is the preview entries `desk-api` and `desk-web`; start them through the preview tool, never with a raw shell command.
- `npx vitest run` from the repo root covers both the client and the desktop tests; the Vitest config already includes `desktop/src/**/__tests__`.
- Task 3 is the one that matters most. If time runs out, a shipped Task 3 alone is worth more than the other five half-done.

import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { PerfLevel, PerfSwitches } from '../usePerformance'

// Same reason as useAppearance.test.ts: usePerformance pulls in useAppearance
// for the motion rule, which pulls in materialScheme → @material/material-color-utilities,
// whose published ESM uses extensionless relative imports Vite resolves and
// bare Node does not. Nothing here exercises Material You, so the dependency
// is stubbed rather than made loadable for the sake of this one file.
vi.mock('../materialScheme', () => ({
  SCHEME_TOKEN_KEYS: [],
  buildSchemeTokens: () => ({}),
}))

let PERF_LEVELS: Record<PerfLevel, PerfSwitches>
let resolve: (level: PerfLevel, overrides: Partial<PerfSwitches>) => PerfSwitches
let suggestsLight: (totalMemoryGb: number | undefined) => boolean
let restartNeeded: (applied: Pick<PerfSwitches, 'skycordTitleBar' | 'hardwareAcceleration' | 'heapCapMb'> | null) => boolean
let encodeOverrides: (o: Partial<PerfSwitches>) => Record<string, unknown>
let decodeOverrides: (raw: unknown) => Partial<PerfSwitches>

// The repo's Vitest runs in the node environment (no jsdom), but the module
// under test — and useAppearance, which it imports for the motion rule —
// touch browser globals at load time (localStorage to restore saved state,
// document to write data-motion, matchMedia for the OS theme listener). A
// static top-level import would evaluate before these assignments regardless
// of source order (ES module imports are hoisted ahead of the rest of the
// module body), so the module under test is loaded dynamically instead, once
// the stubs are in place — the same pattern useAppearance.test.ts uses.
beforeAll(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
  // Vue's runtime-dom probes `document.createElement` at import time (feature
  // detection), ahead of anything this file's own watcher touches.
  const inertEl = () => ({ style: {}, setAttribute() {}, removeAttribute() {} })
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: inertEl,
    querySelector: () => null,
    head: inertEl(),
  } as unknown as Document
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia

  const m = await import('../usePerformance')
  ;({ PERF_LEVELS, resolve, suggestsLight, restartNeeded, encodeOverrides, decodeOverrides } = m)
})

describe('overrides that survive storage', () => {
  /** JSON.parse(JSON.stringify(…)) is exactly what localStorage does to them. */
  const roundTrip = (o: Partial<PerfSwitches>) => decodeOverrides(JSON.parse(JSON.stringify(encodeOverrides(o))))

  it('keeps "no limit" a number rather than letting JSON turn it into null', () => {
    expect(roundTrip({ keepConversations: Infinity })).toEqual({ keepConversations: Infinity })
    expect(roundTrip({ maxCallTiles: Infinity })).toEqual({ maxCallTiles: Infinity })
  })

  it('carries ordinary values through untouched', () => {
    expect(roundTrip({ maxCallTiles: 4, animatedMedia: 'tap', hardwareAcceleration: false }))
      .toEqual({ maxCallTiles: 4, animatedMedia: 'tap', hardwareAcceleration: false })
  })

  it('keeps null for the two switches whose off is null', () => {
    expect(roundTrip({ heapCapMb: null, imageTrimMinutes: null })).toEqual({ heapCapMb: null, imageTrimMinutes: null })
  })

  it('drops keys that are not switches, and values of the wrong shape', () => {
    expect(decodeOverrides({ maxCallTiles: 'lots', animatedMedia: 7, nonsense: true, motion: 'off' }))
      .toEqual({ motion: 'off' })
  })

  it('treats a corrupt store as no overrides at all', () => {
    expect(decodeOverrides(null)).toEqual({})
    expect(decodeOverrides('not an object')).toEqual({})
  })
})

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

/**
 * useAppearance.applyAppearance — the inline accent properties it sets/clears
 * on <html>, and the name-hover regression this covers: an inline
 * --name-hover always outranks tokens.css's html.names-plain rule (inline
 * style beats any non-!important stylesheet selector), so "Display Name
 * Styles: off" silently stopped working the moment a dark-family theme had an
 * explicit accent — see applyAppearance's dark-family branch.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { onAccentText } from '../onAccent'

// Same reason as themeCode.test.ts: useAppearance pulls in materialScheme →
// @material/material-color-utilities, whose published ESM uses extensionless
// relative imports Vite resolves and bare Node does not. Nothing here
// exercises Material You, so the dependency is stubbed rather than made
// loadable for the sake of this one file.
vi.mock('../materialScheme', () => ({
  SCHEME_TOKEN_KEYS: [],
  buildSchemeTokens: () => ({}),
}))

let setAppearance: (patch: any, persist?: boolean) => void
let styleStore: Map<string, string>
let classSet: Set<string>

beforeAll(async () => {
  const localStore = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => localStore.get(k) ?? null,
    setItem: (k: string, v: string) => void localStore.set(k, v),
    removeItem: (k: string) => void localStore.delete(k),
  }

  // A real (if minimal) style/classList/dataset, backed by maps this file can
  // assert against — themeCode.test.ts's no-op stubs are enough to import the
  // module but can't tell us WHICH properties applyAppearance touched, which
  // is exactly the question the name-hover regression turns on.
  styleStore = new Map<string, string>()
  classSet = new Set<string>()
  const documentElement = {
    style: {
      setProperty: (k: string, v: string) => void styleStore.set(k, v),
      removeProperty: (k: string) => void styleStore.delete(k),
      getPropertyValue: (k: string) => styleStore.get(k) ?? '',
    },
    classList: {
      add: (c: string) => void classSet.add(c),
      remove: (c: string) => void classSet.delete(c),
      toggle: (c: string, force?: boolean) => {
        const on = force === undefined ? !classSet.has(c) : force
        if (on) classSet.add(c); else classSet.delete(c)
        return on
      },
      contains: (c: string) => classSet.has(c),
    },
    dataset: {} as Record<string, string>,
    setAttribute() {}, removeAttribute() {}, innerHTML: '',
  }
  const inertEl = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, innerHTML: '',
  })
  ;(globalThis as any).document = {
    documentElement,
    createElement: inertEl,
    querySelector: () => null,
    head: inertEl(),
  }

  const m = await import('../useAppearance')
  ;({ setAppearance } = m as any)
})

// applyAppearance's own removeProperty/setProperty calls for the DERIVED_KEYS
// and CUSTOM_TOKENS/SCHEME_TOKEN_KEYS groups run on every apply regardless of
// theme — irrelevant to what this file checks, so each test just resets the
// two stores it cares about rather than trying to predict every key touched.
beforeEach(() => {
  styleStore.clear()
  classSet.clear()
})

const ACCENT_INLINE_KEYS = [
  '--accent', '--accent-hover', '--accent-deep', '--accent-rgb', '--text-on-accent',
  '--name-hover', '--mention-fg', '--accent-text', '--time-token-fg',
]

describe('applyAppearance — inline accent properties', () => {
  it("'auto' clears every inline accent property", () => {
    // Seed non-empty state first — otherwise "absent" could just mean
    // "never set", not "cleared", and would pass even if the clearing code
    // were deleted outright.
    setAppearance({ theme: 'default', accent: '#5865f2', displayNameStyles: true }, false)
    expect(styleStore.get('--accent')).toBe('#5865f2')

    setAppearance({ accent: 'auto' }, false)
    for (const key of ACCENT_INLINE_KEYS) expect(styleStore.has(key), key).toBe(false)
  })

  it('an explicit accent sets the inline properties, including --text-on-accent measured for that accent', () => {
    // Yellow: the preset that first exposed --text-on-accent's old #ffffff
    // pin (1.89:1) — a real regression here fails loud, not quiet.
    setAppearance({ theme: 'default', accent: '#f0b232', displayNameStyles: true }, false)
    for (const key of ACCENT_INLINE_KEYS) expect(styleStore.has(key), key).toBe(true)
    expect(styleStore.get('--accent')).toBe('#f0b232')
    expect(styleStore.get('--text-on-accent')).toBe(onAccentText('#f0b232'))
  })

  it('plain names (Display Name Styles: off) are not overridden by an inline --name-hover on a dark theme with an explicit accent', () => {
    setAppearance({ theme: 'default', accent: '#5865f2', displayNameStyles: false }, false)

    // The class side of "plain" was never broken — it's the inline property
    // racing ahead of it that was. Checking both pins down which half a
    // regression would be in.
    expect(classSet.has('names-plain')).toBe(true)
    expect(styleStore.has('--name-hover'), '--name-hover must be left unset so html.names-plain (tokens.css) decides it').toBe(false)

    // --mention-fg carries the SAME computed value as --name-hover (see
    // accentTintsOnDark's comment in onAccent.ts) but answers an unrelated
    // question — inline @mention colour, not the display-name hover tint —
    // and must keep being set even while displayNameStyles is off.
    expect(styleStore.has('--mention-fg')).toBe(true)
  })

  it('an explicit accent still sets --name-hover when Display Name Styles is on', () => {
    setAppearance({ theme: 'default', accent: '#5865f2', displayNameStyles: true }, false)
    expect(classSet.has('names-plain')).toBe(false)
    expect(styleStore.has('--name-hover')).toBe(true)
    expect(styleStore.get('--name-hover')).toBe(styleStore.get('--mention-fg'))
  })
})

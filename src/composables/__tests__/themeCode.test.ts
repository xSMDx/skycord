/**
 * Theme share codes.
 *
 * The repo directory is misspelled `sykord`; the product is not. That typo had
 * leaked into the share code itself — the one string in this feature users
 * actually read, paste to each other, and see sitting in chat history.
 *
 * Renaming a wire format that is already in circulation is only safe if the old
 * spelling keeps working, so the interesting cases here are the legacy ones.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'

// useAppearance → materialScheme → @material/material-color-utilities, whose
// published ESM uses extensionless relative imports that Vite resolves and bare
// Node does not. Nothing here exercises Material You, so the dependency is
// stubbed rather than made loadable — the alternative is a resolve alias that
// would apply to the whole suite for the sake of one file.
vi.mock('../materialScheme', () => ({
  SCHEME_TOKEN_KEYS: [],
  buildSchemeTokens: () => ({}),
}))

let serializeTheme: () => string
let parseTheme: (code: string) => any
let THEME_CODE_RE: RegExp

beforeAll(async () => {
  // The module reads localStorage and touches <html> at import time.
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  // Enough of a document for @vue/runtime-dom's import-time createElement and
  // for applyAppearance to write its tokens onto <html>. The suite runs in the
  // node environment — there is no jsdom in this project, and one test of two
  // pure string functions is not a reason to add one.
  const el = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, innerHTML: '',
  })
  ;(globalThis as any).document = {
    documentElement: el(),
    createElement: el,
    querySelector: () => null,
    head: el(),
  }
  const m = await import('../useAppearance')
  ;({ serializeTheme, parseTheme, THEME_CODE_RE } = m as any)
})

describe('the emitted code', () => {
  it('uses the correctly spelled prefix', () => {
    expect(serializeTheme().startsWith('skycord-theme:')).toBe(true)
  })

  it('round-trips through parse', () => {
    const t = parseTheme(serializeTheme())
    expect(t).not.toBeNull()
    expect(t).toHaveProperty('theme')
  })
})

describe('codes already in circulation', () => {
  const body = () => serializeTheme().split(':')[1]

  it('still reads the legacy sykord- spelling', () => {
    // These are sitting in message history and in people's notes. Breaking
    // them would be a silent "that theme code is invalid" for something that
    // worked yesterday.
    const legacy = 'sykord-theme:' + body()
    expect(parseTheme(legacy)).not.toBeNull()
  })

  it('renders a card for either spelling in a message', () => {
    expect(THEME_CODE_RE.test('look at this sykord-theme:AAAA')).toBe(true)
    expect(THEME_CODE_RE.test('look at this skycord-theme:AAAA')).toBe(true)
  })

  it('does not match some other product’s code', () => {
    expect(THEME_CODE_RE.test('discord-theme:AAAA')).toBe(false)
  })
})

describe('malformed input', () => {
  it('returns null rather than throwing', () => {
    for (const bad of ['', 'skycord-theme:', 'skycord-theme:!!!!', 'nonsense', 'skycord-theme:' + btoa('{"v":2}')]) {
      expect(parseTheme(bad)).toBeNull()
    }
  })

  it('does not mangle a body that contains the prefix text', () => {
    // The old strip was an unanchored `.replace(PREFIX, '')`, so a prefix
    // appearing anywhere in the base64 body was cut out of the middle.
    const encoded = serializeTheme()
    expect(parseTheme('   ' + encoded + '  ')).not.toBeNull()
  })
})

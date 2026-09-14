/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Same WCAG 2.1 relative-luminance/contrast maths onAccent.test.ts duplicates
// independently of the implementation (see that file's own comment on why:
// if the test derived contrast the same way the code does, a bug in the
// shared formula would pass unnoticed). tokens.css's --danger-text and
// --warning are hand-measured constants — nothing regenerates them at build
// time — so this suite's only job is to prove the stored hex actually clears
// its target against every surface it can land on, the same "drift" concern
// onAccent.test.ts's own "tokens.css defaults" suite has for --mention-fg
// and --accent-text.
//
// New file rather than an extension of onAccent.test.ts: these tokens have
// nothing to do with the accent-derivation logic that file covers (onAccent.ts
// exports nothing about danger or warning), and proving them needs machinery
// that file doesn't — parsing every theme block in tokens.css (not just
// :root and the two light blocks) and resolving a theme that doesn't
// override a token back to :root's value. Bolting that onto onAccent.test.ts
// would mix two unrelated concerns in one file; a reader looking for "is
// tokens.css internally consistent" now has one place to look instead of two.
const ratio = (a: string, b: string) => {
  const chan = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const lum = (h: string) => {
    const [r, g, bl] = chan(h).map(c => {
      c /= 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

// Mirrors onAccent.ts's own CONTRAST_TARGET: searching to a margin above the
// 4.5 AA floor — rather than stopping at the first candidate that clears it —
// is what keeps a stored value from landing a rounding error below the line.
// Duplicated as a literal rather than imported so this suite doesn't silently
// start passing a lower bar if that constant ever moves without these tokens
// being re-measured against the new one.
const CONTRAST_TARGET = 4.6

// The graphical (non-text) floor --warning is measured against — see the
// task brief: a marker/dot only needs 3:1, not text's 4.5.
const GRAPHICAL_TARGET = 3

// Comments stripped first. tokens.css explains its values at length, and a
// comment that mentions a token followed by a colon — "was --danger-text: #fff"
// — would otherwise be read as the declaration: a false failure at best, and
// a false pass if the comment's value happens to clear the target.
const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Scoped to the FIRST :root { ... } block only — tokens.css has three
// (palette, density, motion) and only the first holds the surfaces and
// semantic colours this suite cares about. Same non-greedy-to-first-`\n}`
// approach onAccent.test.ts's own `root` const uses.
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

const themeBlock = (theme: string): string =>
  new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ''

// 'default' isn't a [data-theme] block of its own — it IS :root.
const blockFor = (theme: string): string => (theme === 'default' ? rootBlock : themeBlock(theme))

// Every theme tokens.css actually declares, read from the stylesheet itself
// rather than copied into a hand-written list here. A hand-written list only
// checks the themes someone remembered to add to it — a theme added to
// tokens.css later would go unchecked forever, silently. 'default' is :root
// itself; every other theme is the name inside a `[data-theme="…"]` block,
// taken verbatim so this can never drift from what the stylesheet calls it.
// De-duplicated on the off chance a theme is ever declared twice (a real
// authoring mistake worth catching once, not re-testing as if it were fine).
//
// This doesn't need to know which family (dark/light) a theme belongs to:
// both suites below check each block's own resolved token against that same
// block's own resolved surfaces, so one flat list of every theme is enough.
const ALL_THEMES: string[] = [
  'default',
  ...new Set(Array.from(css.matchAll(/\[data-theme="([^"]+)"\]\s*\{/g), m => m[1])),
]

// A parsing mistake in the regex above — matching the wrong attribute, or
// nothing at all — must fail loudly rather than silently pass with an empty
// or truncated theme list, which would make every `for` loop below a no-op
// that "passes" without checking anything. 13 is today's true count
// (:root/default, light, light-dim, and 10 dark presets); `>=` so tokens.css
// growing a 14th theme doesn't require touching this file, but losing themes
// here — a regex or attribute-name typo — still fails immediately.
describe('tokens.css: theme enumeration', () => {
  it('finds at least 13 theme blocks (:root plus every [data-theme] block)', () => {
    expect(ALL_THEMES.length).toBeGreaterThanOrEqual(13)
  })
})

// Raw declared value of `--name` inside `block` — a hex literal, a
// `var(--other)` reference, or undefined if `block` doesn't declare it at
// all (the caller then falls back to :root, same as before).
const declRaw = (block: string, name: string): string | undefined =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

// Resolves a custom property to the hex it ultimately paints, following
// var(--x) references instead of only reading literal hex values.
//
// The gap this closes: a light block is allowed to write, say,
// `--danger-text: var(--danger-hover)` rather than repeating a literal (the
// task brief allows exactly this). The old version of this helper matched
// only `#[0-9a-fA-F]{6}` — a var() reference isn't that, so `own` came back
// undefined, and the code fell back to `:root`'s `--danger-text` as if the
// block hadn't overridden the token at all. That's a false pass: it silently
// checks :root's DARK value against a LIGHT block's surfaces instead of the
// value the light block actually paints, for exactly the tokens this suite
// exists to catch drift in.
//
// The fix: read the raw declaration (own block first, then :root — the same
// fallback order as before, now applied to the raw text rather than only to
// a pre-matched hex). If it's already a hex, done. If it's a var(--other)
// reference, resolve THAT name the same way, in the same block context —
// "the same block first, then :root" applies again at every step, so a
// reference that itself falls back to :root still resolves correctly, and a
// chain of references terminates at whichever link finally holds a literal.
// Anything else — a value that's neither a hex nor a var() reference — fails
// loudly instead of quietly returning something misleading.
const resolveHex = (block: string, name: string, seen: ReadonlySet<string> = new Set()): string => {
  if (seen.has(name)) {
    throw new Error(`--${name}: circular var() reference (${[...seen, name].join(' -> ')})`)
  }
  const raw = declRaw(block, name) ?? declRaw(rootBlock, name)
  if (!raw) throw new Error(`--${name} not found in the given block or :root`)

  const hex = /^(#[0-9a-fA-F]{6})$/.exec(raw)
  if (hex) return hex[1].toLowerCase()

  const ref = /^var\(\s*--([\w-]+)\s*(?:,[\s\S]*)?\)$/.exec(raw)
  if (ref) return resolveHex(block, ref[1], new Set([...seen, name]))

  throw new Error(`--${name}: cannot resolve "${raw}" to a hex (neither a literal hex nor a var() reference)`)
}

const SURFACES = ['bg-floor', 'bg-deep', 'bg-panel', 'bg-chat', 'bg-raised']

describe('tokens.css: --danger-text clears CONTRAST_TARGET against every surface of its theme family', () => {
  for (const theme of ALL_THEMES) {
    it(`${theme}`, () => {
      const block = blockFor(theme)
      const text = resolveHex(block, 'danger-text')
      for (const surface of SURFACES) {
        const bg = resolveHex(block, surface)
        expect(ratio(text, bg), `--danger-text (${text}) vs ${theme}'s --${surface} (${bg})`).toBeGreaterThanOrEqual(CONTRAST_TARGET)
      }
    })
  }
})

describe('tokens.css: --warning clears the graphical 3:1 floor against every surface', () => {
  for (const theme of ALL_THEMES) {
    it(`${theme}`, () => {
      const block = blockFor(theme)
      const marker = resolveHex(block, 'warning')
      for (const surface of SURFACES) {
        const bg = resolveHex(block, surface)
        expect(ratio(marker, bg), `--warning (${marker}) vs ${theme}'s --${surface} (${bg})`).toBeGreaterThanOrEqual(GRAPHICAL_TARGET)
      }
    })
  }
})

// Direct proof that the var()-resolution gap above is actually closed, using
// synthetic blocks rather than relying on tokens.css happening to contain a
// var()-valued token — the suites above wouldn't fail if this regressed as
// long as every real token stayed a literal hex. This pins the exact bug
// scenario the task called out: a family override that points at another
// token instead of repeating its hex.
describe('tokens.css: resolveHex follows var() references', () => {
  it('resolves a literal hex directly', () => {
    expect(resolveHex('--foo: #123456;', 'foo')).toBe('#123456')
  })

  it('resolves var(--x) to a sibling declared in the SAME block, not :root', () => {
    const block = '--danger-hover: #abcdef;\n--danger-text: var(--danger-hover);'
    expect(resolveHex(block, 'danger-text')).toBe('#abcdef')
  })

  it('resolves var(--x) to :root when the block does not override --x itself — the exact bug scenario: a block aliases --danger-text to --danger-hover without repeating it, and --danger-hover only exists in :root', () => {
    const block = '--danger-text: var(--danger-hover);'
    // :root's real --danger-hover, not :root's --danger-text — proves this
    // reads the REFERENCED token's fallback, rather than silently reusing
    // the old (wrong) fallback-for-the-original-name behaviour.
    const rootDangerHover = resolveHex(rootBlock, 'danger-hover')
    expect(resolveHex(block, 'danger-text')).toBe(rootDangerHover)
    expect(resolveHex(block, 'danger-text')).not.toBe(resolveHex(rootBlock, 'danger-text'))
  })

  it('throws rather than silently resolving an unresolvable reference', () => {
    expect(() => resolveHex('--foo: var(--does-not-exist-anywhere);', 'foo')).toThrow()
  })

  it('throws on a circular var() chain instead of looping forever', () => {
    const block = '--a: var(--b);\n--b: var(--a);'
    expect(() => resolveHex(block, 'a')).toThrow()
  })
})

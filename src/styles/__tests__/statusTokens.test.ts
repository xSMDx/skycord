/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// A status dot is a graphical object, not text: WCAG 1.4.11 asks for 3:1
// against whatever it sits on, and nothing in the build recomputes these
// values, so the only thing standing between a stored hex and an invisible
// dot is a test that measures it. On the light themes the shipped values were
// 2.52 (online), 1.50 (idle), 3.04 (dnd) and 2.97 (offline); idle on Light Dim
// was 1.17:1, which is a dot you cannot see at all.
//
// The maths is written out here rather than imported for the same reason
// onAccent.test.ts writes its own: a test that derives contrast the way the
// code does cannot catch a bug in the shared derivation.
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

// WCAG 1.4.11's floor for a non-text object. The stored values are derived to
// 3.1 so a rounding difference between the derivation and this test cannot
// land one of them a hair under the line; the assertion stays at the real
// floor so a future tuning only fails when it is genuinely below it.
const GRAPHICAL_FLOOR = 3

const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
const themeBlock = (theme: string): string =>
  new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ''
const blockFor = (theme: string): string => (theme === 'default' ? rootBlock : themeBlock(theme))

// Read from the stylesheet rather than a hand-written list: a theme added
// later must be checked without anyone remembering to add it here.
const ALL_THEMES: string[] = [
  'default',
  ...new Set(Array.from(css.matchAll(/\[data-theme="([^"]+)"\]\s*\{/g), m => m[1])),
]

describe('tokens.css: theme enumeration', () => {
  it('finds every theme block (:root plus each [data-theme])', () => {
    expect(ALL_THEMES.length).toBeGreaterThanOrEqual(13)
  })
})

const declRaw = (block: string, name: string): string | undefined =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

// Follows var() references, because the status tokens are deliberately
// written as var(--green) and var(--danger) on the dark themes: presence
// should move when the semantic colour it borrows moves. Reading only literal
// hex would silently fall back to :root and measure the wrong value — for a
// light block, the dark one.
const resolveHex = (block: string, name: string, seen: ReadonlySet<string> = new Set()): string => {
  if (seen.has(name)) throw new Error(`--${name}: circular var() reference`)
  const raw = declRaw(block, name) ?? declRaw(rootBlock, name)
  if (!raw) throw new Error(`--${name} not found in the given block or :root`)

  const hex = /^(#[0-9a-fA-F]{6})$/.exec(raw)
  if (hex) return hex[1].toLowerCase()

  const ref = /^var\(\s*--([\w-]+)\s*(?:,[\s\S]*)?\)$/.exec(raw)
  if (ref) return resolveHex(block, ref[1], new Set([...seen, name]))

  throw new Error(`--${name}: cannot resolve "${raw}" to a hex`)
}

// Every surface a dot can sit on. A dot over an avatar still counts: it is
// ringed in the surface behind it, so the surface is what it is measured
// against either way.
const SURFACES = ['bg-floor', 'bg-deep', 'bg-panel', 'bg-chat', 'bg-raised']
const STATUSES = ['status-online', 'status-idle', 'status-dnd', 'status-offline']

describe('tokens.css: every status clears the 3:1 graphical floor on every surface of every theme', () => {
  for (const theme of ALL_THEMES) {
    it(`${theme}`, () => {
      const block = blockFor(theme)
      const failures: string[] = []
      for (const status of STATUSES) {
        const dot = resolveHex(block, status)
        for (const surface of SURFACES) {
          const bg = resolveHex(block, surface)
          const r = ratio(dot, bg)
          if (r < GRAPHICAL_FLOOR) {
            failures.push(`${theme}  --${status} ${dot}  on --${surface} ${bg}  ${r.toFixed(2)}`)
          }
        }
      }
      expect(failures).toEqual([])
    })
  }
})

/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// Two halves of one question: what follows the theme, and what must not.
//
// The light themes invert almost everything, and that is right for a surface
// the app draws. It is wrong for anything sitting on media — a photo, a video,
// a colour the member chose — because a light theme does not make someone's
// banner light. tokens.css answers that with --media-veil / --media-veil-strong
// (fixed black) and --on-media (fixed white).
//
// The failure this file exists to catch is the half-conversion: the veil is
// taken but the foreground is left on a theme-following token. That shipped.
// Three rules painted --text-strong or --text-2 onto the fixed veil, which on
// the light themes is near-black ink on black — 1.04:1 for "Choose GIF" over a
// GIF thumbnail. One of them sat four lines below a sibling that had it right.
//
// The mirror-image failure is a white-alpha token that the light blocks forgot
// to override, which resolves to nothing on a pale surface. That shipped too:
// --sk-base and --sk-sheen were the only two of the twelve left out, so every
// loading skeleton on the light themes was blank space with no shimmer.
const SRC = resolve(__dirname, '../..')
const TOKENS = resolve(__dirname, '../tokens.css')

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return filesUnder(p)
    return name.endsWith('.vue') || name.endsWith('.css') ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

/** Style blocks with comments blanked, line numbers preserved. */
const cssOf = (file: string): { text: string; line: number }[] => {
  const source = readFileSync(file, 'utf8')
  const blank = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  if (file.endsWith('.css')) return [{ text: blank(source), line: 1 }]
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => {
    const start = m.index! + m[0].indexOf('>') + 1
    return { text: blank(m[1]), line: source.slice(0, start).split('\n').length }
  })
}

// ── Half one: nothing theme-following may sit on the fixed veil ─────────────

const VEIL = /var\(\s*--media-veil(-strong)?\s*[,)]/
const FOREGROUND = /^(color|fill|stroke|-webkit-text-fill-color)$/
/** The values that do NOT move when the theme does. */
const CONSTANT = /var\(\s*--(on-media|letterbox|toggle-knob|text-on-[\w-]+)\s*[,)]|^(#|rgba?\()|^(currentColor|transparent|inherit)$/

interface Offender { file: string; line: number; selector: string; declaration: string }

const onVeil = (): Offender[] => {
  const found: Offender[] = []
  for (const file of filesUnder(SRC)) {
    if (rel(file) === 'styles/tokens.css') continue
    for (const { text, line } of cssOf(file)) {
      for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim().replace(/\s+/g, ' ')
        if (/^(from|to|\d+%)/.test(selector)) continue
        const decls = [...rule[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)]
        const veiled = decls.some(d => /^background(-color|-image)?$/.test(d[1]) && VEIL.test(d[2]))
        if (!veiled) continue
        for (const d of decls) {
          const value = d[2].trim()
          if (!FOREGROUND.test(d[1]) || CONSTANT.test(value)) continue
          const at = line + text.slice(0, rule.index! + rule[1].length + 1 + d.index!).split('\n').length - 1
          found.push({ file: rel(file), line: at, selector, declaration: `${d[1]}: ${value}` })
        }
      }
    }
  }
  return found
}

describe('nothing that follows the theme is painted onto the fixed media veil', () => {
  const all = onVeil()

  it('reads the styles it checks', () => {
    expect(filesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('finds at least one rule that uses the veil at all', () => {
    // Anti-vacuity: if the VEIL pattern stops matching, the check above
    // becomes a loop over nothing and passes for the wrong reason.
    const seen = filesUnder(SRC)
      .filter(f => rel(f) !== 'styles/tokens.css')
      .flatMap(f => cssOf(f))
      .filter(b => VEIL.test(b.text))
    expect(seen.length).toBeGreaterThan(0)
  })

  it('has no theme-following foreground on a veiled background', () => {
    expect(all.map(o => `${o.file}:${o.line}  ${o.selector}  ${o.declaration}`)).toEqual([])
  })
})

// ── Half two: every white-alpha token is answered by both light blocks ──────

const tokensCss = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const blockNamed = (selector: string): string => {
  const re = new RegExp(selector.replace(/[[\]"]/g, m => '\\' + m) + '\\s*\\{([\\s\\S]*?)\\n\\}', 'g')
  return [...tokensCss.matchAll(re)].map(m => m[1]).join('\n')
}

/** Where a token is last declared under a selector, as a character offset. */
const lastDeclaredAt = (selector: string, name: string): number => {
  const re = new RegExp(selector.replace(/[[\]"]/g, m => '\\' + m) + '\\s*\\{([\\s\\S]*?)\\n\\}', 'g')
  let at = -1
  for (const block of tokensCss.matchAll(re)) {
    const inner = new RegExp(name + '\\s*:').exec(block[1])
    if (inner) at = block.index! + block[0].indexOf(block[1]) + inner.index!
  }
  return at
}
const declared = (text: string): Map<string, string> =>
  new Map([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))

const WHITE_ALPHA = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/

// Constant on purpose, each for a reason tokens.css states at its declaration.
const RULED: Record<string, string> = {
  '--on-media': 'fixed white by design: what is under it is not a surface we control',
  '--toggle-knob': 'reads on the grey track in both families; the ON state uses --text-on-accent',
}

// --text-on-<fill> is white measured against one fixed fill. It may stay white
// only while that fill itself stays fixed, so the ruling is not taken on trust:
// the fill is looked up, and the moment a light block overrides it the ink is
// asked for a light value too.
const INK_ON_FILL = /^--text-on-([\w-]+)$/

describe('every white-alpha token is answered by both light blocks', () => {
  const root = declared(blockNamed(':root'))
  const whites = [...root].filter(([, v]) => WHITE_ALPHA.test(v) || /^#(fff|ffffff)$/i.test(v)).map(([k]) => k)

  it('finds the white-alpha family at all', () => {
    expect(whites.length).toBeGreaterThanOrEqual(10)
  })

  for (const theme of ['light', 'light-dim']) {
    it(`${theme} overrides each one, or it is ruled constant`, () => {
      const block = declared(blockNamed(`[data-theme="${theme}"]`))
      const inkOnFixedFill = (name: string) => {
        const fill = INK_ON_FILL.exec(name)?.[1]
        return !!fill && root.has(`--${fill}`) && !block.has(`--${fill}`)
      }
      const missing = whites.filter(
        name => !block.has(name) && !(name in RULED) && !inkOnFixedFill(name))
      expect(missing, `${theme} leaves these at their white-alpha value, so they vanish on a pale surface`).toEqual([])
    })
  }

  it('has no ruling for a token that is no longer white', () => {
    const dead = Object.keys(RULED).filter(name => !whites.includes(name))
    expect(dead).toEqual([])
  })

  // Declaring the override is not the same as the override applying.
  // :root and [data-theme="light"] have identical specificity (0,1,0), so the
  // one written LATER in the file wins. tokens.css has three :root blocks, and
  // two tokens were declared in the last of them — after both light blocks —
  // so the light values added for them resolved to nothing in a real browser
  // while this suite was green. Order is part of the override.
  for (const theme of ['light', 'light-dim']) {
    it(`${theme}'s overrides are written after the :root they override`, () => {
      const block = declared(blockNamed(`[data-theme="${theme}"]`))
      const losing = [...block.keys()]
        .filter(name => {
          const root = lastDeclaredAt(':root', name)
          const light = lastDeclaredAt(`[data-theme="${theme}"]`, name)
          return root !== -1 && light !== -1 && root > light
        })
      expect(losing, `these are declared again under :root further down the file, so :root wins and the ${theme} value never applies`)
        .toEqual([])
    })
  }
})

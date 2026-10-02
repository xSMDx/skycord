/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

/*
 * Radii come from the scale.
 *
 * DESIGN.md defines five tokens. Before the sweep that added this test, 41
 * declarations named one and roughly 330 wrote a number — so the scale
 * existed in the document and almost nowhere in the source, and the next
 * person to round a corner read the file next to them rather than the
 * contract.
 *
 * Two passes fixed it. The first moved 252 declarations whose value was
 * already exactly a token's, and nothing moved: the computed radius of all
 * 330 elements that had one was identical afterwards. The second decided the
 * 47 off-scale strays — 10, 14, 16, 7, 5, 3 and 22px — one at a time against
 * what the element actually is, and those did move pixels.
 *
 * Only three kinds of raw value survive, and each is a deliberate exception:
 *
 *   50%      an ellipse, which is NOT what 999px makes on a non-square box.
 *            Identical on a square avatar, different on anything else, so
 *            swapping them wholesale would be a visual change dressed up as
 *            a cleanup.
 *   1px/2px  below the smallest token. Almost all of it is scrollbar thumbs
 *            and drag handles, where 4px is visibly too round on something
 *            4px wide.
 *   shorthand  `16px 16px 0 0` — only some corners are rounded, which the
 *            scale does not express.
 *
 * Anything else is a number where a token belongs, and this fails on it with
 * the file, the line, and — when the value maps exactly — the replacement.
 */
const SRC = resolve(__dirname, '../..')

/** value → the token that says it exactly */
const TOKENISED: Record<string, string> = {
  '4px': '--edge-sm',
  '6px': '--edge-md',
  '8px': '--edge-lg',
  '12px': '--edge-xl',
  '999px': '--edge-pill',
}

/** Below the smallest token, and correct there. See the header. */
const BELOW_SCALE = new Set(['0', '1px', '2px'])

const filesUnder = (dir: string, exts: string[]): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__' || name === 'node_modules') return []
    const p = join(dir, name)
    return statSync(p).isDirectory()
      ? filesUnder(p, exts)
      : exts.some(e => name.endsWith(e)) ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

/**
 * A single-value radius only.
 *
 * The value is captured up to the terminator so a shorthand is captured
 * whole and then skipped — matching only the first number would read
 * `16px 16px 0 0` as a bare 16px and report a corner rounding that is
 * deliberate.
 */
const RADIUS = /border-radius:\s*([^;}\n"']+)/g

const offenders = (): string[] => {
  const out: string[] = []
  for (const file of filesUnder(SRC, ['.vue', '.css'])) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(RADIUS)) {
        const value = m[1].trim()
        if (value.includes(' ')) continue          // shorthand: some corners only
        if (value.startsWith('var(')) continue     // already a token
        if (value === 'inherit' || value.endsWith('%')) continue
        if (BELOW_SCALE.has(value)) continue
        const token = TOKENISED[value]
        out.push(`${rel(file)}:${i + 1}  ${value}${token ? ` → var(${token})` : ' is not on the scale — pick the token that fits what this element is'}`)
      }
    })
  }
  return out.sort()
}

describe('radius scale', () => {
  it('finds files to read, so a pass here cannot be vacuous', () => {
    expect(filesUnder(SRC, ['.vue', '.css']).length).toBeGreaterThan(50)
  })

  it('writes every radius as a token, bar the documented exceptions', () => {
    expect(offenders()).toEqual([])
  })

  it('still finds the tokens in use, so nothing silently reverted the sweep', () => {
    let used = 0
    for (const file of filesUnder(SRC, ['.vue', '.css'])) {
      used += (readFileSync(file, 'utf8').match(/border-radius:\s*var\(--edge-/g) || []).length
    }
    expect(used).toBeGreaterThan(280)
  })
})

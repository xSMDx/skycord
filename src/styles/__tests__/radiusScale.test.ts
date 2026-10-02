/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

/*
 * A radius that has a token must use the token.
 *
 * DESIGN.md defines five: 4, 6, 8, 12 and 999px. Before the sweep that added
 * this test, 41 declarations named one and roughly 330 wrote a number — so
 * the scale existed in the document and almost nowhere in the source, and the
 * next person to round a corner read the file next to them rather than the
 * contract. 252 declarations moved onto tokens in one pass, and not one
 * computed radius changed, because every one of them was already exactly a
 * token's value. This keeps that true.
 *
 * Deliberately narrow. It fails only on a number a token already expresses,
 * which is a mechanical mistake with a mechanical fix. It says nothing about:
 *
 *   - 50%, which makes an ellipse where 999px makes a stadium. Identical on a
 *     square avatar, different on anything else, so swapping them wholesale
 *     would be a visual change dressed up as a cleanup.
 *   - 1px and 2px, below the smallest token and used on hairlines and tiny
 *     indicators.
 *   - the off-scale strays — 10px (30 of them), 7, 5, 3, 14, 16, 18, 22 —
 *     which need a decision per site about which way to round, not a regex.
 *   - multi-value shorthands like `16px 16px 0 0`, where only some corners
 *     are rounded.
 *
 * Those are real findings in docs/UI-REVIEW.md. They are not THIS test's job,
 * and widening it to cover them would make it fail on work nobody has agreed
 * to yet.
 */
const SRC = resolve(__dirname, '../..')

/** value → the token that already says it */
const TOKENISED: Record<string, string> = {
  '4px': '--edge-sm',
  '6px': '--edge-md',
  '8px': '--edge-lg',
  '12px': '--edge-xl',
  '999px': '--edge-pill',
}

const filesUnder = (dir: string, exts: string[]): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__' || name === 'node_modules') return []
    const p = join(dir, name)
    return statSync(p).isDirectory()
      ? filesUnder(p, exts)
      : exts.some(e => name.endsWith(e)) ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

/** A lone value only — `16px 16px 0 0` is a different question. */
const LONE_RADIUS = /border-radius:\s*([^;}\n"']+)/g

const offenders = (): string[] => {
  const out: string[] = []
  for (const file of filesUnder(SRC, ['.vue', '.css'])) {
    const text = readFileSync(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(LONE_RADIUS)) {
        const value = m[1].trim()
        const token = TOKENISED[value]
        if (token) out.push(`${rel(file)}:${i + 1}  ${value} → var(${token})`)
      }
    })
  }
  return out.sort()
}

describe('radius scale', () => {
  it('finds files to read, so a pass here cannot be vacuous', () => {
    expect(filesUnder(SRC, ['.vue', '.css']).length).toBeGreaterThan(50)
  })

  it('writes no radius as a number when a token already says it', () => {
    expect(offenders()).toEqual([])
  })

  it('still finds the tokens in use, so nothing silently reverted the sweep', () => {
    let used = 0
    for (const file of filesUnder(SRC, ['.vue', '.css'])) {
      used += (readFileSync(file, 'utf8').match(/border-radius:\s*var\(--edge-/g) || []).length
    }
    expect(used).toBeGreaterThan(200)
  })
})

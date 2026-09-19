/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// Vite's default build target reaches back to Safari 14, and Safari could not
// parse a regex lookbehind until 16.4. In a regex literal that is not one
// broken feature: the file fails to parse, and with it the bundle it sits in —
// a blank app on an iPad that stopped updating at iOS 15. Built with new
// RegExp it throws only when that line runs, which for the message renderer
// meant every message.
//
// Two were in the tree (the server-icon initials and the message renderer);
// both are rewritten to match the pair or the tag and put it back. This keeps
// a third from arriving. Lookahead and named groups are fine everywhere and
// are not matched here.
const SRC = resolve(__dirname, '../..')
const LOOKBEHIND = new RegExp('[(][?]<[=!]')

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /[.](ts|vue)$/.test(name) ? [p] : []
  })

describe('browser support', () => {
  it('finds the source it checks', () => {
    expect(files(SRC).length).toBeGreaterThan(50)
  })

  it('uses no regex lookbehind, which Safari before 16.4 cannot parse', () => {
    const offenders = files(SRC).flatMap(file =>
      readFileSync(file, 'utf8').split('\n')
        .map((line, i) => ({ line, at: i + 1 }))
        .filter(({ line }) => LOOKBEHIND.test(line))
        .map(({ at }) => `${relative(SRC, file).split(sep).join('/')}:${at}`))
    expect(offenders).toEqual([])
  })
})

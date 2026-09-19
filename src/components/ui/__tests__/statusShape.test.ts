/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { nextMaskId, statusShape } from '../statusShape'

describe('statusShape', () => {
  it('draws each status as its own shape', () => {
    expect(statusShape('online')).toBe('filled')
    expect(statusShape('idle')).toBe('crescent')
    expect(statusShape('dnd')).toBe('bar')
    expect(statusShape('offline')).toBe('ring')
  })

  it('shows invisible, unknown and missing as offline — what everyone else sees', () => {
    expect(statusShape('invisible')).toBe('ring')
    expect(statusShape('away-on-holiday')).toBe('ring')
    expect(statusShape(undefined)).toBe('ring')
    expect(statusShape(null)).toBe('ring')
  })
})

// Every dot goes through StatusDot, or a colour-only dot can come back
// unnoticed — and a colour-only dot is exactly the defect this slice exists to
// remove, invisible to a colour-blind member and to anyone on Light Dim before
// the tokens were retuned. Reads component source: the node environment these
// tests run in cannot mount a component.
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? (f === '__tests__' ? [] : walk(p)) : p.endsWith('.vue') ? [p] : []
})

describe('status dots', () => {
  it('are all drawn by StatusDot', () => {
    const root = resolve(__dirname, '../../..')
    const offenders = walk(root)
      .filter(f => /background:\s*statusColor\(/.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(root.length + 1).split('\\').join('/'))
    expect(offenders).toEqual([])
  })
})

describe('nextMaskId', () => {
  // The shapes are cut with an SVG mask, and a mask is addressed by id. Four
  // ids shared across the page look fine until the dot that happens to own the
  // definition unmounts — a member going offline, a list re-sorting — and every
  // other dot of that shape is left pointing at nothing.
  it('never hands out the same id twice', () => {
    const ids = Array.from({ length: 200 }, () => nextMaskId())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is a valid id for a url(#...) reference', () => {
    expect(nextMaskId()).toMatch(/^[A-Za-z][\w-]*$/)
  })
})

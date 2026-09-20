/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// Animating a layout property — width, height, padding, margin, the offsets,
// flex-basis, grid tracks — makes the browser redo layout on every frame, and
// for a column (the sidebar, the member list) that means reflowing the whole
// chat beside it sixty times a second. Inventory finding 19; DESIGN.md's
// motion rules allow transform and opacity. This guard is what keeps the
// fixed sites fixed: a transition naming a layout property fails here.
//
// It reads transitions only — `transition` and `transition-property` — which
// is where every one of the original eleven was. `transition: all` is not
// matched: it animates layout only if a layout property happens to change.
const SRC = resolve(__dirname, '../..')

const LAYOUT = /^(width|height|min-width|min-height|max-width|max-height|padding(-\w+)?|margin(-\w+)?|top|right|bottom|left|inset|flex-basis|gap|row-gap|column-gap|grid-template-(rows|columns))$/

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return filesUnder(p)
    return name.endsWith('.vue') || name.endsWith('.css') ? [p] : []
  })

/** The file's CSS with comments blanked, so line numbers stay true. */
const cssOf = (file: string): { text: string; offset: number }[] => {
  const source = readFileSync(file, 'utf8')
  const blank = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  if (file.endsWith('.css')) return [{ text: blank(source), offset: 0 }]
  const blocks: { text: string; offset: number }[] = []
  for (const m of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    blocks.push({ text: blank(m[1]), offset: m.index! + m[0].indexOf('>') + 1 })
  }
  return blocks.map(b => ({ text: b.text, offset: source.slice(0, b.offset).split('\n').length - 1 }))
}

/** Split on commas that are not inside parentheses: cubic-bezier(.2, 0, 0, 1). */
const topLevel = (value: string): string[] => {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')') depth--
    else if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1 }
  }
  parts.push(value.slice(start))
  return parts.map(p => p.trim()).filter(Boolean)
}

/** Every word of a shorthand item, not just the first. The property may be
 *  written last — `transition: var(--dur-2) var(--ease-out) height` is legal
 *  CSS — and reading only `item.split(/\s+/)[0]` would miss it. */
const namedProperties = (item: string): string[] =>
  item.split(/\s+/).filter(Boolean).filter(word => !/^(var\(|cubic-bezier\(|steps\(|-?[\d.]|ease|linear|step-)/.test(word))

/** A shorthand item whose every time is zero animates nothing — it schedules
 *  when a snap happens. `width 0s var(--dur-exit)` keeps the panel at full
 *  width for the length of its fade and then drops it, which is the opposite
 *  of laying out on every frame. */
const isSnap = (item: string) => {
  const times = [...item.matchAll(/(?:^|[\s,(])(-?\d*\.?\d+)(ms|s)\b/g)]
  return times.length > 0 && times.every(t => Number(t[1]) === 0)
}

const offenders = (): string[] => {
  const found: string[] = []
  const at = (file: string, offset: number, text: string, index: number) =>
    `${relative(SRC, file).split(sep).join('/')}:${offset + text.slice(0, index).split('\n').length}`

  for (const file of filesUnder(SRC)) {
    for (const { text, offset } of cssOf(file)) {
      for (const m of text.matchAll(/(?:^|[;{\s])(transition(?:-property)?)\s*:\s*([^;}]+)/g)) {
        const layout = topLevel(m[2]).filter(item => !isSnap(item)).flatMap(namedProperties).filter(p => LAYOUT.test(p))
        if (!layout.length) continue
        found.push(`${at(file, offset, text, m.index)}  ${[...new Set(layout)].join(', ')}`)
      }

      // A @keyframes body is the other half of "no animation on a layout
      // property", and the guard used to read only transitions — so a 3s
      // width ramp on the splash bar sat under a test named for it. Frames
      // hold plain declarations, so the property is the declaration's own.
      for (const kf of text.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
        const layout = [...kf[2].matchAll(/([a-z-]+)\s*:/g)].map(d => d[1]).filter(p => LAYOUT.test(p))
        if (!layout.length) continue
        found.push(`${at(file, offset, text, kf.index)}  @keyframes ${kf[1]}: ${[...new Set(layout)].join(', ')}`)
      }
    }
  }
  return found
}

describe('no animation on a layout property', () => {
  it('reads the styles it checks', () => {
    expect(filesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('has no transition or keyframe that animates layout', () => {
    expect(offenders()).toEqual([])
  })

  it('reads keyframes, and the property wherever it sits in a shorthand', () => {
    // Anti-vacuity. This suite has no allowlist, so nothing else here would
    // fail if either scan quietly stopped matching — and "reads the styles it
    // checks" counts files, not rules.
    expect(namedProperties('var(--dur-2) var(--ease-out) height')).toContain('height')
    expect(namedProperties('height var(--dur-2) var(--ease-out)')).toContain('height')
    expect(namedProperties('transform var(--dur-2) cubic-bezier(.4,0,.6,1)')).not.toContain('cubic-bezier(.4,0,.6,1)')
    expect(LAYOUT.test('gap')).toBe(true)
    // A zero-time item is a scheduled snap, not an animation; anything else is.
    expect(isSnap('width 0s var(--dur-exit)')).toBe(true)
    expect(isSnap('width 0s')).toBe(true)
    expect(isSnap('width var(--dur-3) var(--ease-out)')).toBe(false)
    expect(isSnap('height .2s')).toBe(false)
    // Every @keyframes in src is found and none of them animates layout.
    const frames = filesUnder(SRC).flatMap(f => cssOf(f))
      .flatMap(b => [...b.text.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]))
    expect(frames.length).toBeGreaterThan(10)
  })
})

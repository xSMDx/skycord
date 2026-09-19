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

const LAYOUT = /^(width|height|min-width|min-height|max-width|max-height|padding(-\w+)?|margin(-\w+)?|top|right|bottom|left|inset|flex-basis|grid-template-(rows|columns))$/

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

const offenders = (): string[] => {
  const found: string[] = []
  for (const file of filesUnder(SRC)) {
    for (const { text, offset } of cssOf(file)) {
      for (const m of text.matchAll(/(?:^|[;{\s])(transition(?:-property)?)\s*:\s*([^;}]+)/g)) {
        const properties = topLevel(m[2]).map(item => item.split(/\s+/)[0])
        const layout = properties.filter(p => LAYOUT.test(p))
        if (!layout.length) continue
        const line = offset + text.slice(0, m.index).split('\n').length
        found.push(`${relative(SRC, file).split(sep).join('/')}:${line}  ${layout.join(', ')}`)
      }
    }
  }
  return found
}

describe('no animation on a layout property', () => {
  it('reads the styles it checks', () => {
    expect(filesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('has no transition that animates layout', () => {
    expect(offenders()).toEqual([])
  })
})

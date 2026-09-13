import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

const SRC = resolve(__dirname, '../..')

const vueFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith('.vue') ? [p] : []
  })

// Painting a literal white on the accent defeats the adaptive scheme: the
// accent is chosen by the user and can be Yellow, where white is 1.89:1.
//
// Rules are inspected WHOLE. Scanning line by line misses every rule that
// declares its background and its colour on separate lines — five of the
// fifteen this test was written against.
describe('text on an accent background', () => {
  it('never hardcodes white, however the rule is laid out', () => {
    const offenders: string[] = []
    for (const file of vueFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2]
        if (!/background:\s*var\(--accent\)/.test(body)) continue
        if (!/(^|;|\s)color:\s*(#fff\b|#ffffff\b|white\b)/i.test(body)) continue
        const line = text.slice(0, m.index).split('\n').length
        const selector = m[1].trim().split('\n').pop()!.trim()
        offenders.push(`${relative(SRC, file).split(sep).join('/')}:${line} ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

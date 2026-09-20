/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// A call is a dark room in every theme: [data-surface="media"] re-declares,
// under each light theme, every token that theme overrides — at its dark
// value — so rules inside the call bar keep their ordinary tokens and get the
// dark room. If a light theme later overrides a new token and the scope is
// not taught it, something in a call quietly turns light. This fails first.
//
// The member's own colours are excluded on purpose: the appearance picker
// sets the accent at runtime, and re-declaring it here would override it.
const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const block = (selector: RegExp) => selector.exec(css)?.[1] ?? ''
const decls = (text: string) => Object.fromEntries(
  [...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))

const root = decls(block(/:root\s*\{([\s\S]*?)\n\}/))
const MEMBERS_OWN = /^--(accent|text-on-accent|mention|name-hover|time-token)/

const ratio = (a: string, b: string) => {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the media surface', () => {
  for (const theme of ['light', 'light-dim']) {
    it(`restores, under ${theme}, every token ${theme} overrides — at its dark value`, () => {
      const overridden = Object.keys(decls(block(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))))
        .filter(name => !MEMBERS_OWN.test(name))
      const scope = decls(block(new RegExp(`\\[data-theme="${theme}"\\] \\[data-surface="media"\\][^{]*\\{([\\s\\S]*?)\\n\\}`)))
      expect(overridden.length).toBeGreaterThan(30)
      const wrong = overridden.filter(name => scope[name] !== root[name])
        .map(name => `${name}: scope has ${scope[name] ?? 'nothing'}, :root has ${root[name]}`)
      expect(wrong).toEqual([])
    })
  }

  it('never re-declares the member\'s own colours', () => {
    const scope = block(/\[data-surface="media"\][^{]*\{([\s\S]*?)\n\}/)
    expect(Object.keys(decls(scope)).filter(n => MEMBERS_OWN.test(n))).toEqual([])
  })

  it('measures the new fills with the glyphs they carry', () => {
    expect(ratio(root['--green-hover'], root['--text-on-green'])).toBeGreaterThanOrEqual(4.6)
    expect(ratio(root['--green-deep-hover'], root['--text-on-green-deep'])).toBeGreaterThanOrEqual(4.6)
    expect(ratio(root['--media-ground'], root['--green'])).toBeGreaterThanOrEqual(3)
  })
})

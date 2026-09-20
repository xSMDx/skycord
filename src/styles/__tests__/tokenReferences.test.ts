/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// A misspelled custom property is the one CSS mistake that leaves no trace:
// `var(--seem)` is not an error, it is a declaration that quietly does not
// apply, so the element keeps whatever it had and the page looks nearly
// right. The colour sweep just moved roughly 400 declarations onto token
// names typed by hand, which is exactly the situation that mistake hides in.
//
// This is the cheap half of that problem — a name nothing anywhere defines.
// It caught three on the branch that added it: two `var(--bg-floating, ...)`
// and one `var(--active, ...)`, tokens this app never had, each one sitting
// behind a fallback that made it invisible by always winning.
//
// Deliberately NOT a resolution check. A custom property can legitimately be
// set outside a stylesheet, and from a different file than the one that reads
// it: --keyboard-h is written by useViewport from visualViewport, --conn-h by
// the connection banner as it measures itself, --zoom-factor by useAppearance.
// Proving "this name is set on an ancestor at the moment this rule matches"
// needs a browser, not a regex. So the bar here is the one a regex can
// actually hold: the name is declared in tokens.css, or written somewhere in
// src — a stylesheet, a template binding, a setProperty call. A typo
// satisfies neither, because a typo appears exactly once.
const SRC = resolve(__dirname, '../..')

const filesUnder = (dir: string, ext: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p, ext) : name.endsWith(ext) ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

// Comments are stripped before anything is read out of a file: tokens.css
// explains itself at length and names tokens inside those explanations, and a
// commented-out `--foo: red;` must not count as declaring --foo.
const stripComments = (s: string, path = '') => {
  const noBlocks = s.replace(/\/\*[\s\S]*?\*\//g, '')
  // Line comments only where the language has them. In CSS and in a template,
  // // is part of a URL far more often than it is a comment.
  return path.endsWith('.ts') ? noBlocks.replace(/(^|[^:])\/\/[^\n]*/g, '$1') : noBlocks
}

const TOKENS = 'styles/tokens.css'
const tokensText = stripComments(readFileSync(resolve(SRC, 'styles/tokens.css'), 'utf8'))
const declared = new Set(Array.from(tokensText.matchAll(/(--[\w-]+)\s*:/g), m => m[1]))

describe('token references', () => {
  // A guard whose input is empty passes without checking anything. tokens.css
  // held 93 names when this was written; the floor is only there to catch the
  // regex breaking, so it sits well under that.
  it('reads tokens.css', () => {
    expect(declared.size).toBeGreaterThan(50)
  })

  const readable = [...filesUnder(SRC, '.vue'), ...filesUnder(SRC, '.css'), ...filesUnder(SRC, '.ts')]
  const sources = readable.map(f => ({ path: rel(f), text: stripComments(readFileSync(f, 'utf8'), rel(f)) }))

  // Every name written anywhere in src, with the var() reads removed first so
  // that reading a name is never mistaken for writing it. What is left is a
  // CSS declaration, a template binding or a setProperty call — any one of
  // which means the name is real.
  const writtenIn = (srcs: { path: string; text: string }[]) => {
    const names = new Set<string>()
    for (const { text } of srcs)
      for (const m of text.replace(/var\(\s*--[\w-]+/g, 'var(').matchAll(/(--[\w-]+)(?![\w-])/g))
        names.add(m[1])
    return names
  }
  const orphansIn = (srcs: { path: string; text: string }[]) => {
    const names = writtenIn(srcs)
    const out: string[] = []
    for (const { path, text } of srcs) {
      if (path === TOKENS) continue
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)(?![\w-])/g)) {
        const name = m[1]
        if (declared.has(name) || names.has(name)) continue
        out.push(`${path}:${text.slice(0, m.index).split('\n').length}  var(${name})`)
      }
    }
    return out
  }

  it('has no var() naming a custom property nothing anywhere writes', () => {
    expect(orphansIn(sources)).toEqual([])
  })

  // The check above is only as good as its ability to see a name that is
  // missing, and the easy way to break it is to make `written` swallow
  // everything — one stray regex change and every typo becomes "written".
  //
  // These run the real scan over the real sources plus one synthetic file, so
  // any change to how `written` is built is felt here. The version this
  // replaced filtered a synthetic string through the real sets, which meant
  // its probe never travelled the file walk at all: `filesUnder` skips
  // __tests__, so the name could not enter either set under ANY
  // implementation, and the assertion held unconditionally.
  const withExtra = (path: string, text: string) =>
    [...sources, { path, text: stripComments(text, path) }]

  it('reports a name nothing writes', () => {
    expect(orphansIn(withExtra('synthetic.css', '.x { color: var(--definitely-not-a-token); }')))
      .toEqual(['synthetic.css:1  var(--definitely-not-a-token)'])
  })

  it('is not silenced by a mention inside a comment', () => {
    // The failure this catches: stripComments stops working, and a name that
    // appears only in prose starts counting as written.
    expect(orphansIn(withExtra('synthetic.css',
      '/* --definitely-not-a-token is planned */\n.x { color: var(--definitely-not-a-token); }')))
      .toEqual(['synthetic.css:2  var(--definitely-not-a-token)'])
    expect(orphansIn(withExtra('synthetic.ts',
      "// --definitely-not-a-token is planned\nel.style.color = 'var(--definitely-not-a-token)'")))
      .toEqual(['synthetic.ts:2  var(--definitely-not-a-token)'])
  })

  it('accepts a name a real declaration writes', () => {
    expect(orphansIn(withExtra('synthetic.css',
      ':root { --definitely-not-a-token: red; }\n.x { color: var(--definitely-not-a-token); }')))
      .toEqual([])
  })
})

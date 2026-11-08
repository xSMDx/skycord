/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/*
 * Your own full profile fills its modal.
 *
 * Your own profile is the card alone (`.up.solo`), in a 440px modal. The card
 * sits in a flex ROW (`.up-cols`), and the base `.up-left` is `flex: none`
 * with a fixed 390px width for the two-column layout. The solo rule reset the
 * width to `auto` and kept `flex: none`, and a flex item with no fixed width
 * that may not grow is exactly as wide as its widest line of text. With no bio
 * that was the Edit profile row, about 220px, so the banner was cut short and
 * the status pill was clipped mid-word, with empty modal to its right. A long
 * bio stretched the card and hid the fault, which is why it read as "only some
 * of my profile shows" rather than as a layout bug.
 *
 * The phone layout turns the row into a column, which stretches the card
 * anyway, so this checks the desktop rules (outside any @media block).
 *
 * Components can't be mounted in node, so this reads the stylesheet.
 */
const FILE = resolve(__dirname, '..', 'UserProfileModal.vue')

/** Top-level rules of the scoped stylesheet, @media blocks removed. */
const desktopRules = (): Array<{ selectors: string[]; decls: Record<string, string> }> => {
  const src = readFileSync(FILE, 'utf8')
  const css = /<style scoped>([\s\S]*?)<\/style>/.exec(src)?.[1]
  if (!css) throw new Error('no <style scoped> block in UserProfileModal.vue — update this test')
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Drop every @media block, nested braces and all.
  for (let at = text.indexOf('@media'); at !== -1; at = text.indexOf('@media')) {
    let i = text.indexOf('{', at), depth = 0
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) break
    }
    text = text.slice(0, at) + text.slice(i + 1)
  }
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(',').map(s => s.trim().replace(/\s+/g, ' ')),
    decls: Object.fromEntries(body.split(';').map(d => d.split(':')).filter(p => p.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join(':').trim()])),
  }))
}

/** flex-grow from the shorthand or the longhand; last declaration wins. */
const growOf = (d: Record<string, string>): number | undefined => {
  if (d['flex-grow'] !== undefined) return Number(d['flex-grow'])
  const flex = d.flex
  if (flex === undefined) return undefined
  if (flex === 'none') return 0
  if (flex === 'auto') return 1
  const first = Number(flex.split(/\s+/)[0])
  return Number.isNaN(first) ? undefined : first
}

describe('your own full profile', () => {
  it('stretches the card to the modal instead of shrinking it to its text', () => {
    const rules = desktopRules()
    const base = rules.filter(r => r.selectors.includes('.up-left'))
    const solo = rules.filter(r => r.selectors.includes('.up.solo .up-left'))
    expect(base.length, '.up-left rule not found — update this test').toBeGreaterThan(0)
    expect(solo.length, '.up.solo .up-left rule not found — update this test').toBeGreaterThan(0)

    // The solo selector is more specific, so its declarations win over the base.
    const card = Object.assign({}, ...base.map(r => r.decls), ...solo.map(r => r.decls))
    const width = card.width ?? 'auto'
    const grows = (growOf(card) ?? 0) > 0
    const fullWidth = width === '100%'

    expect(grows || fullWidth,
      `the solo card is width: ${width}, flex: ${card.flex ?? 'unset'} — in the .up-cols row it ` +
      'shrinks to its widest line of text and clips the banner and status pill').toBe(true)
  })
})

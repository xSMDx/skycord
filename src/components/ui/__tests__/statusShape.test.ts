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

const SRC = resolve(__dirname, '../../..')
const relative = (f: string) => f.slice(SRC.length + 1).split('\\').join('/')

describe('status dots', () => {
  // Written wide on purpose. The first version of this matched only
  //   background: statusColor(
  // which is one of the four spellings the slice that added StatusDot
  // actually removed — the others were statusColor[u.status], dotColor and
  // STATUS_COLORS[m.status]. A guard that only recognises the spelling its
  // author happened to type last is not a guard.
  const PAINTS_A_STATUS = /(background|background-color|fill)\s*:\s*[^;{}\n]*\b(statusColor|dotColor|STATUS_COLORS|statusColour)\b/

  it('are all drawn by StatusDot', () => {
    const offenders = walk(SRC)
      .filter(f => !f.endsWith(['components', 'ui', 'StatusDot.vue'].join('\\')))
      .filter(f => PAINTS_A_STATUS.test(readFileSync(f, 'utf8')))
      .map(relative)
    expect(offenders).toEqual([])
  })

  it('would notice a dot painted by hand', () => {
    // Anti-vacuity: the four spellings above are checked against text, so a
    // pattern that stops matching turns the test into a filter over nothing.
    for (const spelling of [
      'background: statusColor(u.status)',
      'background:statusColor[u.status]',
      'background-color: dotColor',
      'fill: STATUS_COLORS[m.status]',
    ]) expect(PAINTS_A_STATUS.test(spelling), spelling).toBe(true)
    for (const innocent of ['background: var(--bg-panel)', 'color: statusColor(s)'])
      expect(PAINTS_A_STATUS.test(innocent), innocent).toBe(false)
  })
})

describe('every StatusDot call site keeps the background half of the contract', () => {
  // StatusDot cuts its shapes with a mask, so the holes show whatever is
  // behind the dot. The contract its own comment states is that each call
  // site's element carries the SAME token as its ring: otherwise a hollow
  // ring shows the avatar through its middle, and a crescent's bite is a
  // slice of someone's photo. .qs-dot was the one site that never got it,
  // and nothing here would have noticed — the rule was simply never touched.
  const files = walk(SRC)
  const sources = new Map(files.map(f => [f, readFileSync(f, 'utf8')]))

  /** Class names that appear on a <StatusDot ... class="x"> anywhere in src. */
  const dotClasses = new Map<string, string>()
  for (const [file, text] of sources)
    for (const tag of text.matchAll(/<StatusDot\b[^>]*?\sclass="([^"]+)"/g))
      for (const name of tag[1].split(/\s+/).filter(Boolean)) dotClasses.set(name, relative(file))

  /** The innermost rule whose selector is exactly this class. */
  const ruleFor = (name: string): string | null => {
    for (const text of sources.values()) {
      const re = new RegExp('(?:^|[}\\n])\\s*\\.' + name + '\\s*\\{([^{}]*)\\}')
      const m = re.exec(text)
      if (m) return m[1]
    }
    return null
  }
  const tokenIn = (decl: string | undefined) =>
    decl ? (/var\(\s*(--[\w-]+)/.exec(decl) || [, decl.trim()])[1] : null

  it('finds the call sites at all', () => {
    expect(dotClasses.size).toBeGreaterThanOrEqual(10)
  })

  for (const [name, where] of [...dotClasses].sort()) {
    it('.' + name + ' (' + where + ')', () => {
      const body = ruleFor(name)
      expect(body, 'no rule found for .' + name).not.toBeNull()
      const decls = new Map([...body!.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)].map(d => [d[1], d[2].trim()]))
      const ring = tokenIn(decls.get('border') ?? decls.get('border-color'))
      const back = tokenIn(decls.get('background') ?? decls.get('background-color'))
      if (ring) expect(back, '.' + name + ' rings with ' + ring + ', so its background must be ' + ring).toBe(ring)
      // A ringless dot must NOT set one: a fixed patch of surface stops
      // matching the moment the row under it hovers.
      else expect(back, '.' + name + ' has no ring, so it must not paint a background either').toBeNull()
    })
  }
})

describe('no status is announced twice', () => {
  // StatusDot names itself (role="img" + aria-label) unless told not to, which
  // is right where the dot is the only thing saying the status — and wrong
  // where the row already prints it. The friends list and Active Now did both,
  // so a screen reader read "Online, image — Alice — Online". StatusDot's own
  // comment documents `named` for exactly this case; nothing enforced it.
  //
  // The test is a proximity heuristic, and says so: a dot and the text that
  // names it are siblings in one row, so a statusLabel() call within this many
  // characters of the tag is treated as the same row. A false positive is
  // answered by an entry in RULED with its reason, not by widening the window.
  const WINDOW = 400

  const RULED: Record<string, string> = {
    'up-status-dot': 'the label is this tag\'s own v-tip, a tooltip, not text beside the dot',
  }

  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const tag of text.matchAll(/<StatusDot\b[^>]*>/g)) {
      if (/:named="false"/.test(tag[0])) continue
      const cls = /\sclass="([^"]+)"/.exec(tag[0])?.[1]?.split(/\s+/)[0] ?? '?'
      if (cls in RULED) continue
      const start = tag.index!
      const near = text.slice(Math.max(0, start - WINDOW), start + tag[0].length + WINDOW)
      // The tag's own v-tip is the tooltip case, not a sibling label.
      const outside = near.split(tag[0]).join(' ')
      if (/statusLabel\s*\(/.test(outside))
        offenders.push(relative(file) + ':' + text.slice(0, start).split('\n').length + '  .' + cls)
    }
  }

  it('has no dot that names a status its own row already prints', () => {
    expect(offenders).toEqual([])
  })

  it('has no ruling for a call site that no longer exists', () => {
    const live = new Set<string>()
    for (const file of walk(SRC))
      for (const tag of readFileSync(file, 'utf8').matchAll(/<StatusDot\b[^>]*>/g))
        for (const name of (/\sclass="([^"]+)"/.exec(tag[0])?.[1] ?? '').split(/\s+/)) live.add(name)
    expect(Object.keys(RULED).filter(k => !live.has(k))).toEqual([])
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

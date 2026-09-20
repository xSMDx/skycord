/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// A transition you cannot see is not a transition.
//
// Four rules in this app paired an opacity fade with a size that snapped:
// .ch-fold, .sidebar and .members-panel in ChatApp, and .ti-slide in
// TypingIndicator. Opening worked — the box took its full size at once and the
// contents faded in. Closing did not: the box collapsed to nothing on the
// first frame, so there was nothing left to fade and the departure was
// instant. Three of them carried a comment describing the fade as though it
// played both ways.
//
// The rule this file holds: every property a *-leave-to changes must be
// answered by its *-leave-active, either by transitioning it or — for a layout
// property, which must never animate — by SCHEDULING its snap for after the
// fade with a `0s <delay>` step. Enter is checked the same way, minus the
// scheduling, since an arrival wants its size immediately.
const SRC = resolve(__dirname, '../..')

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return filesUnder(p)
    return name.endsWith('.vue') || name.endsWith('.css') ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

const cssOf = (file: string): string => {
  const source = readFileSync(file, 'utf8')
  const text = file.endsWith('.css')
    ? source
    : [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * The properties a transition value actually names, exactly.
 *
 * This used to be `declaration.includes(property)`, and a substring is not a
 * name: `max-height` answered for `height`, `padding-top` for `padding`,
 * `background-color` for `color`. In the one file whose whole subject is that
 * a collapse must be accounted for, a leave-to that changed `height` while its
 * leave-active transitioned only `max-height` passed.
 */
const namesIn = (value: string): Set<string> => {
  const names = new Set<string>()
  for (const item of value.split(/,(?![^(]*\))/)) {
    for (const word of item.trim().split(/\s+/)) {
      if (/^[a-z-]+$/.test(word) && !/^(ease|linear|step-start|step-end|normal|none|all|both|infinite|alternate|reverse|forwards|backwards|running|paused)$/.test(word)) {
        names.add(word)
      }
    }
  }
  return names
}

/** Properties that do not belong in a transition at all — they lay out. */
const LAYOUT = /^(width|height|min-width|min-height|max-width|max-height|padding(-[\w]+)?|margin(-[\w]+)?|top|right|bottom|left|inset|flex-basis|gap|row-gap|column-gap)$/
/** Changed by a from/to class but never animated by anyone, by design. */
const NEVER_ANIMATED = /^(pointer-events|visibility|overflow|display|position|z-index|will-change)$/

interface Miss { file: string; name: string; phase: string; property: string; declaration: string }

const misses = (): Miss[] => {
  const out: Miss[] = []
  for (const file of filesUnder(SRC)) {
    const css = cssOf(file)
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]

    for (const phase of ['leave', 'enter'] as const) {
      const endClass = phase === 'leave' ? 'leave-to' : 'enter-from'
      for (const rule of rules) {
        // One selector list may name several transitions; take each name.
        const names = [...rule[1].matchAll(new RegExp('\\.([\\w-]+)-' + endClass + '(?![\\w-])', 'g'))].map(m => m[1])
        if (!names.length) continue
        const changed = [...rule[2].matchAll(/([a-z-]+)\s*:/g)].map(m => m[1]).filter(p => !NEVER_ANIMATED.test(p))
        for (const name of new Set(names)) {
          // Every rule that mentions this phase's active class, because one
          // transition is often split across two descendant selectors.
          const active = rules.filter(r =>
            new RegExp('\\.' + name + '-' + phase + '-active(?![\\w-])').test(r[1]))
          const declaration = active
            .map(a => (/transition\s*:\s*([^;]+)/.exec(a[2]) ?? [, ''])[1]!.trim())
            .filter(Boolean).join(' | ')
          if (!declaration) continue   // no transition at all: nothing is claimed
          const answered = namesIn(declaration)
          for (const property of new Set(changed)) {
            if (answered.has(property)) continue
            out.push({ file: rel(file), name, phase, property, declaration })
          }
        }
      }
    }
  }
  return out
}

describe('a transition can actually be seen', () => {
  const all = misses()

  it('reads the styles it checks', () => {
    expect(filesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('finds transition classes at all', () => {
    const names = filesUnder(SRC).flatMap(f => [...cssOf(f).matchAll(/\.([\w-]+)-leave-active/g)].map(m => m[1]))
    expect(new Set(names).size).toBeGreaterThan(8)
  })

  it('has no property that changes without its transition answering for it', () => {
    expect(all.map(m =>
      `${m.file}  .${m.name}-${m.phase === 'leave' ? 'leave-to' : 'enter-from'} changes ${m.property}, ` +
      `but .${m.name}-${m.phase}-active transitions "${m.declaration}"`)).toEqual([])
  })

  // The same defect wearing different clothes. .ch-fold, .sidebar and
  // .members-panel are not Vue <transition>s — they are a base class with a
  // modifier (.folded, .collapsed, .closed) that sets opacity to 0 and a size
  // to 0 at the same time. The naming convention above cannot see them, so
  // they are found by shape: a rule that fades something out while collapsing
  // it, whose base class declares a transition that does not answer for the
  // collapse.
  const collapsing = (): string[] => {
    const out: string[] = []
    for (const file of filesUnder(SRC)) {
      const rules = [...cssOf(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      for (const rule of rules) {
        const body = rule[2]
        if (!/opacity\s*:\s*0\b/.test(body)) continue
        // SIZE going to zero, not position. `inset: 0` on an overlay means
        // "fill the parent", and reading it as a collapse flagged two rules
        // that were doing nothing of the kind.
        const SIZE = /^(width|height|max-width|max-height|min-width|min-height|padding(-[\w]+)?|margin(-[\w]+)?|gap|row-gap|column-gap|flex-basis)$/
        // Anchored: `padding: 0 6px` and `margin: 0 auto` are layout, not a
        // collapse, and an unanchored match read the first component of each
        // as one. The file had already removed `inset: 0` for this reason.
        const collapsed = [...body.matchAll(/([a-z-]+)\s*:\s*0(?:px|%|em|rem)?\s*(?=[;}]|$)/g)]
          .map(m => m[1]).filter(p => SIZE.test(p))
        if (!collapsed.length) continue
        // The LAST compound, not the first: `.ch-group.folded .ch-fold` is a
        // rule about .ch-fold, and reading .ch-group as the base found a rule
        // with no transition and skipped the whole thing — the identical
        // defect, invisible.
        const compounds = rule[1].trim().split(/\s+/).filter(Boolean)
        const base = /^(\.[\w-]+)/.exec(compounds[compounds.length - 1] ?? '')?.[1]
        if (!base) continue
        const owner = rules.filter(r => r[1].trim() === base)
        const declaration = owner
          .map(o => (/transition\s*:\s*([^;]+)/.exec(o[2]) ?? [, ''])[1]!.trim())
          .filter(Boolean).join(' | ')
        if (!declaration) continue
        // The transition that governs the CLOSE is the one on the collapsed
        // state, because the browser reads it from the computed style after
        // the class lands; with none of its own it inherits the base's.
        const own = (/transition\s*:\s*([^;]+)/.exec(body) ?? [, ''])[1] ?? ''
        const governing = own || declaration

        // Naming the property is not enough. `height 0s` with no delay snaps
        // on the first frame, which is the defect itself — the fade is only
        // visible if the snap is SCHEDULED for after it. So the item must
        // carry a second time value, and that delay must not be zero.
        const scheduled = (property: string) => {
          const item = governing.split(/,(?![^(]*\))/).find(i => i.trim().startsWith(property))
          if (!item) return false
          const times = item.trim().slice(property.length).trim()
            .split(/\s+/).filter(t => /^-?\d*\.?\d+m?s$/.test(t) || /^var\(--dur/.test(t))
          // Zero by VALUE, not by spelling: 0.0s, .0s and 0.00s are the same
          // instant snap as 0s, and matching the literal text let them pass.
          const isZeroTime = (t: string) => /^-?[\d.]+m?s$/.test(t) && Number(t.replace(/m?s$/, '')) === 0
          return times.length >= 2 && !isZeroTime(times[1])
        }
        for (const property of new Set(collapsed))
          if (!scheduled(property))
            out.push(`${rel(file)}  ${rule[1].trim().replace(/\s+/g, ' ')} collapses ${property} ` +
                     `while fading, but "${governing.trim()}" does not schedule that snap for after the fade`)
      }
    }
    return out
  }

  it('has no class-toggle fade whose collapse is unaccounted for', () => {
    expect(collapsing()).toEqual([])
  })

  it('schedules, rather than animates, every layout property it answers for', () => {
    // The two halves of the rule have to agree: a layout property may only be
    // answered by a `0s` step. If one ever appears with a real duration, this
    // fails here and in noLayoutAnimation.test.ts, which is the intent.
    const animated: string[] = []
    for (const file of filesUnder(SRC)) {
      for (const rule of cssOf(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/-(enter|leave)-active(?![\w-])/.test(rule[1])) continue
        const value = (/transition\s*:\s*([^;]+)/.exec(rule[2]) ?? [, ''])[1] ?? ''
        for (const item of value.split(/,(?![^(]*\))/)) {
          const property = item.trim().split(/\s+/)[0]
          if (!LAYOUT.test(property)) continue
          const times = [...item.matchAll(/(?:^|[\s,(])(-?\d*\.?\d+)(ms|s)\b/g)]
          if (times.length && times.every(t => Number(t[1]) === 0)) continue
          animated.push(`${rel(file)}  ${rule[1].trim().replace(/\s+/g, ' ')}  ${item.trim()}`)
        }
      }
    }
    expect(animated).toEqual([])
  })
})

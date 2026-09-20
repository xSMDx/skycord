/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// Durations come from the motion tokens — --dur-1 to --dur-4 and --dur-exit —
// chosen by role, not by the nearest number (audit finding 23). A literal time
// in a transition or an animation is a duration someone picked by hand, which
// is how the app arrived at a dozen near-identical timings and motion that
// never quite agreed with itself. It also escapes the one switch that governs
// all of it: tokens.css's reduced-motion block.
//
// A few literals are not durations in that sense. A loop's period is
// recognised by kind, below; every other exception — the smoothing on a live
// signal, the stagger between two pulses, the release after a drag — is named
// by file and selector with its reason. Never by value: a value-based
// exception would excuse the next hand-picked .26s too.
const SRC = resolve(__dirname, '../..')

// A loop's period is not a UI duration: nothing arrives or leaves, the motion
// simply repeats. Loops are recognised by the `infinite` keyword in the same
// declaration — by kind, not by value — so a spinner or a pulse needs no entry,
// and a finite .26s still fails however it is written.
// Split on top-level commas first: `animation: spin 1.2s linear infinite,
// fadeIn .26s ease-out` is two animations, and only the first is a loop. Read
// as one string, the single `infinite` would excuse the .26s beside it.
const items = (value: string): string[] => {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')') depth--
    else if (value[i] === ',' && depth === 0) { out.push(value.slice(start, i)); start = i + 1 }
  }
  out.push(value.slice(start))
  return out
}
const isLoop = (value: string) => /\binfinite\b/.test(value)

const STAGGER = 'an offset between the members of one repeating motion, not a duration'
const ALLOWED: { file: string; selector: string; why: string }[] = [
  { file: 'components/chat/TypingIndicator.vue', selector: '.d1', why: STAGGER },
  { file: 'components/chat/TypingIndicator.vue', selector: '.d2', why: STAGGER },
  { file: 'components/chat/TypingIndicator.vue', selector: '.d3', why: STAGGER },
  { file: 'components/voice/CallStage.vue', selector: '.s-wave2', why: STAGGER },
  { file: 'components/voice/CallStage.vue', selector: '.g-wave2', why: STAGGER },
  { file: 'components/voice/IncomingCallModal.vue', selector: '.ic-ring2', why: STAGGER },
  { file: 'views/AuthPage.vue', selector: '.b1', why: STAGGER },
  { file: 'views/AuthPage.vue', selector: '.b2', why: STAGGER },
  { file: 'views/AuthPage.vue', selector: '.b3', why: STAGGER },
  { file: 'components/voice/VoiceConnectedPanel.vue', selector: '.vcp-sig :deep(path:nth-child(1))', why: 'the bars rise one after another: offsets, not durations' },
  { file: 'components/voice/VoiceConnectedPanel.vue', selector: '.vcp-sig :deep(path:nth-child(2))', why: 'the bars rise one after another: offsets, not durations' },
  { file: 'components/voice/VoiceConnectedPanel.vue', selector: '.vcp-sig :deep(path:nth-child(3))', why: 'the bars rise one after another: offsets, not durations' },
  { file: 'components/voice/VoiceConnectedPanel.vue', selector: '.vcp-sig :deep(path:nth-child(4))', why: 'the bars rise one after another: offsets, not durations' },
  { file: 'components/voice/MicFlyout.vue', selector: '.mf-fill', why: 'smooths a live signal, updated every frame' },
  { file: 'components/voice/VoiceVideoSettings.vue', selector: '.vv-meter-fill', why: 'smooths a live signal, updated every frame' },
  { file: 'components/modals/ModalBase.vue', selector: '.modal.sheet', why: 'the release after a drag, tuned against the drag itself' },
  { file: 'components/ui/ContextMenu.vue', selector: '.cm.sheet', why: 'the release after a drag, tuned against the drag itself' },
  { file: 'App.vue', selector: '.splash-fill', why: 'a loading bar\'s fill time, not a transition' },
  { file: 'views/ChatApp.vue', selector: ':global(.msg-flash)', why: 'a highlight that fades over its own time so it can be seen' },
]

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return filesUnder(p)
    return name.endsWith('.vue') || name.endsWith('.css') ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

/** The file's style blocks with comments blanked, keeping line numbers true. */
const cssOf = (file: string): { text: string; line: number }[] => {
  const source = readFileSync(file, 'utf8')
  const blank = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  if (file.endsWith('.css')) return [{ text: blank(source), line: 1 }]
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => {
    const start = m.index! + m[0].indexOf('>') + 1
    return { text: blank(m[1]), line: source.slice(0, start).split('\n').length }
  })
}

const TIMED = /^(transition|transition-duration|transition-delay|animation|animation-duration|animation-delay)$/
// The leading class is what keeps this off the "20" in translateY(20px) and
// the "1" in scale(1.05). It also, until the negative sign was added, kept the
// whole guard off every negative time: -4s begins with a character in neither
// branch, so animation-delay:-4s was invisible. A hand-picked -0.26s release
// delay would have passed silently.
const LITERAL_TIME = /(?:^|[\s,(])(-?\d*\.?\d+)(ms|s)\b/

interface Offender { file: string; line: number; selector: string; declaration: string }

const offenders = (): Offender[] => {
  const found: Offender[] = []
  for (const file of filesUnder(SRC)) {
    if (rel(file) === 'styles/tokens.css') continue // where the durations are defined
    for (const { text, line } of cssOf(file)) {
      // Innermost rules: a selector and a body with no braces inside it. That
      // reaches rules nested in @media too, and skips @keyframes' own frames,
      // which hold properties, not timings.
      for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim().replace(/\s+/g, ' ')
        if (/^(from|to|\d+%)/.test(selector)) continue
        for (const decl of rule[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) {
          if (!TIMED.test(decl[1])) continue
          if (!items(decl[2]).some(item => LITERAL_TIME.test(item) && !isLoop(item))) continue
          const at = line + text.slice(0, rule.index! + rule[1].length + 1 + decl.index!).split('\n').length - 1
          found.push({ file: rel(file), line: at, selector, declaration: `${decl[1]}: ${decl[2].trim()}` })
        }
      }
    }
  }
  return found
}

describe('the two things this guard used to be unable to see', () => {
  // Both were found by an independent review, and both are the kind of hole
  // that never shows up as a failure — the guard simply stops looking.
  const sees = (value: string) => items(value).some(i => LITERAL_TIME.test(i) && !isLoop(i))

  it('sees a negative time', () => {
    // These are VALUES: the scanner has already split off the property.
    expect(sees('-4s')).toBe(true)
    expect(sees('-0.26s')).toBe(true)
    expect(sees('transition: opacity -.15s var(--ease-out)')).toBe(true)
  })

  it('sees a finite animation standing beside a loop', () => {
    expect(sees('spin 1.2s linear infinite, fadeIn .26s var(--ease-out)')).toBe(true)
    expect(sees('spin 1.2s linear infinite')).toBe(false)
    expect(sees('pulse 2s ease-in-out infinite alternate')).toBe(false)
  })

  it('still ignores a length, and a time that is already a token', () => {
    expect(sees('transform var(--dur-2) var(--ease-out)')).toBe(false)
    expect(sees('translateY(20px) scale(1.05)')).toBe(false)
    expect(sees('cubic-bezier(.32,.72,0,1)')).toBe(false)
  })

  it('splits on top-level commas only', () => {
    expect(items('a 1s cubic-bezier(.1,.2,.3,.4), b 2s')).toHaveLength(2)
  })
})

describe('durations come from the motion tokens', () => {
  const all = offenders()
  const isAllowed = (o: Offender) => ALLOWED.some(a => a.file === o.file && a.selector === o.selector)

  it('reads the styles it checks', () => {
    expect(filesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('has no literal duration outside the named exceptions', () => {
    expect(all.filter(o => !isAllowed(o)).map(o => `${o.file}:${o.line}  ${o.selector}  ${o.declaration}`)).toEqual([])
  })

  it('has no named exception that no longer exists', () => {
    const dead = ALLOWED.filter(a => !all.some(o => o.file === a.file && o.selector === a.selector))
    expect(dead.map(a => `${a.file}  ${a.selector}`)).toEqual([])
  })
})

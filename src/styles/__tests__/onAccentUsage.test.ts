import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

const SRC = resolve(__dirname, '../..')

const vueFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith('.vue') ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

// A background counts as "the accent" only when it is SOLID — the live accent
// or an opaque shade of it (hover, deep). A low-alpha rgba(--accent-rgb, x)
// wash (a selected row, a "type" pill, a drop-target outline) is a different,
// already-solved pattern: it stays mostly the dark surface it sits on, so the
// surface's normal text tokens are correct there, same as --mention-bg /
// --time-token-bg already pair a tint with a lightened (not flipped-to-ink)
// foreground. Folding tints into this regex was tried and immediately caught
// half a dozen ".selected"/".active" tint rows that were never broken —
// solid-only is what actually matches the --text-on-accent question this file
// audits. A gradient that merely includes the accent as one stop is also
// excluded: onAccentText has no notion of a second colour, so a gradient
// needs its own bespoke treatment, tracked explicitly below rather than
// silently swallowed.
const ACCENT_BG = /background(?:-color)?:\s*var\(--accent(?:-hover|-deep)?\)/

// White, however it's spelled, plus --text-strong — the token that only reads
// as "safe" on an accent because the dark palette's --text-strong happens to
// be white. Both go blind the instant the accent is something white fails on.
const WHITE_ISH = /^(#fff\b|#ffffff\b|white\b|rgba\(\s*255\s*,\s*255\s*,\s*255\b|var\(--text-strong\))/i

interface Rule { file: string; line: number; selectors: string[]; body: string }

// Selector text can span several physical lines (indentation, comments); only
// the line immediately before the "{" is the real selector, same approach the
// scan this was written against used.
const cleanSelector = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n').filter(l => !/^\s*(\/\/|<)/.test(l)).join(' ').trim()

const allRules = (): Rule[] => {
  const rules: Rule[] = []
  for (const file of vueFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const line = text.slice(0, m.index).split('\n').length
      const selectors = cleanSelector(m[1]).split(',').map(s => s.trim()).filter(Boolean)
      if (selectors.length) rules.push({ file: rel(file), line, selectors, body: m[2] })
    }
  }
  return rules
}

const colorValue = (body: string): string | null => {
  const m = /(?:^|[;{])\s*color:\s*([^;]+)/.exec(body)
  return m ? m[1].trim() : null
}
const backgroundValue = (body: string): string | null => {
  const m = /(?:^|[;{])\s*background(?:-color)?:\s*([^;]+)/.exec(body)
  return m ? m[1].trim() : null
}
const describeRule = (r: Rule) => `${r.file}:${r.line}  ${r.selectors.join(', ')}`

describe('text on an accent background', () => {
  const rules = allRules()

  // Class 1 (original regression, generalised): a literal white, or the
  // --text-strong token that is white only by coincidence of today's dark
  // palette, used as the text colour in the SAME rule as an accent background.
  // Rules are inspected WHOLE — scanning line by line misses every rule that
  // declares its background and its colour on separate lines.
  it('never uses white or --text-strong as the colour, however the rule is laid out', () => {
    const offenders: string[] = []
    for (const r of rules) {
      if (!ACCENT_BG.test(r.body)) continue
      const color = colorValue(r.body)
      if (color && WHITE_ISH.test(color)) offenders.push(`${describeRule(r)} :: color: ${color}`)
    }
    expect(offenders).toEqual([])
  })

  // Class 2: an accent background with NO colour declared in that same rule at
  // all. This is not automatically safe — it inherits whatever a less specific
  // rule (often the dark palette's --text-strong, i.e. white) already set,
  // which is exactly how EmojiPickerModal-style bugs shipped without ever
  // writing the word "white" anywhere near the accent.
  //
  // A handful of accent-background rules genuinely have no text to colour —
  // dots, progress fills, toggle tracks, slider thumbs, a pseudo-element
  // underline — and are excluded by name, verified by reading each one, rather
  // than by a shape heuristic that would be more fragile than the list.
  const NOT_TEXT_BEARING = new Set([
    'App.vue:.splash-fill',                                     // progress fill, no label — splash screen is explicitly out of scope for this task
    'components/appearance/ThemePreviewBanner.vue:.tpb-dot',     // status dot
    'components/chat/TypingIndicator.vue:.dot',                  // typing-indicator dot
    'components/chat/ConversationDetails.vue:.cd-tab.on::after', // content: '' underline, never carries text
    'components/voice/VoiceVideoSettings.vue:.vv-tog.on',        // toggle-switch track
    'components/modals/SettingsModal.vue:.ap-toggle.on',         // toggle-switch track
    'styles/settingsShared.css:.st-toggle.on',                   // toggle-switch track
    'components/modals/SettingsModal.vue:.ap-slider::-webkit-slider-thumb', // slider thumb knob
    'components/modals/SettingsModal.vue:.ap-slider::-moz-range-thumb',    // slider thumb knob
  ])
  // The rightmost compound selector, ignoring ancestor scoping: a responsive
  // override like ".shell.mobile .add-friend-btn:active" describes the SAME
  // element's own class as the unscoped ".add-friend-btn" base rule reached
  // through a different (viewport-gated) ancestor — ancestor scoping doesn't
  // change which colour the element itself inherited.
  const tailOf = (selector: string): string => {
    const parts = selector.split(/\s+|(?=[>~])|(?<=[>~])/).map(p => p.trim()).filter(Boolean)
    return parts[parts.length - 1] ?? selector
  }
  // A selector built only by APPENDING pseudo-classes to another selector
  // (".primary:hover" onto ".primary", ":hover:not(:disabled)" onto that)
  // inherits colour from that base rule, same element — correctly, if the base
  // itself already pairs an accent background with a real colour. Only a
  // plain CLASS suffix (".active", ".copied", ".danger") is left un-stripped:
  // that names a genuinely different state, which is precisely what class 3b
  // below checks separately.
  const pseudoPrefixes = (selector: string): string[] => {
    const chain = [selector]
    let cur = selector
    for (;;) {
      const m = /^(.*?)(:{1,2}[a-zA-Z-]+(?:\([^)]*\))?)$/.exec(cur)
      if (!m) break
      cur = m[1]
      chain.push(cur)
    }
    return chain
  }
  const accentAndColour = new Set<string>() // `${file}::${tail selector}` with both an accent background AND a colour, in one rule
  for (const r of rules) if (ACCENT_BG.test(r.body) && colorValue(r.body)) for (const s of r.selectors) accentAndColour.add(`${r.file}::${tailOf(s)}`)

  it('never leaves an accent background to inherit its text colour from elsewhere', () => {
    const offenders: string[] = []
    for (const r of rules) {
      if (!ACCENT_BG.test(r.body)) continue
      if (colorValue(r.body)) continue
      for (const s of r.selectors) {
        const key = `${r.file}:${s}`
        if (NOT_TEXT_BEARING.has(key)) continue
        const prefixes = pseudoPrefixes(tailOf(s))
        if (prefixes.some(p => p !== s && accentAndColour.has(`${r.file}::${p}`))) continue
        offenders.push(`${describeRule(r)} :: ${r.body.trim().replace(/\s+/g, ' ').slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // Class 3a: a DESCENDANT of an accent-background state (:hover, .active, or
  // any other selector whose own rule paints the accent) painting white or
  // --text-strong on itself. The parent's own colour can be perfectly correct
  // — CallFlyout's hovered row sets --text-on-accent on itself and still ships
  // a hardcoded white sub-label underneath it.
  it('never paints white or --text-strong on a descendant of an accent-background rule', () => {
    const accentSelectors: Array<{ file: string; selector: string }> = []
    for (const r of rules) if (ACCENT_BG.test(r.body)) for (const s of r.selectors) accentSelectors.push({ file: r.file, selector: s })

    const offenders: string[] = []
    for (const r of rules) {
      const color = colorValue(r.body)
      if (!color || !WHITE_ISH.test(color)) continue
      for (const s of r.selectors) {
        for (const a of accentSelectors) {
          if (a.file !== r.file || a.selector === s) continue
          // Descendant or child only. A `~` sibling sits beside the accent, not
          // on it, so it is no more "on the accent" than any other element.
          if (s.startsWith(a.selector + ' ') || s.startsWith(a.selector + '>')) {
            offenders.push(`${describeRule(r)}  <- accent ancestor "${a.selector}"  :: color: ${color}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // Class 3b: the SAME element swapping to a non-accent background through a
  // state/modifier class (.danger, .copied, :hover) while its colour keeps
  // coming from the base rule's --text-on-accent — measured against the
  // accent, meaningless against whatever the modifier actually painted.
  it('never lets a state modifier repaint an on-accent element without resetting its colour', () => {
    const onAccentBase: Array<{ file: string; selector: string }> = []
    for (const r of rules) {
      if (!ACCENT_BG.test(r.body)) continue
      const color = colorValue(r.body)
      if (color && /^var\(--text-on-accent\)/.test(color)) for (const s of r.selectors) onAccentBase.push({ file: r.file, selector: s })
    }

    const offenders: string[] = []
    for (const r of rules) {
      const bg = backgroundValue(r.body)
      if (!bg || ACCENT_BG.test(r.body) || /gradient|none|transparent/.test(bg)) continue
      if (colorValue(r.body)) continue // resets its own colour — fine, whatever it picked
      for (const s of r.selectors) {
        for (const base of onAccentBase) {
          if (base.file !== r.file || base.selector === s) continue
          if (s.startsWith(base.selector + '.') || s.startsWith(base.selector + ':')) {
            offenders.push(`${describeRule(r)}  <- base "${base.selector}" (--text-on-accent)  :: background: ${bg}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // Class 4: --text-on-accent used as a colour in a rule whose OWN background
  // is not the accent at all — a border-only "active tab" state (no fill to
  // measure against) being the shipped example. A gradient that merely
  // includes the accent as one stop is excluded: it needs its own measurement
  // against the blend, which is a different, follow-up problem, not "use the
  // wrong flat token" — tracked, not silently swallowed, via the explicit name
  // check below.
  const GRADIENT_EXCEPTIONS = new Set([
    'components/modals/QuickSwitcherModal.vue:.qs-av-group', // background is a two-colour gradient; --text-on-accent is only ever measured against a flat colour
  ])
  // The accent is painted by an inline template :style, never by any CSS rule
  // this file can parse — SettingsModal's preview avatar takes its background
  // from :style="{ background: accentHex }" (see the comment on .ap-prev-av
  // itself). Read by hand and verified true, not a heuristic: a heuristic
  // general enough to spot every inline-style idiom would also be general
  // enough to wave through a rule that never touches the accent at all.
  const INLINE_ACCENT_EXCEPTIONS = new Set([
    'components/modals/SettingsModal.vue:.ap-prev-av',
  ])
  it('never uses --text-on-accent as a colour except in a rule whose own background is the accent', () => {
    // A DESCENDANT of a rule that paints the accent is still "on the accent"
    // for this question — CallFlyout's hovered row (.fly .fr:hover) fills with
    // the accent, and its sub-label/check icon underneath (.fly .fr:hover
    // .fr-sub, .fly .fr:hover .fr-check) correctly wear the same token even
    // though the fill lives on the ancestor's own rule, not theirs. Same
    // selector-prefix approach as the "never paints white on a descendant"
    // check above, for the opposite colour.
    const accentSelectors: Array<{ file: string; selector: string }> = []
    for (const r of rules) if (ACCENT_BG.test(r.body)) for (const s of r.selectors) accentSelectors.push({ file: r.file, selector: s })
    // Descendant or child only: this is an exemption, so a `~` sibling — which
    // sits beside the accent rather than on it — must not earn one.
    const hasAccentAncestor = (file: string, selector: string): boolean =>
      accentSelectors.some(a => a.file === file && a.selector !== selector &&
        (selector.startsWith(a.selector + ' ') || selector.startsWith(a.selector + '>')))

    const offenders: string[] = []
    for (const r of rules) {
      const color = colorValue(r.body)
      if (!color || !/^var\(--text-on-accent\)/.test(color)) continue
      if (ACCENT_BG.test(r.body)) continue
      if (r.selectors.some(s => hasAccentAncestor(r.file, s))) continue
      if (r.selectors.some(s => INLINE_ACCENT_EXCEPTIONS.has(`${r.file}:${s}`))) continue
      const bg = backgroundValue(r.body)
      if (bg && /gradient/.test(bg)) {
        for (const s of r.selectors) expect(GRADIENT_EXCEPTIONS.has(`${r.file}:${s}`), `${describeRule(r)} uses a gradient background with --text-on-accent — verify it's the documented exception, not a new site`).toBe(true)
        continue
      }
      offenders.push(`${describeRule(r)} :: background: ${bg ?? '(none)'}`)
    }
    expect(offenders).toEqual([])
  })

  // Class 5: a hardcoded white SVG stroke/fill in <template> markup, sitting on
  // what is — by class name or by the live accentHex inline style — an
  // accent-coloured surface. Icons don't go through `color`, so none of the
  // CSS-rule checks above can see them; a checkmark or glyph drawn straight
  // into the template with stroke="white" is invisible exactly when the
  // surface it sits on is measured to want ink instead.
  it('never hardcodes a white stroke/fill on an SVG sitting on an accent surface', () => {
    const offenders: string[] = []
    for (const file of vueFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      const f = rel(file)
      // This file's own signals for "this class/element paints the accent" —
      // a CSS rule, or the live-accent inline-style idiom used across the app.
      const accentClasses = new Set<string>()
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!ACCENT_BG.test(m[2])) continue
        for (const s of cleanSelector(m[1]).split(',')) {
          const first = /\.([a-zA-Z0-9_-]+)/.exec(s.trim())
          if (first) accentClasses.add(first[1])
        }
      }
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (!/<svg[^>]*\b(stroke|fill)="\s*(white|#fff|#ffffff)\s*"/i.test(line)) return
        const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
        const hasAccentSignal = /\baccentHex\b/.test(window) || [...accentClasses].some(c => window.includes(`class="${c}"`) || window.includes(`"${c}"`) || new RegExp(`\\b${c}\\b`).test(window))
        if (hasAccentSignal) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

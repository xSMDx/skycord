/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { onAccentText, resolveAccentHex, isLightTheme, isAutoAccent, SKY_DARK, SKY_LIGHT, accentTintsOnDark, accentTintsOnLight } from '../onAccent'

const INK = '#0e0f11'
const WHITE = '#ffffff'

// Relative luminance, WCAG 2.1. Duplicated in the test on purpose: if the
// implementation and the test derive the answer the same way, the test only
// proves the code agrees with itself.
const ratio = (a: string, b: string) => {
  const chan = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const lum = (h: string) => {
    const [r, g, bl] = chan(h).map(c => {
      c /= 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

describe('onAccentText', () => {
  it('picks ink on a light accent and white on a dark one', () => {
    expect(onAccentText('#f0b232')).toBe(INK)    // Yellow — 1.89:1 against white today
    expect(onAccentText('#0a75af')).toBe(WHITE)  // Sky, light theme
  })

  it('clears AA for every shipped preset, which seven of nine did not', () => {
    const presets = ['#38b6f1', '#5865f2', '#23a55a', '#1abc9c', '#3498db',
                     '#eb459e', '#ed4245', '#e67e22', '#f0b232', '#9b59b6']
    for (const hex of presets) {
      expect(ratio(onAccentText(hex), hex)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('always returns whichever of the two has more contrast', () => {
    // The property that matters, stated independently of the threshold used.
    for (const hex of ['#000000', '#ffffff', '#808080', '#38b6f1', '#7f7f00']) {
      const chosen = onAccentText(hex)
      const other = chosen === WHITE ? INK : WHITE
      expect(ratio(chosen, hex)).toBeGreaterThanOrEqual(ratio(other, hex))
    }
  })

  it('resolves the gap between black\'s crossover and ink\'s own', () => {
    // 0.179 is where WHITE and pure black cross over — it is not where WHITE
    // and INK (#0e0f11, luminance 0.00476) cross over; that true crossover is
    // ~0.1898. #767676 has luminance ~0.181, which sits inside that gap: a
    // threshold borrowed from black picks INK here at ~4.2:1 even though
    // WHITE was sitting right there at ~4.54:1. None of the shipped presets
    // land in this gap, which is why they never caught it.
    const hex = '#767676'
    const chosen = onAccentText(hex)
    const other = chosen === WHITE ? INK : WHITE
    expect(ratio(chosen, hex)).toBeGreaterThanOrEqual(ratio(other, hex))
    expect(ratio(chosen, hex)).toBeGreaterThanOrEqual(4.5)
  })

  it('survives a malformed value rather than throwing', () => {
    // Custom accents come from a colour input and from restored settings.
    expect([INK, WHITE]).toContain(onAccentText('not-a-colour'))
  })
})

describe('isLightTheme', () => {
  it('is true for exactly the two light theme families', () => {
    expect(isLightTheme('light')).toBe(true)
    expect(isLightTheme('light-dim')).toBe(true)
  })

  it('is false for dark themes, an unknown name, and undefined', () => {
    expect(isLightTheme('default')).toBe(false)
    expect(isLightTheme('midnight')).toBe(false)
    expect(isLightTheme('amoled')).toBe(false)
    // A theme this function has never heard of (added elsewhere, or a saved
    // snapshot from a future version) must still resolve to something, and
    // dark is the app's fallback family everywhere else in the app.
    expect(isLightTheme('some-future-theme')).toBe(false)
    expect(isLightTheme(undefined)).toBe(false)
  })
})

describe('isAutoAccent', () => {
  it('is true for the sentinel, empty, and undefined', () => {
    expect(isAutoAccent('auto')).toBe(true)
    expect(isAutoAccent('')).toBe(true)
    expect(isAutoAccent(undefined)).toBe(true)
  })

  it('is false for any explicit hex', () => {
    expect(isAutoAccent('#5865f2')).toBe(false)
    expect(isAutoAccent('#38b6f1')).toBe(false)
  })
})

describe('resolveAccentHex', () => {
  it('resolves the auto sentinel to Sky for the theme it is asked about', () => {
    expect(resolveAccentHex('auto', 'default')).toBe(SKY_DARK)
    expect(resolveAccentHex('auto', 'light')).toBe(SKY_LIGHT)
    expect(resolveAccentHex('auto', 'light-dim')).toBe(SKY_LIGHT)
  })

  it('passes an explicit hex through untouched, regardless of theme', () => {
    expect(resolveAccentHex('#5865f2', 'default')).toBe('#5865f2')
    expect(resolveAccentHex('#5865f2', 'light')).toBe('#5865f2')
  })

  it('treats empty and undefined accent the same as auto', () => {
    expect(resolveAccentHex('', 'default')).toBe(SKY_DARK)
    expect(resolveAccentHex('', 'light')).toBe(SKY_LIGHT)
    expect(resolveAccentHex(undefined, 'default')).toBe(SKY_DARK)
    expect(resolveAccentHex(undefined, 'light-dim')).toBe(SKY_LIGHT)
  })

  it('treats an unknown or missing theme name as dark', () => {
    // A saved snapshot can carry a theme this build no longer recognises;
    // falling back to dark matches isLightTheme's own fallback so the two
    // never disagree about the same theme string.
    expect(resolveAccentHex('auto', 'some-future-theme')).toBe(SKY_DARK)
    expect(resolveAccentHex('auto', undefined)).toBe(SKY_DARK)
  })
})

describe('accentTintsOnDark', () => {
  // Independent of the implementation: alpha-composite `hex` over `onto` in
  // sRGB space, the same maths the browser does painting
  // rgba(var(--accent-rgb), .18) over an opaque panel.
  const overlay = (hex: string, alpha: number, onto: string): string => {
    const chan = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const [r, g, b] = chan(hex)
    const [or_, og, ob] = chan(onto)
    const mix = (c: number, o: number) => Math.round(c * alpha + o * (1 - alpha))
    return '#' + [mix(r, or_), mix(g, og), mix(b, ob)].map(x => x.toString(16).padStart(2, '0')).join('')
  }

  // Independent HSL hue (0-360), used only to check the lightened colour
  // hasn't drifted to a different hue — `ratio` above already covers contrast.
  const hue = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    if (d === 0) return 0 // achromatic — no hue to compare against
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
    return h < 0 ? h + 360 : h
  }
  const hueDiff = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }

  const CHAT_SURFACE = '#313338'
  // Every shipped preset, Sky included — the same list useAppearance.ts's
  // ACCENT_PRESETS ships in the color picker.
  const PRESETS = ['#38b6f1', '#5865f2', '#23a55a', '#1abc9c', '#3498db',
                   '#eb459e', '#ed4245', '#e67e22', '#f0b232', '#9b59b6']

  it('lightens mention-fg to at least 4.6:1 against the dark chat surface, for every shipped preset', () => {
    for (const hex of PRESETS) {
      const { mentionFg } = accentTintsOnDark(hex)
      expect(ratio(mentionFg, CHAT_SURFACE)).toBeGreaterThanOrEqual(4.6)
    }
  })

  it('lightens accent-text to at least 4.6:1 against its own 18% tint over the chat surface, for every shipped preset', () => {
    for (const hex of PRESETS) {
      const { accentText } = accentTintsOnDark(hex)
      const tintedSurface = overlay(hex, 0.18, CHAT_SURFACE)
      expect(ratio(accentText, tintedSurface)).toBeGreaterThanOrEqual(4.6)
    }
  })

  it('keeps both results within a couple degrees of the accent\'s own hue', () => {
    // A search that lightened by desaturating instead of mixing toward white
    // would still be able to clear the contrast tests above while drifting
    // toward grey — this is what catches that.
    for (const hex of PRESETS) {
      const { mentionFg, accentText } = accentTintsOnDark(hex)
      const base = hue(hex)
      expect(hueDiff(hue(mentionFg), base)).toBeLessThanOrEqual(2)
      expect(hueDiff(hue(accentText), base)).toBeLessThanOrEqual(2)
    }
  })
})

describe('accentTintsOnLight', () => {
  // Independent of the implementation, same as accentTintsOnDark's own copies
  // above — duplicated rather than imported so this suite cannot pass merely
  // because it agrees with itself.
  const overlay = (hex: string, alpha: number, onto: string): string => {
    const chan = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const [r, g, b] = chan(hex)
    const [or_, og, ob] = chan(onto)
    const mix = (c: number, o: number) => Math.round(c * alpha + o * (1 - alpha))
    return '#' + [mix(r, or_), mix(g, og), mix(b, ob)].map(x => x.toString(16).padStart(2, '0')).join('')
  }
  const hue = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    if (d === 0) return 0 // achromatic — no hue to compare against
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
    return h < 0 ? h + 360 : h
  }
  const hueDiff = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }

  // The darker of light's (#ffffff) and light-dim's (#eceef0) --bg-chat —
  // see onAccent.ts's own comment on CHAT_SURFACE_LIGHT for why the darker
  // one is the value both families have to hold against.
  const CHAT_SURFACE = '#eceef0'
  const PRESETS = ['#38b6f1', '#5865f2', '#23a55a', '#1abc9c', '#3498db',
                   '#eb459e', '#ed4245', '#e67e22', '#f0b232', '#9b59b6']

  it('darkens mention-fg to at least 4.6:1 against the darker light chat surface, for every shipped preset', () => {
    for (const hex of PRESETS) {
      const { mentionFg } = accentTintsOnLight(hex)
      expect(ratio(mentionFg, CHAT_SURFACE)).toBeGreaterThanOrEqual(4.6)
    }
  })

  it('darkens accent-text to at least 4.6:1 against its own 18% tint over the darker light chat surface, for every shipped preset', () => {
    for (const hex of PRESETS) {
      const { accentText } = accentTintsOnLight(hex)
      const tintedSurface = overlay(hex, 0.18, CHAT_SURFACE)
      expect(ratio(accentText, tintedSurface)).toBeGreaterThanOrEqual(4.6)
    }
  })

  it('also clears 4.6:1 against the lighter (#ffffff) member of the family, not just the darker one it was measured against', () => {
    for (const hex of PRESETS) {
      const { mentionFg, accentText } = accentTintsOnLight(hex)
      expect(ratio(mentionFg, '#ffffff')).toBeGreaterThanOrEqual(4.6)
      expect(ratio(accentText, overlay(hex, 0.18, '#ffffff'))).toBeGreaterThanOrEqual(4.6)
    }
  })

  it('keeps both results within a couple degrees of the accent\'s own hue', () => {
    // Same drift check as accentTintsOnDark's: a search that darkened by
    // desaturating instead of scaling toward black would still clear the
    // contrast tests above while drifting toward grey.
    for (const hex of PRESETS) {
      const { mentionFg, accentText } = accentTintsOnLight(hex)
      const base = hue(hex)
      expect(hueDiff(hue(mentionFg), base)).toBeLessThanOrEqual(2)
      expect(hueDiff(hue(accentText), base)).toBeLessThanOrEqual(2)
    }
  })
})

describe('tokens.css defaults', () => {
  // tokens.css's :root block is a hand-copied snapshot of accentTintsOnDark(SKY_DARK)
  // (see the comment above --mention-fg there) — nothing regenerates it at build
  // time. If SKY_DARK, the chat surface, the lighten step, or the contrast target
  // ever changes, that snapshot goes stale (possibly below AA) with every other
  // test here still green, because none of them look at the stylesheet. Reading
  // tokens.css as text and comparing it against the live function is what actually
  // catches that drift.
  const css = readFileSync(resolve(__dirname, '../../styles/tokens.css'), 'utf8')
  // Scoped to the FIRST :root { ... } block only — the one holding the dark
  // defaults — so a light-theme override of the same custom property (those use
  // var(--accent) / var(--accent-deep), never a literal hex) can't be mistaken
  // for the default.
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  const token = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)
    if (!m) throw new Error(`--${name} not found in tokens.css's :root block`)
    return m[1].toLowerCase()
  }

  it('matches accentTintsOnDark(SKY_DARK), including the name-hover/time-token-fg mirrors', () => {
    const { mentionFg, accentText } = accentTintsOnDark(SKY_DARK)
    expect(token('mention-fg')).toBe(mentionFg)
    expect(token('name-hover')).toBe(mentionFg)
    expect(token('accent-text')).toBe(accentText)
    expect(token('time-token-fg')).toBe(accentText)
  })

  // Same drift concern, for the accent hex itself rather than its derived
  // tints: onAccent.ts's own SKY_DARK/SKY_LIGHT comment says these "match
  // tokens.css's own --accent for each family verbatim" — nothing enforced
  // that until now, so the two could silently disagree about what Sky is.
  const themeBlock = (theme: string): string =>
    new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ''
  const tokenIn = (block: string, name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)
    if (!m) throw new Error(`--${name} not found in the given block`)
    return m[1].toLowerCase()
  }

  it(':root and both light blocks paint --accent with SKY_DARK/SKY_LIGHT', () => {
    expect(token('accent')).toBe(SKY_DARK)
    expect(tokenIn(themeBlock('light'), 'accent')).toBe(SKY_LIGHT)
    expect(tokenIn(themeBlock('light-dim'), 'accent')).toBe(SKY_LIGHT)
  })
})

describe('tokens.css green/danger text tokens', () => {
  // Same drift concern as the suite above, for a different pair of hand-typed
  // snapshots: --text-on-green and --text-on-danger are onAccentText of
  // --green/--danger themselves, so if either base colour ever changes, these
  // go stale — possibly below AA — with every other test here still green.
  const css = readFileSync(resolve(__dirname, '../../styles/tokens.css'), 'utf8')
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  const token = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)
    if (!m) throw new Error(`--${name} not found in tokens.css's :root block`)
    return m[1].toLowerCase()
  }

  it('text-on-green and text-on-danger match onAccentText of their own base colour', () => {
    expect(token('text-on-green')).toBe(onAccentText(token('green')))
    expect(token('text-on-danger')).toBe(onAccentText(token('danger')))
  })

  it('text-on-danger-hover matches onAccentText of --danger-hover', () => {
    // ConfirmModal.vue's .cfm-confirm.danger:hover used to paint its own
    // literal #c73e3e — a different shade from --danger-hover (#c93b3e) the
    // component never adopted — so this test used to read that literal out of
    // the component rather than trust a token of the same name. The colour
    // sweep (slice 3, Task 4) tokenised that hover rule onto --danger-hover
    // itself, so there is now exactly one hover shade to measure against:
    // resolve it from tokens.css like every other token in this file, and
    // keep failing if either value drifts.
    expect(token('text-on-danger-hover')).toBe(onAccentText(token('danger-hover')))
  })

  it('text-on-green-deep matches onAccentText of the "Copied"/"on" shade used at InviteGroupModal and InviteServerModal, not --green', () => {
    // #248046 — also hardcoded at CallBar's .cb-b.on, PermissionsTab's
    // .allow.on and VoiceConnectedPanel's .on — is a distinct, darker green
    // from --green (#23a55a), and onAccentText disagrees between the two
    // (see the comment beside --text-on-green-deep in tokens.css), so it
    // cannot share --text-on-green's stored value.
    expect(token('text-on-green-deep')).toBe(onAccentText('#248046'))
    expect(token('text-on-green-deep')).not.toBe(token('text-on-green'))
  })
})

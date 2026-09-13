/**
 * Which of the two text colours to put ON the accent.
 *
 * `--text-on-accent` used to be pinned to #ffffff "in every theme", which is
 * why seven of the nine shipped presets failed AA — Yellow at 1.89:1. White is
 * right for a dark accent and wrong for a light one, and since the accent can
 * be any colour the user types, the only answer that cannot rot is to measure
 * it. Material-You already derived this correctly from its own palette; this is
 * the same idea for every other path.
 *
 * The pick is made by computing the WCAG contrast ratio of the accent against
 * each candidate and keeping the higher one — not by comparing the accent's
 * luminance to a fixed crossover point. A crossover point is only valid for
 * the exact pair of colours it was derived from; this function pairs WHITE
 * with INK, not with pure black, so a threshold borrowed from black silently
 * mis-ranks any accent whose luminance falls between the two. Measuring both
 * ratios directly makes no assumption about what INK or WHITE are, so it
 * stays correct even if either one changes.
 */
const INK = '#0e0f11'
const WHITE = '#ffffff'

const luminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  // A malformed value means a colour we cannot reason about. Treat it as dark,
  // so the text stays white and legible on the app's usual surfaces.
  if (!m) return 0
  const [r, g, b] = [0, 2, 4].map(i => {
    let c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (aHex: string, bHex: string): number => {
  const a = luminance(aHex)
  const b = luminance(bHex)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

export const onAccentText = (accentHex: string): string =>
  contrast(INK, accentHex) >= contrast(WHITE, accentHex) ? INK : WHITE

/**
 * Sky, the app's accent, for each theme family. Dark and light themes use
 * different hex values (light needs a deeper blue to hold contrast on a
 * bright surface), so resolving 'auto' requires knowing which family the
 * theme in question belongs to — there is no single "the" Sky. These match
 * tokens.css's own `--accent` for each family verbatim; drifting from that
 * stylesheet would make a resolved hex lie about what the live CSS paints.
 */
export const SKY_DARK = '#38b6f1'
export const SKY_LIGHT = '#0a75af'

/**
 * Only `light` and `light-dim` are the light family; every other theme name
 * — including one this build has never heard of, e.g. from a saved snapshot
 * written by a newer version — falls back to dark. That fallback has to
 * match `resolveAccentHex`'s own fallback below, or the two functions could
 * disagree about the same unrecognised theme string.
 */
export const isLightTheme = (theme: string | undefined): boolean =>
  theme === 'light' || theme === 'light-dim'

/**
 * Turn an accent SETTING into an actual paintable colour, for a given theme.
 *
 * This takes theme as an explicit argument rather than reading "the current
 * theme" from anywhere, because the accent and the theme it must resolve
 * against are not always the same live pair: a saved theme snapshot carries
 * both its own accent and its own theme, and a preview of that snapshot has
 * to show what THAT theme's Sky looks like, not whatever theme happens to be
 * on screen right now. Resolving against the wrong theme is exactly the bug
 * this function exists to make impossible — pass the two together, always
 * from the same snapshot (or both from the live appearance).
 */
export const resolveAccentHex = (accent: string | undefined, theme: string | undefined): string =>
  accent && accent !== 'auto' ? accent : (isLightTheme(theme) ? SKY_LIGHT : SKY_DARK)

const hexChannels = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  // Same "treat it as dark" fallback as luminance() above, for the same reason.
  const n = m ? m[1] : '000000'
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)) as [number, number, number]
}
const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')

// Blend toward white by fraction `t` (0 = unchanged, 1 = white). Every channel
// moves by the same factor (1 - t), which is what keeps the hue fixed: hue is
// a function of the ratios between channel differences, and scaling every
// difference by one shared factor leaves those ratios untouched. Desaturating
// in HSL instead would land on the same contrast but drift toward grey.
const towardWhite = (hex: string, t: number): string => {
  const [r, g, b] = hexChannels(hex)
  return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t)
}

// Composite `hex` at `alpha` over an opaque `onto` — the same maths the
// browser performs painting e.g. rgba(var(--accent-rgb), .18) over a panel.
const compositeOver = (hex: string, alpha: number, onto: string): string => {
  const [r, g, b] = hexChannels(hex)
  const [orr, og, ob] = hexChannels(onto)
  return toHex(r * alpha + orr * (1 - alpha), g * alpha + og * (1 - alpha), b * alpha + ob * (1 - alpha))
}

// The chat surface the dark family's mention/accent-text tokens are tuned
// against (tokens.css's --bg-chat default). Fixed rather than parameterised:
// these two CSS custom properties are single flat values shared by every dark
// theme (default, midnight, amoled, the studio presets), not recomputed per
// theme, so there is no "which surface" to pass in without changing that.
const CHAT_SURFACE_DARK = '#313338'

// Small enough that the step from one candidate to the next is never a
// visually meaningful jump; large enough to resolve in a couple hundred
// iterations at most. There's no closed-form solution because contrast is not
// linear in the lightening fraction, so this searches instead of computing.
const LIGHTEN_STEP = 0.005

const lightenUntil = (accentHex: string, clears: (candidate: string) => boolean): string => {
  for (let t = 0; t <= 1; t += LIGHTEN_STEP) {
    const candidate = towardWhite(accentHex, t)
    if (clears(candidate)) return candidate
  }
  // Unreachable in practice — white clears 4.5:1 against any surface this
  // dark — but a real colour beats a NaN-tainted one if it ever is.
  return '#ffffff'
}

/**
 * Dark-theme values for `--mention-fg` and `--accent-text`, measured from the
 * accent instead of hand-picked. Both tokens were tuned once for blurple's
 * hue (#5865f2) and never revisited when the accent became a user choice —
 * lightening blurple toward white happens to land somewhere legible, but nothing
 * about that result generalises to a hue at the opposite side of the wheel, so
 * every other accent (including Sky, the new default) inherited a lavender
 * that has nothing to do with its own colour.
 *
 * `--name-hover` and `--time-token-fg` are not computed separately: they carry
 * the same values as `mentionFg` and `accentText` respectively, exactly as the
 * static defaults in tokens.css already do.
 */
export const accentTintsOnDark = (accentHex: string): { mentionFg: string; accentText: string } => {
  const mentionFg = lightenUntil(accentHex, c => contrast(c, CHAT_SURFACE_DARK) >= 4.5)
  // The tint mention-fg's sibling actually sits on is the ACCENT's own colour
  // at 18% (--mention-bg's alpha), not the lightened candidate's — matching
  // how the CSS paints it: rgba(var(--accent-rgb), .18) over --bg-chat.
  const ownTint = compositeOver(accentHex, 0.18, CHAT_SURFACE_DARK)
  const accentText = lightenUntil(accentHex, c => contrast(c, ownTint) >= 4.5)
  return { mentionFg, accentText }
}

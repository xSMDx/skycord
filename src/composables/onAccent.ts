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

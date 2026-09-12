/**
 * Which of the two text colours to put ON the accent.
 *
 * `--text-on-accent` used to be pinned to #ffffff "in every theme", which is
 * why seven of the nine shipped presets failed AA — Yellow at 1.89:1. White is
 * right for a dark accent and wrong for a light one, and since the accent can
 * be any colour the user types, the only answer that cannot rot is to measure
 * it. Material-You already derived this correctly from its own palette; this is
 * the same idea for every other path.
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

export const onAccentText = (accentHex: string): string =>
  // 0.179 is where white and black cross over for contrast against a colour.
  luminance(accentHex) > 0.179 ? INK : WHITE

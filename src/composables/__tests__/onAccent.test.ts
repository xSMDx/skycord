import { describe, it, expect } from 'vitest'
import { onAccentText } from '../onAccent'

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

/**
 * The Skycord mark's geometry: a round-topped head wearing headphones.
 *
 * The head is a dome over a softly squared jaw. The headband is a ring that
 * shares the dome's centre, so the gap between them is even all the way over;
 * its ends drop into the earcups. Band and cups are traced as ONE outline (the
 * points where the ring leaves each cup are solved below), so head, eyes and
 * headphones can be a single even-odd path with no overlaps.
 *
 *   node brand/make-mark.mjs
 *
 * writes brand/skycord-mark.svg and brand/skycord-mark-small.svg and prints the
 * path strings that src/brand/mark.ts carries.
 */
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const n = v => +v.toFixed(2)
const pt = ([x, y]) => `${n(x)},${n(y)}`

/** Where circle (c, R) meets circle (k, r): the intersection with the smaller y (the upper one). */
function meet([cx, cy], R, [kx, ky], r) {
  const dx = kx - cx, dy = ky - cy, d = Math.hypot(dx, dy)
  const a = (R * R - r * r + d * d) / (2 * d), h = Math.sqrt(R * R - a * a)
  const bx = cx + (a * dx) / d, by = cy + (a * dy) / d
  const p1 = [bx - (h * dy) / d, by + (h * dx) / d], p2 = [bx + (h * dy) / d, by - (h * dx) / d]
  return p1[1] < p2[1] ? p1 : p2
}

/**
 * @param m.c      shared centre of dome and band
 * @param m.dome   dome radius; the jaw corners have radius m.jaw, the chin sits at m.chin
 * @param m.band   [inner, outer] radii of the headband
 * @param m.cup    [width, top, bottom] of each earcup (fully rounded ends), centred on the band
 * @param m.eye    [dx, dy, r]: eyes at c.x ± dx, c.y + dy
 */
function build(m) {
  const [cx, cy] = m.c, D = m.dome, J = m.jaw
  const head = `M${cx - D},${cy}A${D},${D} 0 0 1 ${cx + D},${cy}V${m.chin - J}` +
    `A${J},${J} 0 0 1 ${cx + D - J},${m.chin}H${cx - D + J}A${J},${J} 0 0 1 ${cx - D},${m.chin - J}Z`

  const [ri, ro] = m.band, [w, top, bottom] = m.cup, cr = w / 2
  const mid = (ri + ro) / 2
  const lx = cx - mid, rx = cx + mid                    // cup centre lines
  const capL = [lx, top + cr], capR = [rx, top + cr]    // centres of the cups' top caps
  const oL = meet(m.c, ro, capL, cr), iL = meet(m.c, ri, capL, cr)
  const oR = [2 * cx - oL[0], oL[1]], iR = [2 * cx - iL[0], iL[1]]
  const gear =
    `M${lx - cr},${bottom - cr}V${top + cr}A${cr},${cr} 0 0 1 ${pt(oL)}` +   // left cup, outer side, up to the band
    `A${ro},${ro} 0 0 1 ${pt(oR)}` +                                          // over the top
    `A${cr},${cr} 0 0 1 ${rx + cr},${top + cr}V${bottom - cr}` +              // right cup, outer side, down
    `A${cr},${cr} 0 0 1 ${rx - cr},${bottom - cr}V${top + cr}` +              // round the bottom, up the inner side
    `A${cr},${cr} 0 0 1 ${pt(iR)}` +
    `A${ri},${ri} 0 0 0 ${pt(iL)}` +                                          // back under the band
    `A${cr},${cr} 0 0 1 ${lx + cr},${top + cr}V${bottom - cr}` +
    `A${cr},${cr} 0 0 1 ${lx - cr},${bottom - cr}Z`

  const [edx, edy, er] = m.eye
  const eyes = [{ cx: cx - edx, cy: cy + edy, r: er }, { cx: cx + edx, cy: cy + edy, r: er }]
  return { head, gear, eyes }
}

const circle = ({ cx, cy, r }) => `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`
const full = g => g.head + g.eyes.map(circle).join('') + g.gear

// Regular: 32 px and up.
const regular = build({ c: [128, 150], dome: 72, jaw: 48, chin: 218, band: [90, 108], cup: [34, 113, 187], eye: [24, 6, 14] })
// Small cut, 24 px and under: a heavier band, wider gaps and bigger eyes, so nothing closes up on the pixel grid.
const small = build({ c: [128, 150], dome: 68, jaw: 46, chin: 216, band: [90, 112], cup: [36, 110, 190], eye: [25, 6, 19] })

const svg = d => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>Skycord</title><path fill="#000" fill-rule="evenodd" d="${d}"/></svg>\n`
const here = p => fileURLToPath(new URL(p, import.meta.url))
writeFileSync(here('./skycord-mark.svg'), svg(full(regular)))
writeFileSync(here('./skycord-mark-small.svg'), svg(full(small)))
console.log(JSON.stringify({ regular, small }, null, 2))

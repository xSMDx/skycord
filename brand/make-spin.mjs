/**
 * The spinning mark (src/assets/lottie/skycord-spin.json), built from the same
 * numbers as src/brand/mark.ts so the animation can never drift from the logo.
 *
 * The head turns once, headphones and all, with a little overshoot; each eye
 * follows on its own, the left a beat behind, the right a beat after that, so
 * the face "catches up" with itself. Everything shares one even-odd fill:
 * wherever an eye sits on the head it is a hole, as in the still mark.
 *
 *   node brand/make-spin.mjs
 *
 * Needs Node 22.18+ (it imports the TypeScript module directly).
 */
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { HEAD, GEAR, EYES_AT } from '../src/brand/mark.ts'

const PAD = 16              // the mark sits in a 288 canvas, as the old asset did
const C = 144
const r3 = n => Math.round(n * 1000) / 1000

// SVG path (absolute M V H L A Z only, as HEAD uses) → Lottie bezier vertices.
function toBezier(d) {
  const tokens = d.match(/[MVHLAZ]|-?\d*\.?\d+/g)
  const v = [], i = [], o = []
  let k = 0, cur = [0, 0], start = [0, 0]
  const num = () => Number(tokens[k++])
  const push = (p, inT = [0, 0]) => { v.push(p); i.push(inT); o.push([0, 0]) }
  const curve = (c1, c2, p) => {
    const last = v.length - 1
    o[last] = [c1[0] - v[last][0], c1[1] - v[last][1]]
    push(p, [c2[0] - p[0], c2[1] - p[1]])
  }
  while (k < tokens.length) {
    const cmd = tokens[k++]
    if (cmd === 'M') { cur = start = [num(), num()]; push(cur) }
    else if (cmd === 'V') { cur = [cur[0], num()]; push(cur) }
    else if (cmd === 'H') { cur = [num(), cur[1]]; push(cur) }
    else if (cmd === 'L') { cur = [num(), num()]; push(cur) }
    else if (cmd === 'A') {
      const rx = num(); num(); num(); const large = num(); const sweep = num(); const p = [num(), num()]
      for (const [c1, c2, end] of arcToCubics(cur, rx, large, sweep, p)) curve(c1, c2, end)
      cur = p
    } else if (cmd === 'Z') {
      const last = v.length - 1
      if (Math.hypot(v[last][0] - start[0], v[last][1] - start[1]) < 1e-6) {
        i[0] = i[last]; v.pop(); i.pop(); o.pop()
      }
    }
  }
  const shift = p => [r3(p[0] + PAD), r3(p[1] + PAD)]
  return { c: true, v: v.map(shift), i: i.map(t => t.map(r3)), o: o.map(t => t.map(r3)) }
}

// A circular arc (rx === ry, no rotation) as cubic segments of at most 90°.
function arcToCubics([x1, y1], r, large, sweep, [x2, y2]) {
  const mx = (x1 - x2) / 2, my = (y1 - y2) / 2
  const d2 = mx * mx + my * my
  const f = Math.sqrt(Math.max(0, (r * r - d2) / d2)) * (large === sweep ? -1 : 1)
  const cx = f * my + (x1 + x2) / 2, cy = -f * mx + (y1 + y2) / 2
  let a1 = Math.atan2(y1 - cy, x1 - cx), a2 = Math.atan2(y2 - cy, x2 - cx)
  let delta = a2 - a1
  if (sweep && delta < 0) delta += 2 * Math.PI
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  const n = Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9)
  const step = delta / n, t = (4 / 3) * Math.tan(step / 4)
  const out = []
  for (let s = 0; s < n; s++) {
    const b0 = a1 + s * step, b1 = b0 + step
    const p0 = [cx + r * Math.cos(b0), cy + r * Math.sin(b0)]
    const p1 = [cx + r * Math.cos(b1), cy + r * Math.sin(b1)]
    out.push([
      [p0[0] - t * r * Math.sin(b0), p0[1] + t * r * Math.cos(b0)],
      [p1[0] + t * r * Math.sin(b1), p1[1] - t * r * Math.cos(b1)],
      s === n - 1 ? [x2, y2] : p1,
    ])
  }
  return out
}

const still = k => ({ a: 0, k })
const spin = until => ({ a: 1, k: [{ o: { x: 0.34, y: 1.55 }, i: { x: 0.65, y: 1 }, s: [0], t: 0 }, { s: [360], t: until }] })
const tr = r => ({ ty: 'tr', p: still([C, C]), a: still([C, C]), s: still([100, 100]), r, o: still(100), sk: still(0), sa: still(0) })
const group = (nm, it) => ({ ty: 'gr', nm, it })
const eye = (nm, { cx, cy, r }, until) =>
  group(nm, [{ ty: 'el', d: 1, p: still([cx + PAD, cy + PAD]), s: still([2 * r, 2 * r]) }, tr(spin(until))])

const [left, right] = EYES_AT
const lottie = {
  v: '5.7.0', fr: 60, ip: 0, op: 90, w: 288, h: 288, nm: 'skycord-spin', ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, nm: 'mark', sr: 1, ip: 0, op: 90, st: 0, bm: 0,
    ks: { o: still(100), r: still(0), p: still([0, 0]), a: still([0, 0]), s: still([100, 100]) },
    shapes: [group('mark', [
      eye('eye right', right, 60),
      eye('eye left', left, 45),
      group('head', [{ ty: 'sh', ks: still(toBezier(HEAD)) }, { ty: 'sh', ks: still(toBezier(GEAR)) }, tr(spin(30))]),
      { ty: 'fl', nm: 'fill', c: still([0, 0, 0]), o: still(100), r: 2 },
      tr(still(0)),
    ])],
  }],
}

const target = fileURLToPath(new URL('../src/assets/lottie/skycord-spin.json', import.meta.url))
writeFileSync(target, JSON.stringify(lottie) + '\n')
console.log('wrote', target)

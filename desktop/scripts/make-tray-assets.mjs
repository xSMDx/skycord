/**
 * The tray icon (plain and with an unread dot) and the taskbar badges 1–9 and
 * 9+. Generated rather than drawn at run time: Electron's nativeImage cannot
 * draw, and a badge is the same eleven images forever. Each is rendered at 4x
 * and scaled down, so the circle's edge is smooth.
 *
 *   node desktop/scripts/make-tray-assets.mjs
 *
 * Needs ffmpeg with drawtext, and Segoe UI Bold — both on the Windows machine
 * this is run on. The output is committed; nobody needs to run it to build.
 */
import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'static', 'tray')
const icon = join(here, '..', 'build', 'icon.png')
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf'
const RED = { r: 242, g: 63, b: 67 }   // the app's danger red, #f23f43
mkdirSync(out, { recursive: true })

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1) }
}
const disc = (cx, cy, rad) => `lte(hypot(X-${cx},Y-${cy}),${rad})`

// Tray, 32x32, plain.
run(['-i', icon, '-vf', 'scale=32:32:flags=lanczos', join(out, 'tray.png')])

// Tray with a red dot top-right, at 4x then down.
const dot = disc(100, 28, 26)
run(['-i', icon, '-vf',
  `scale=128:128:flags=lanczos,format=rgba,geq=r='if(${dot},${RED.r},r(X,Y))':g='if(${dot},${RED.g},g(X,Y))':b='if(${dot},${RED.b},b(X,Y))':a='if(${dot},255,alpha(X,Y))',scale=32:32:flags=lanczos`,
  join(out, 'tray-unread.png')])

// Badges: a red disc with a white number, 4x then 32x32.
for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']) {
  const name = label === '9+' ? '9plus' : label
  const size = label === '9+' ? 56 : 80
  const d = disc(63.5, 63.5, 62)
  run(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=128x128,format=rgba', '-frames:v', '1', '-vf',
    `geq=r='if(${d},${RED.r},0)':g='if(${d},${RED.g},0)':b='if(${d},${RED.b},0)':a='if(${d},255,0)',` +
    `drawtext=fontfile='${FONT}':text='${label}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=(h-text_h)/2-4,scale=32:32:flags=lanczos`,
    join(out, `badge-${name}.png`)])
}
console.log('wrote', out)

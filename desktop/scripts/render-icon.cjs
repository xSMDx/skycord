// Every raster icon, from the masters in brand/: the Windows app icon (every
// size into build/icon.ico, and a 512 build/icon.png), the tray icon with and
// without its unread dot (static/tray), and the web app's icons in public/.
// Run: npm run icon
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', '..')
const out = (...p) => path.join(root, ...p)
const SKY = '#38b6f1'
const INK = '#0b0c0f'
const RED = '#f23f43'   // the app's danger red
const master = name => fs.readFileSync(out('brand', name), 'utf8')
// At 24 px and under, the small cut: a heavier band and bigger eyes survive the pixel grid.
const mark = size => master(size <= 24 ? 'skycord-mark-small.svg' : 'skycord-mark.svg').replace('fill="#000"', `fill="${SKY}"`)
// The mark on an ink square at `scale` of the tile, centred on its own box (y 42–218).
const tile = (size, scale) => {
  const inner = mark(size).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/, '')
  const tx = 128 - 128 * scale, ty = 128 - 130 * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="${INK}"/>` +
    `<g transform="translate(${tx} ${ty}) scale(${scale})">${inner}</g></svg>`
}
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('data:text/html,<meta charset=utf-8>')
  // dot: [cx, cy, r] in pixels — the unread dot, cut free of the mark by a clear ring.
  const png = async (svg, size, dot) => {
    const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
    const url = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode()
      const c = document.createElement('canvas'); c.width = c.height = ${size}
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, ${size}, ${size})
      const dot = ${JSON.stringify(dot ?? null)}
      if (dot) {
        const [x, y, r] = dot
        ctx.globalCompositeOperation = 'destination-out'
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill()
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = ${JSON.stringify(RED)}
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      }
      return c.toDataURL('image/png')
    })()`)
    return Buffer.from(url.split(',')[1], 'base64')
  }

  const pngs = {}
  for (const size of SIZES) pngs[size] = await png(mark(size), size)
  fs.writeFileSync(out('desktop', 'build', 'icon.png'), pngs[512])
  // ICO with PNG entries (Vista and later): header, directory, then the images.
  const inIco = SIZES.filter(s => s <= 256)
  const head = Buffer.alloc(6 + 16 * inIco.length)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(inIco.length, 4)
  let offset = head.length
  inIco.forEach((s, i) => {
    const e = 6 + 16 * i, png = pngs[s]
    head.writeUInt8(s === 256 ? 0 : s, e); head.writeUInt8(s === 256 ? 0 : s, e + 1)
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  fs.writeFileSync(out('desktop', 'build', 'icon.ico'), Buffer.concat([head, ...inIco.map(s => pngs[s])]))

  // Tray, 32x32: plain, and with the red dot top-right.
  fs.writeFileSync(out('desktop', 'static', 'tray', 'tray.png'), pngs[32])
  fs.writeFileSync(out('desktop', 'static', 'tray', 'tray-unread.png'), await png(mark(32), 32, [25, 7, 6.5]))

  // Web app: full-bleed ink tiles (iOS and launchers round them), the maskable one
  // smaller so the tail stays inside the 80% safe circle.
  fs.writeFileSync(out('public', 'icon-192.png'), await png(tile(192, 0.66), 192))
  fs.writeFileSync(out('public', 'icon-512.png'), await png(tile(512, 0.66), 512))
  fs.writeFileSync(out('public', 'icon-maskable-512.png'), await png(tile(512, 0.6), 512))
  fs.writeFileSync(out('public', 'apple-touch-icon.png'), await png(tile(180, 0.62), 180))
  app.quit()
})

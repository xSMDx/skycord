// The app icon, from the transparent mark in public/skycord-icon.svg: every
// Windows size into build/icon.ico, and a 512 build/icon.png.
// Run: npm run icon
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const svgPath = path.join(__dirname, '..', '..', 'public', 'skycord-icon.svg')
const outDir = path.join(__dirname, '..', 'build')
const svg = fs.readFileSync(svgPath, 'utf8')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512]
// Optical sizing: at small sizes a heavier stroke and larger eyes survive the pixel grid.
const tune = size => size <= 32 ? { stroke: 22, eye: 16 } : size <= 48 ? { stroke: 19, eye: 14 } : { stroke: 16, eye: 12 }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('data:text/html,<meta charset=utf-8>')
  const pngs = {}
  for (const size of SIZES) {
    const { stroke, eye } = tune(size)
    const s = svg.replace('stroke-width="16"', `stroke-width="${stroke}"`).replace(/r="12"/g, `r="${eye}"`)
    const src = 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64')
    const url = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode()
      const c = document.createElement('canvas'); c.width = c.height = ${size}
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, ${size}, ${size})
      return c.toDataURL('image/png')
    })()`)
    pngs[size] = Buffer.from(url.split(',')[1], 'base64')
    if (size === 512) fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[size])
  }
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
  fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([head, ...inIco.map(s => pngs[s])]))
  app.quit()
})

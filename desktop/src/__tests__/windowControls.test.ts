/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Skycord draws its own minimise, maximise/restore and close at the right end of
// its title bar, instead of Windows' overlay buttons (which kept Snap Layouts'
// hover menu, but could only be recoloured, not drawn to match).
const root = resolve(__dirname, '..', '..')
const read = (f: string) => readFileSync(resolve(root, f), 'utf8')

const html = read('static/titlebar.html')
const page = read('src/titlebarPage.ts')
const appWindow = read('src/appWindow.ts')
const preload = read('src/preload.ts')

/** The bar's barred window, from its declaration to the next top-level one. */
const barred = appWindow.slice(appWindow.indexOf('const createBarredWindow'), appWindow.indexOf('export const createAppWindow'))

/** One button's markup, by id. */
const button = (id: string) => {
  const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?</button>`))
  expect(m, `button #${id}`).not.toBeNull()
  return m![0]
}
const paths = (markup: string) => [...markup.matchAll(/<path d="([^"]+)"\/>/g)].map(m => m[1])

const LUCIDE = {
  x: ['M18 6 6 18', 'm6 6 12 12'],
  maximize: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  minimize: ['M8 3v3a2 2 0 0 1-2 2H3', 'M21 8h-3a2 2 0 0 1-2-2V3', 'M3 16h3a2 2 0 0 1 2 2v3', 'M16 21v-3a2 2 0 0 1 2-2h3'],
  minus: ['M5 12h14'],
}

describe('the window has no native caption buttons', () => {
  it('the barred window hides the title bar and has no overlay', () => {
    expect(barred).toMatch(/titleBarStyle: 'hidden'/)
    expect(appWindow).not.toMatch(/titleBarOverlay|setTitleBarOverlay/)
  })

  it('stays resizable from its edges (no frame: false, no thickFrame: false, no resizable: false)', () => {
    expect(barred).not.toMatch(/thickFrame: false|resizable: false|maximizable: false/)
  })

  it('the framed (Light) window keeps the plain Windows frame', () => {
    const framed = appWindow.slice(appWindow.indexOf('const createFramedWindow'), appWindow.indexOf('const createBarredWindow'))
    expect(framed).toMatch(/frame: true/)
    expect(framed).not.toMatch(/titleBarStyle/)
  })
})

describe('the bar draws minimise, maximise/restore and close', () => {
  it('in Windows order, at the right of the bar, after the title', () => {
    const order = ['id="title"', 'id="win-min"', 'id="win-max"', 'id="win-close"'].map(s => html.indexOf(s))
    expect(order.every(i => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('with the lucide icons, exactly', () => {
    expect(paths(button('win-min'))).toEqual(LUCIDE.minus)
    expect(paths(button('win-close'))).toEqual(LUCIDE.x)
    // Maximise holds both: the maximize icon while floating, minimize while maximised.
    const max = button('win-max')
    expect(max).toMatch(/class="when-floating"/)
    expect(max).toMatch(/class="when-maximized"/)
    expect(paths(max.slice(0, max.indexOf('when-maximized')))).toEqual(LUCIDE.maximize)
    expect(paths(max.slice(max.indexOf('when-maximized')))).toEqual(LUCIDE.minimize)
  })

  it('drawn like the back and forward icons', () => {
    for (const id of ['win-min', 'win-max', 'win-close']) {
      for (const svg of button(id).match(/<svg[^>]*>/g)!) {
        expect(svg).toMatch(/viewBox="0 0 24 24"/)
        expect(svg).toMatch(/stroke="currentColor"/)
        expect(svg).toMatch(/stroke-width="2"/)
        expect(svg).toMatch(/stroke-linecap="round"/)
        expect(svg).toMatch(/stroke-linejoin="round"/)
        expect(svg).toMatch(/aria-hidden="true"/)
      }
    }
  })

  it('labelled, with tooltips', () => {
    expect(button('win-min')).toMatch(/aria-label="Minimise" title="Minimise"/)
    expect(button('win-max')).toMatch(/aria-label="Maximise" title="Maximise"/)
    expect(button('win-close')).toMatch(/aria-label="Close" title="Close"/)
  })

  it('Windows-sized, out of the drag region, and with a red close', () => {
    expect(html).toMatch(/\.winctl \{[^}]*-webkit-app-region: no-drag/)
    expect(html).toMatch(/\.winctl button \{[^}]*width: 46px; height: 32px/)
    expect(html).toMatch(/\.winctl button:focus-visible \{[^}]*outline: 2px solid var\(--text\)/)
    expect(html).toMatch(/#win-close:hover \{[^}]*background: var\(--danger\); color: #fff/)
    expect(html.match(/--danger: #[0-9a-f]{6}/g)?.length).toBe(1)
  })

  it('hidden in full screen', () => {
    expect(html).toMatch(/\[data-fullscreen\] \.winctl \{[^}]*display: none/)
  })

  it('the title stays clear of the three buttons (3 × 46px on the right)', () => {
    const reserve = Number(html.match(/max-width: calc\(100vw - (\d+)px\)/)![1])
    expect(reserve / 2).toBeGreaterThanOrEqual(3 * 46 + 8)
  })
})

describe('the bar asks the main process to minimise, maximise and close', () => {
  it('the bar sends titlebar:window with one of three actions', () => {
    expect(preload).toMatch(/windowAction: \(action: 'minimize' \| 'toggle-maximize' \| 'close'\) => ipcRenderer\.send\('titlebar:window', action\)/)
    expect(page).toMatch(/'win-min'[\s\S]*api\.windowAction\('minimize'\)/)
    expect(page).toMatch(/'win-max'[\s\S]*api\.windowAction\('toggle-maximize'\)/)
    expect(page).toMatch(/'win-close'[\s\S]*api\.windowAction\('close'\)/)
  })

  it('main acts only for this window\'s bar', () => {
    expect(barred).toMatch(/ipcMain\.on\('titlebar:window', \(event, action: unknown\) => \{\s*if \(event\.sender !== win\.webContents\) return/)
  })

  it('minimise and maximise/restore go to the window', () => {
    const handler = barred.slice(barred.indexOf("ipcMain.on('titlebar:window'"))
    expect(handler).toMatch(/action === 'minimize'\) win\.minimize\(\)/)
    expect(handler).toMatch(/win\.isMaximized\(\) \? win\.unmaximize\(\) : win\.maximize\(\)/)
  })

  it('close goes through win.close(), so close-to-tray still applies', () => {
    const handler = barred.slice(barred.indexOf("ipcMain.on('titlebar:window'"))
    expect(handler).toMatch(/action === 'close'\) win\.close\(\)/)
    expect(handler).not.toMatch(/win\.(destroy|hide)\(\)/)
    expect(read('src/main.ts')).toMatch(/shellWin\.win\.on\('close', e => \{\s*if \(closeAction\(/)
  })
})

describe('the bar knows whether the window is maximised', () => {
  it('main pushes titlebar:maximized on maximise, unmaximise, restore and the bar\'s load', () => {
    expect(barred).toMatch(/send\('titlebar:maximized', win\.isMaximized\(\)\)/)
    expect(barred).toMatch(/for \(const e of \['maximize', 'unmaximize', 'restore'[^\]]*\]\) win\.on\(e as 'maximize', pushWindow\)/)
    expect(barred).toMatch(/const push = \(\) => \{[^}]*pushWindow\(\)/)
    expect(barred).toMatch(/did-finish-load', push\)/)
  })

  it('and whether it is in full screen', () => {
    expect(barred).toMatch(/send\('titlebar:fullscreen', win\.isFullScreen\(\)\)/)
    expect(barred).toMatch(/'enter-full-screen', 'leave-full-screen'\]\) win\.on\(e as 'maximize', pushWindow\)/)
  })

  it('the preload passes both to the bar', () => {
    expect(preload).toMatch(/onMaximized: \(cb: \(maximized: unknown\) => void\) => \{ ipcRenderer\.on\('titlebar:maximized'/)
    expect(preload).toMatch(/onFullScreen: \(cb: \(fullScreen: unknown\) => void\) => \{ ipcRenderer\.on\('titlebar:fullscreen'/)
  })

  it('the bar swaps maximise for restore, icon and label', () => {
    expect(page).toMatch(/api\.onMaximized\(/)
    expect(page).toMatch(/dataset\.maximized/)
    expect(page).toMatch(/const label = maximized \? 'Restore' : 'Maximise'/)
    expect(html).toMatch(/\[data-maximized\] \.when-floating[^{]*\{[^}]*display: none/)
    expect(html).toMatch(/:not\(\[data-maximized\]\) \.when-maximized[^{]*\{[^}]*display: none/)
  })
})

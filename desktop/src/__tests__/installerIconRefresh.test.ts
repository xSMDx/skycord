/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// An update replaces Skycord.exe and its icon, but Windows keeps drawing the old
// one on pinned and Start-menu shortcuts until its icon cache is rebuilt. The
// installer (which is also what an update runs) tells the shell to refresh.
const root = resolve(__dirname, '..', '..')
const read = (f: string) => readFileSync(resolve(root, f), 'utf8')

describe('the Windows installer refreshes icons after an install or update', () => {
  it('electron-builder includes the extra installer steps', () => {
    expect(read('electron-builder.yml')).toMatch(/^\s+include: build\/installer\.nsh$/m)
  })

  it('customInstall tells the shell associations changed (SHCNE_ASSOCCHANGED)', () => {
    const nsh = read('build/installer.nsh')
    expect(nsh).toMatch(/!macro customInstall[\s\S]*shell32::SHChangeNotify\(i 0x08000000[\s\S]*!macroend/)
  })

  it('customInstall also rebuilds the icon cache with ie4uinit -show', () => {
    expect(read('build/installer.nsh')).toMatch(/!macro customInstall[\s\S]*nsExec::Exec '"\$SYSDIR\\ie4uinit\.exe" -show'[\s\S]*!macroend/)
  })
})

// The running app's taskbar button and Alt+Tab use the window icon when one is
// set, read fresh at launch, so they show the new icon even before the cache is.
describe('every taskbar window sets the app icon at runtime', () => {
  it('ships static/icon.ico identical to build/icon.ico', () => {
    expect(readFileSync(resolve(root, 'static/icon.ico')).equals(readFileSync(resolve(root, 'build/icon.ico')))).toBe(true)
  })

  it('the main window (both kinds) and the splash pass APP_ICON', () => {
    expect(read('src/appWindow.ts').match(/icon: APP_ICON/g)?.length).toBe(2)
    expect(read('src/splash.ts')).toMatch(/icon: APP_ICON/)
    expect(read('src/appIcon.ts')).toMatch(/'static', process\.platform === 'win32' \? 'icon\.ico' : 'icon\.png'/)
  })

  // Linux cannot read an .ico, so its windows get the PNG.
  it('ships static/icon.png identical to build/icon.png', () => {
    expect(readFileSync(resolve(root, 'static/icon.png')).equals(readFileSync(resolve(root, 'build/icon.png')))).toBe(true)
  })
})

describe('the title bar text', () => {
  it('has room for descenders (g, q, y) despite overflow: hidden', () => {
    expect(read('static/titlebar.html')).toMatch(/\.text \{[^}]*overflow: hidden[^}]*line-height: 18px/)
  })
})

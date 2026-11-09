import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { APP_USER_MODEL_ID, appUserModelId } from '../appUserModelId'

/**
 * The identity Windows groups a window under: its taskbar button, its pins,
 * its toasts. The installed app's must be the installer's appId, or its own
 * Start-menu shortcut does not claim its windows. A dev run must never share
 * it: on 2026-10-04 a shortcut made to test a dev build's toasts carried the
 * installed app's id, and from then on the installed Skycord showed
 * Electron's logo on the taskbar and its pins launched the dev electron.exe.
 */
describe('appUserModelId', () => {
  it('is the installer\'s appId for the installed app', () => {
    const yml = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8')
    const appId = /^appId:\s*(\S+)\s*$/m.exec(yml)?.[1]
    expect(appId, 'electron-builder.yml has an appId').toBeTruthy()
    expect(APP_USER_MODEL_ID).toBe(appId)
    expect(appUserModelId(true)).toBe(appId)
  })

  it('is a different id for a dev run, so nothing made for it can claim the installed app', () => {
    expect(appUserModelId(false)).not.toBe(APP_USER_MODEL_ID)
    expect(appUserModelId(false)).toBe('xyz.skycord.desktop.dev')
  })

  it('is what main sets, from whether the app is packaged', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8')
    expect(main).toMatch(/app\.setAppUserModelId\(appUserModelId\(app\.isPackaged\)\)/)
    expect(main).not.toMatch(/setAppUserModelId\('xyz\.skycord\.desktop'\)/)
  })
})

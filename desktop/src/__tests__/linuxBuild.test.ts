/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// The Linux build: an AppImage that updates itself and a .deb, released into
// the same draft as the Windows installer, without touching Windows' feed.
const root = resolve(__dirname, '..', '..')
const read = (f: string) => readFileSync(resolve(root, f), 'utf8')
const builder = read('electron-builder.yml')
const pkg = JSON.parse(read('package.json')) as Record<string, unknown>
const release = read('../.github/workflows/desktop-release.yml')

/** One top-level job of the release workflow, up to the next. */
const job = (name: string) => {
  const start = release.indexOf(`\n  ${name}:\n`)
  expect(start, `job ${name}`).toBeGreaterThan(-1)
  const next = release.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next === -1 ? release.slice(start) : release.slice(start, start + 1 + next)
}

describe('electron-builder builds Linux', () => {
  it('targets an AppImage and a .deb', () => {
    expect(builder).toMatch(/^linux:\n  target:\n    - AppImage\n    - deb$/m)
  })

  it('names the .desktop file after desktopName, which Electron uses as the window app_id', () => {
    expect(pkg.desktopName).toBe('skycord.desktop')
    expect(builder).toMatch(/^  executableName: skycord$/m)
    expect(builder).toMatch(/^  syncDesktopName: true$/m)
  })

  it('gives the launcher entry a name, an icon and chat categories', () => {
    expect(builder).toMatch(/^  icon: build\/icon\.png$/m)
    expect(builder).toMatch(/^      Name: Skycord$/m)
    expect(builder).toMatch(/^      Categories: Network;InstantMessaging;Chat;$/m)
  })

  it('makes the .deb depend on the real ALSA, which Electron links and the defaults leave out', () => {
    // t64 first: apt satisfies a bare libasound2 on Ubuntu 24.04 with OSS's
    // emulation, which lacks ALSA's symbols.
    expect(builder).toMatch(/^  depends:\n(    - [\w.-]+\n)*    - libasound2t64 \| libasound2$/m)
    expect(builder).toMatch(/^    - libgtk-3-0$/m)
  })

  it('uses the static AppImage runtime, which needs no libfuse2', () => {
    expect(builder).toMatch(/^toolsets:\n  appimage: "1\.0\.3"$/m)
  })

  it('leaves the Windows installer as it was', () => {
    expect(builder).toMatch(/^win:\n  target: nsis\n  icon: build\/icon\.ico$/m)
    expect(builder).toMatch(/^  artifactName: Skycord-Setup-\$\{version\}\.\$\{ext\}$/m)
  })
})

describe('the release workflow', () => {
  it('drafts the release once, before either build', () => {
    expect(job('draft')).toMatch(/gh release create "v\$V" -R "\$REPO" --draft/)
    expect(job('windows')).toMatch(/needs: draft/)
    expect(job('linux')).toMatch(/needs: draft/)
  })

  it('builds Windows on Windows, with the addon, as before', () => {
    const w = job('windows')
    expect(w).toMatch(/runs-on: windows-latest/)
    expect(w).toMatch(/run: npm run build:native/)
    expect(w).toMatch(/run: npm run release/)
  })

  it('builds Linux on Ubuntu and uploads into the same draft', () => {
    const l = job('linux')
    expect(l).toMatch(/runs-on: ubuntu-latest/)
    expect(l).toMatch(/electron-builder --linux --publish always/)
    expect(l).not.toMatch(/build:native/)
  })

  it('publishes only once both feeds are in the release', () => {
    const p = job('publish')
    expect(p).toMatch(/needs: \[draft, windows, linux\]/)
    for (const f of ['latest.yml', 'latest-linux.yml', 'Skycord-Setup-$V.exe', 'Skycord-$V.AppImage']) expect(p).toContain(f)
    expect(p).toMatch(/gh release edit "v\$V" -R "\$REPO" --draft=false --latest/)
  })
})

describe('Windows-only calls are skipped on Linux', () => {
  it('Notification.handleActivation, which does not exist off Windows', () => {
    expect(read('src/toasts.ts')).toMatch(/if \(process\.platform === 'win32'\) Notification\.handleActivation\(/)
  })

  it('the overlay badge, Jump List and toast identity', () => {
    expect(read('src/tray.ts')).toMatch(/if \(win && process\.platform === 'win32'\) \{\n\s+const badge/)
    expect(read('src/main.ts')).toMatch(/if \(process\.platform === 'win32'\) app\.setAppUserModelId/)
    expect(read('src/main.ts')).toMatch(/if \(process\.platform === 'win32'\) \{\n\s+app\.setUserTasks/)
  })
})

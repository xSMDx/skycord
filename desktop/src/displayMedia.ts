/**
 * Screen share. Electron refuses getDisplayMedia unless the app answers the
 * request itself, so without this a call could not share at all.
 *
 * Deliberately minimal: a native menu listing screens and windows. The
 * designed picker (roadmap 5.6) replaces it in a 0.20.x release. On Windows a
 * whole-screen share can carry system audio, so it does when the page asks.
 */
import { BrowserWindow, Menu, desktopCapturer, session } from 'electron'
import { sameOrigin } from './rules'

export const handleDisplayMedia = (getWindow: () => BrowserWindow | null, getOrigin: () => string | null): void => {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const win = getWindow()
    if (!win || !sameOrigin(request.securityOrigin ?? request.frame?.url ?? '', getOrigin())) { callback({}); return }

    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    if (!sources.length) { callback({}); return }

    let answered = false
    const answer = (value: Parameters<typeof callback>[0]) => { if (!answered) { answered = true; callback(value) } }
    const screens = sources.filter(s => s.id.startsWith('screen:'))
    const windows = sources.filter(s => s.id.startsWith('window:'))

    const item = (s: Electron.DesktopCapturerSource) => ({
      label: s.name.length > 60 ? `${s.name.slice(0, 57)}…` : s.name,
      click: () => answer({ video: s, ...(request.audioRequested && s.id.startsWith('screen:') ? { audio: 'loopback' as const } : {}) }),
    })

    const menu = Menu.buildFromTemplate([
      { label: 'Share your screen', enabled: false },
      ...screens.map(item),
      ...(windows.length ? [{ type: 'separator' as const }, { label: 'Or a window', enabled: false }, ...windows.map(item)] : []),
      { type: 'separator' },
      { label: 'Cancel', click: () => answer({}) },
    ])
    // Closing the menu without a choice cancels the share. The close callback
    // can run before the click handler, so it waits a tick.
    menu.popup({ window: win, callback: () => setTimeout(() => answer({}), 0) })
  })
}

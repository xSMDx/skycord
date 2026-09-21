/**
 * Skycord for Windows — a thin shell.
 *
 * The window loads an instance's own web client rather than a copy bundled
 * here, so the UI is always the version that server runs. The page gets no
 * Node, no Electron and no filesystem: contextIsolation, no nodeIntegration,
 * and the renderer sandboxed. The preload is the only surface it gains.
 *
 * Across the top is the app's own title bar (appWindow.ts), the page below it.
 * First launch shows the local server picker; after that the saved instance
 * opens directly. Every server used is saved (servers.ts), to switch back to.
 */
import { app, ipcMain, session, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { lookupInstance, normaliseAddress, type InstanceProfile } from './instanceAddress'
import { readStore, writeStore } from './store'
import { externalSafe, needsSecureOriginSwitch, permissionAllowed, sameOrigin } from './rules'
import { handleDisplayMedia } from './displayMedia'
import { startUpdates } from './updates'
import { createAppWindow, type AppWindow } from './appWindow'
import { openServersWindow, closeServersWindow } from './serversWindow'
import { readServers, saveServer, renameServer, readdressServer, removeServer, hostOf, type SavedServer } from './servers'
import { DEFAULT_COLORS, parseColors, parseTitleState, type TitleState } from './titleState'

const PRELOAD = join(__dirname, 'preload.js')
const PICKER = join(app.getAppPath(), 'static', 'picker.html')
const PICKER_URL = pathToFileURL(PICKER).href

// A plain-http server on the network needs its origin treated as secure, or
// the microphone is refused. Chromium reads that switch only at startup, so it
// is set here, before the app is ready, from what was saved last time.
const startupOrigin = normaliseAddress(readStore().instanceOrigin ?? '')
if (startupOrigin && needsSecureOriginSwitch(startupOrigin)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', startupOrigin)
}

// One Skycord at a time. A second launch (a shortcut, or the Jump List's
// Switch server) hands its arguments to the one running and exits.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
const SWITCH = '--switch-server'

let shellWin: AppWindow | null = null
/** The instance on screen; null while the picker is showing. */
let current: string | null = null

// ── saved servers ──
const servers = () => readServers(readStore().servers)
const keepServers = (list: SavedServer[]) => { writeStore({ ...readStore(), servers: list }); return list }

/** A profile's icon is relative to its server; saved, it is absolute. */
const iconOf = (profile: InstanceProfile, origin: string) => {
  try { return profile.icon ? new URL(profile.icon, origin).href : null } catch { return null }
}

/** Fill in a saved server's name and icon from its profile, in the background.
 *  A name the member gave it is kept. */
const enrich = (origin: string) => {
  void lookupInstance(origin).then(r => {
    if (!r.ok) return
    keepServers(saveServer(servers(), { origin, name: r.profile.nameIsAddress ? '' : r.profile.name, icon: iconOf(r.profile, origin) }, { keepName: true }))
  })
}

// ── what the page shows ──
/** The title bar for a server whose client doesn't describe itself. */
const titleFor = (origin: string): TitleState => {
  const s = servers().find(x => x.origin === origin)
  return { title: s?.name ?? hostOf(origin), kind: 'server', icon: s?.icon ?? null, canBack: false, canForward: false }
}

const showPicker = (query?: Record<string, string>) => {
  current = null
  shellWin?.setTitle({ title: 'Choose a server', kind: 'picker', icon: null, canBack: false, canForward: false })
  shellWin?.setColors(DEFAULT_COLORS)
  void shellWin?.page.loadFile(PICKER, query ? { query } : undefined)
}

const openInstance = (origin: string) => {
  current = origin
  shellWin?.setTitle(titleFor(origin))
  shellWin?.setColors(DEFAULT_COLORS)
  void shellWin?.page.loadURL(`${origin}/`)
}

/** Open a server: save it, remember it, and load it — or restart first, for a
 *  new plain-http one, whose origin must be marked secure at startup. */
const choose = (origin: string, meta?: { name?: unknown; icon?: unknown }) => {
  const clean = normaliseAddress(origin)
  if (!clean) return undefined
  keepServers(saveServer(servers(), { origin: clean, name: meta?.name, icon: meta?.icon }, { keepName: true }))
  writeStore({ ...readStore(), instanceOrigin: clean })
  if (!meta?.name) enrich(clean)
  if (needsSecureOriginSwitch(clean) && clean !== startupOrigin) {
    // The short wait lets the page say so before the window goes.
    setTimeout(() => { app.relaunch(); app.exit(0) }, 1200)
    return { restarting: true }
  }
  closeServersWindow()
  openInstance(clean)
  return { restarting: false }
}

/** The Servers window over the page, or the picker itself when no server is on screen. */
const manageServers = (dark = true) => {
  if (current && shellWin) openServersWindow(shellWin.win, dark, PRELOAD)
  else showPicker()
}

// ── the page's guards ──
const guard = (page: WebContents) => {
  // The page may move within its own origin. Anything else is a link out:
  // web links open in the system browser, everything else is dropped.
  const leave = (url: string) => { if (externalSafe(url)) void shell.openExternal(url) }
  page.on('will-navigate', (event, url) => {
    if (sameOrigin(url, current)) return
    event.preventDefault()
    leave(url)
  })
  page.on('will-redirect', (event, url) => {
    if (current && !sameOrigin(url, current)) { event.preventDefault(); leave(url) }
  })
  // A server that doesn't answer must not leave a blank window. Back to the
  // picker, which says so. The saved server stays, so the next launch retries.
  page.on('did-fail-load', (_e, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted, not failed */ || !current || !sameOrigin(url, current)) return
    showPicker({ unreachable: current })
  })
  page.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, current)) void page.loadURL(url)
    else leave(url)
    return { action: 'deny' }
  })
}

// ── calls from the local picker page (in the window, or the Servers window) ──
// The preload withholds this API from any other page; this is the second lock.
const fromPicker = (event: IpcMainInvokeEvent) => event.senderFrame?.url.split(/[?#]/)[0] === PICKER_URL
const originArg = (v: unknown) => (typeof v === 'string' ? normaliseAddress(v) : null)

ipcMain.handle('picker:lookup', (event, address: unknown) => {
  if (!fromPicker(event) || typeof address !== 'string') return { ok: false, reason: 'Not allowed.' }
  return lookupInstance(address)
})
ipcMain.handle('picker:choose', (event, origin: unknown, meta: unknown) => {
  if (!fromPicker(event) || typeof origin !== 'string') return undefined
  return choose(origin, meta && typeof meta === 'object' ? meta as { name?: unknown; icon?: unknown } : undefined)
})
ipcMain.handle('servers:list', event => (fromPicker(event) ? { servers: servers(), current } : null))
ipcMain.handle('servers:save', (event, entry: unknown) => (fromPicker(event) ? keepServers(saveServer(servers(), entry, { keepName: true })) : null))
ipcMain.handle('servers:rename', (event, origin: unknown, name: unknown) => {
  const o = originArg(origin)
  return fromPicker(event) && o ? keepServers(renameServer(servers(), o, name)) : null
})
ipcMain.handle('servers:readdress', (event, origin: unknown, next: unknown) => {
  const o = originArg(origin)
  if (!fromPicker(event) || !o) return null
  const list = keepServers(readdressServer(servers(), o, next))
  // The server moved: the next launch should follow it.
  const moved = originArg((next as { origin?: unknown } | null)?.origin)
  if (moved && readStore().instanceOrigin === o) writeStore({ ...readStore(), instanceOrigin: moved })
  return list
})
ipcMain.handle('servers:remove', (event, origin: unknown) => {
  const o = originArg(origin)
  return fromPicker(event) && o ? keepServers(removeServer(servers(), o)) : null
})
ipcMain.handle('servers:close', event => { if (fromPicker(event)) closeServersWindow() })

// ── calls from the instance on screen ──
const fromInstance = (event: IpcMainInvokeEvent | IpcMainEvent) =>
  !!shellWin && event.sender === shellWin.page && sameOrigin(event.senderFrame?.url ?? '', current)

// An older client's Switch server button: the Servers window now does that.
ipcMain.handle('desktop:changeInstance', event => { if (fromInstance(event)) manageServers() })
ipcMain.handle('desktop:openServers', (event, hints: unknown) => {
  if (fromInstance(event)) manageServers((hints as { dark?: unknown } | null)?.dark !== false)
})
ipcMain.on('desktop:title', (event, value: unknown) => {
  const s = fromInstance(event) ? parseTitleState(value) : null
  if (s) shellWin!.setTitle(s)
})
ipcMain.on('desktop:titleColors', (event, value: unknown) => {
  const c = fromInstance(event) ? parseColors(value) : null
  if (c) shellWin!.setColors(c)
})

app.on('second-instance', (_e, argv) => {
  const w = shellWin?.win
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.focus()
  if (argv.includes(SWITCH)) manageServers()
})

// No page may embed another browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

app.whenReady().then(() => {
  if (!primary) return
  // Permissions go to the chosen origin only, and only the ones a chat app needs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permissionAllowed(permission, details.requestingUrl, current)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, current))

  shellWin = createAppWindow(PRELOAD, dir => { if (current) shellWin?.page.send('desktop:nav', dir) })
  guard(shellWin.page)
  handleDisplayMedia(() => shellWin?.win ?? null, () => shellWin?.page ?? null, () => current)

  // Servers used before the list existed join it.
  if (startupOrigin && !servers().some(s => s.origin === startupOrigin)) {
    keepServers(saveServer(servers(), { origin: startupOrigin }))
    enrich(startupOrigin)
  }
  if (process.argv.includes(SWITCH) || !startupOrigin) showPicker()
  else openInstance(startupOrigin)

  // Right-click the taskbar icon for Switch server. It works whatever the
  // server's web client is: one too old to have the button, or one that's down.
  if (process.platform === 'win32') {
    app.setUserTasks([{
      program: process.execPath,
      arguments: app.isPackaged ? SWITCH : `"${app.getAppPath()}" ${SWITCH}`,
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'Switch server',
      description: 'Choose a different Skycord server',
    }])
  }
  startUpdates(() => shellWin?.win ?? null)
})

app.on('window-all-closed', () => app.quit())

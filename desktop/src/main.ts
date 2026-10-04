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
import { release } from 'os'
import { pathToFileURL } from 'url'
import { lookupInstance, normaliseAddress, type InstanceProfile } from './instanceAddress'
import { readStore, writeStore } from './store'
import { externalSafe, needsSecureOriginSwitch, permissionAllowed, sameOrigin } from './rules'
import { handleDisplayMedia } from './displayMedia'
import { startUpdates, currentUpdateState, checkForUpdatesNow, installUpdateNow, onBeforeInstall } from './updates'
import { initToasts, showToast, closeAllToasts } from './toasts'
import { initTray, updateTray, flashTaskbar, destroyTray } from './tray'
import { parseNotice, parseRing } from './notice'
import { showCall, hideCall, isCallWindow, type CallColors } from './callWindow'
import { closeAction } from './trayModel'
import { aboutFacts } from './about'
import { showSplash } from './splash'
import { createAppWindow, type AppWindow } from './appWindow'
import { readShellPerf, flagsFor, readTrimMinutes, type ShellPerf } from './perf'
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

// Chromium reads these at startup only, so they come from what was saved last
// time; changing them in Settings asks for a restart rather than lying.
const shellPerf = readShellPerf(readStore().perf)
const perfFlags = flagsFor(shellPerf)
if (perfFlags.disableHardwareAcceleration) app.disableHardwareAcceleration()
if (perfFlags.jsFlags) app.commandLine.appendSwitch('js-flags', perfFlags.jsFlags)

// One Skycord at a time. A second launch (a shortcut, or the Jump List's
// Switch server) hands its arguments to the one running and exits.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
const SWITCH = '--switch-server'

let shellWin: AppWindow | null = null
/** The instance on screen; null while the picker is showing. */
let current: string | null = null

// ── the tray and quitting ──
/** Set once Skycord is really quitting, so closing the window closes it. */
let quitting = false
/** The page's theme colours, as the title bar last received them — the call window wears them too. */
let lastColors: CallColors = null
const keepInTray = () => readStore().keepInTray !== false
const showWindow = () => {
  const w = shellWin?.win
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}
const quitApp = () => { quitting = true; app.quit() }
app.on('before-quit', () => { quitting = true; closeAllToasts(); destroyTray(); hideCall() })
onBeforeInstall(() => { quitting = true; closeAllToasts() })

// Hidden and idle: let the page drop its decoded images. Never
// session.clearCache(), which would throw away the HTTP cache the next start
// depends on — that cache is what keeps the app from re-downloading itself.
let trimMinutes = readTrimMinutes(readStore().perf)
let trimTimer: ReturnType<typeof setTimeout> | null = null
const cancelTrim = () => { if (trimTimer) { clearTimeout(trimTimer); trimTimer = null } }
const armTrim = () => {
  cancelTrim()
  if (trimMinutes === null) return
  trimTimer = setTimeout(() => shellWin?.page.send('desktop:trimCache'), trimMinutes * 60_000)
}

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

// A server's page is checked with the server on every load. Sent without
// Cache-Control (nginx's default), Chromium guesses its freshness from
// Last-Modified, a tenth of its age, so after a deploy the app went on opening
// the old client from its cache for up to a day. max-age=0 asks every time: a
// 304 when nothing changed, the new page when it did. Hashed assets stay cached.
const FRESH: Electron.LoadURLOptions = { extraHeaders: 'Cache-Control: max-age=0\n' }

const openInstance = (origin: string) => {
  current = origin
  shellWin?.setTitle(titleFor(origin))
  shellWin?.setColors(DEFAULT_COLORS)
  void shellWin?.page.loadURL(`${origin}/`, FRESH)
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
    if (sameOrigin(url, current)) void page.loadURL(url, FRESH)
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
  if (c) { shellWin!.setColors(c); lastColors = c }
})
ipcMain.on('desktop:perf', (event, payload: unknown) => {
  if (!fromInstance(event)) return
  const p = payload as { switches?: unknown } | null
  const next = readShellPerf(p?.switches)
  trimMinutes = readTrimMinutes(p?.switches)
  // imageTrimMinutes isn't a restart switch, but it's saved alongside the three
  // that are, so the next launch arms the trim timer without the page having
  // to visit Settings again first.
  writeStore({ ...readStore(), perf: { ...next, imageTrimMinutes: trimMinutes } })
})
ipcMain.handle('desktop:perfApplied', (event): ShellPerf | null => fromInstance(event) ? shellPerf : null)
ipcMain.handle('desktop:perfMemory', (event) => {
  if (!fromInstance(event)) return null
  const metrics = app.getAppMetrics()
  const sum = (pick: (m: Electron.ProcessMetric) => number) => metrics.reduce((t, m) => t + pick(m), 0)
  return {
    privateMb: Math.round(sum(m => m.memory.privateBytes ?? 0) / 1024),
    workingSetMb: Math.round(sum(m => m.memory.workingSetSize) / 1024),
  }
})
ipcMain.on('desktop:perfRestart', (event) => { if (!fromInstance(event)) return; app.relaunch(); app.exit(0) })

ipcMain.handle('desktop:updateState', event => (fromInstance(event) ? currentUpdateState() : null))
ipcMain.on('desktop:updateCheck', event => { if (fromInstance(event)) checkForUpdatesNow() })
ipcMain.on('desktop:updateInstall', event => { if (fromInstance(event)) installUpdateNow() })

// ── notifications, the tray and the badge ──
ipcMain.on('desktop:notify', (event, value: unknown) => {
  const n = fromInstance(event) ? parseNotice(value) : null
  if (!n) return
  showToast(n)
  if (n.kind === 'message' || n.kind === 'mention') flashTaskbar()
})
ipcMain.on('desktop:unread', (event, value: unknown) => {
  if (!fromInstance(event)) return
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(999, Math.floor(value))) : 0
  updateTray({ unread: n })
})
ipcMain.on('desktop:callState', (event, value: unknown) => {
  if (!fromInstance(event) || !value || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  updateTray({ inCall: v.inCall === true, muted: v.muted === true, deafened: v.deafened === true })
})
ipcMain.handle('desktop:keepInTray', event => (fromInstance(event) ? keepInTray() : null))
ipcMain.on('desktop:ring', (event, value: unknown) => {
  if (!fromInstance(event)) return
  const info = value === null ? null : parseRing(value)
  if (info) showCall(PRELOAD, info, lastColors)
  else hideCall()
})
// Only the call window may answer, and the page — which owns the call — does the answering.
ipcMain.on('call:answer', (event, value: unknown) => {
  if (!isCallWindow(event.sender) || (value !== 'accept' && value !== 'decline')) return
  hideCall()
  // Answer first, then show: showing focuses the window, and a focused page
  // treats the call as seen in the open chat. In the other order the answer
  // arrived to find no call left to accept.
  shellWin?.page.send('desktop:callAction', value)
  if (value === 'accept') showWindow()
})
ipcMain.on('desktop:setKeepInTray', (event, value: unknown) => {
  if (fromInstance(event) && typeof value === 'boolean') writeStore({ ...readStore(), keepInTray: value })
})
ipcMain.handle('desktop:about', event => {
  if (!fromInstance(event)) return null
  let addon = { supported: () => false, loaded: false }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const a = require('../native') as { supported: () => boolean }
    addon = { supported: () => a.supported(), loaded: true }
  } catch { /* stays not-loaded, which is itself a fact worth reporting */ }
  return aboutFacts({
    appVersion: app.getVersion(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: process.platform,
    osVersion: release(),
    addon,
  })
})

app.on('second-instance', (_e, argv) => {
  if (!shellWin?.win) return
  // Brings a window hidden in the tray back too, not only a minimised one.
  showWindow()
  if (argv.includes(SWITCH)) manageServers()
})

// No page may embed another browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

app.whenReady().then(async () => {
  if (!primary) return
  // Windows shows an app's toasts under the identity it declares; this must
  // match the installer's appId (electron-builder.yml).
  if (process.platform === 'win32') app.setAppUserModelId('xyz.skycord.desktop')
  // Permissions go to the chosen origin only, and only the ones a chat app needs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permissionAllowed(permission, details.requestingUrl, current)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, current))

  // The launch screen no longer waits for an update. A check runs in
  // startUpdates below, downloads in the background, and installs when
  // someone presses Restart — see updates.ts for why the gate was removed.
  const splash = showSplash(PRELOAD)

  shellWin = createAppWindow(PRELOAD, dir => { if (current) shellWin?.page.send('desktop:nav', dir) }, shellPerf.skycordTitleBar)
  shellWin.showWhenReady(() => splash.close())
  guard(shellWin.page)
  handleDisplayMedia(() => shellWin?.win ?? null, () => shellWin?.page ?? null, () => current)
  shellWin.win.on('hide', armTrim)
  shellWin.win.on('blur', armTrim)
  shellWin.win.on('show', cancelTrim)
  shellWin.win.on('focus', cancelTrim)

  // The page cannot tell whether the window is in front — inside the app its
  // document reports focus and visibility as true even when hidden in the
  // tray — so the shell tells it, on every change and once the page loads.
  const tellFocus = () => {
    const w = shellWin?.win
    if (!w || w.isDestroyed()) return
    shellWin?.page.send('desktop:windowFocus', w.isVisible() && !w.isMinimized() && w.isFocused())
  }
  for (const e of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) shellWin.win.on(e as 'focus', tellFocus)
  shellWin.page.on('did-finish-load', tellFocus)

  initToasts({ page: () => shellWin?.page ?? null, showWindow })
  initTray({
    window: () => shellWin?.win ?? null,
    showWindow,
    command: c => shellWin?.page.send('desktop:trayCommand', c),
    checkUpdates: () => checkForUpdatesNow(),
    quit: quitApp,
  })
  shellWin.win.on('close', e => {
    if (closeAction({ quitting, keepInTray: keepInTray() }) === 'close') return
    e.preventDefault()
    shellWin?.win.hide()
    if (readStore().trayHintShown !== true) {
      writeStore({ ...readStore(), trayHintShown: true })
      showToast({
        id: 'tray-hint', kind: 'friend', conversation: null, title: 'Skycord is still running',
        body: 'It keeps notifications and calls coming. Quit from the tray icon.', icon: null, group: null, canReply: false,
      })
    }
  })

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
  startUpdates(() => shellWin?.page ?? null)
})

// With close-to-tray the window hides rather than closes, so this fires only
// when Skycord is genuinely on its way out.
app.on('window-all-closed', () => { if (quitting || !keepInTray()) app.quit() })

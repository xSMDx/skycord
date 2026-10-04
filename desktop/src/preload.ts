/**
 * The only surface a page gets. Which surface depends on which page it is:
 *
 *   - the local server picker gets `skycordPicker` (look up, choose, saved servers);
 *   - the local share picker gets `skycordShare` (list sources, choose one);
 *   - the local title bar gets `skycordTitleBar` (what to show, back/forward);
 *   - the incoming-call window gets `skycordCall` (who is calling, answer);
 *   - the launch screen gets nothing (it is static);
 *   - the chosen instance gets `skycordDesktop`.
 *
 * Deciding here, by the page's own URL, means an instance's web client can never
 * reach the local pages' calls. The main process checks every call's sender too.
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron'

const local = location.protocol === 'file:'
const page = location.pathname.split('/').pop()

if (local && page === 'share.html') {
  contextBridge.exposeInMainWorld('skycordShare', {
    init: () => ipcRenderer.invoke('share:init'),
    sources: () => ipcRenderer.invoke('share:sources'),
    choose: (choice: unknown) => ipcRenderer.invoke('share:choose', choice),
    cancel: () => ipcRenderer.invoke('share:cancel'),
  })
} else if (local && page === 'splash.html') {
  // Nothing. The launch screen is static HTML and asks the main process for
  // nothing — but it still needs its own branch, or it would fall through to
  // the picker's surface below.
} else if (local && page === 'call.html') {
  contextBridge.exposeInMainWorld('skycordCall', {
    onInfo: (cb: (info: unknown) => void) => { ipcRenderer.on('call:info', (_e, i) => cb(i)) },
    answer: (a: 'accept' | 'decline') => ipcRenderer.send('call:answer', a),
  })
} else if (local && page === 'titlebar.html') {
  contextBridge.exposeInMainWorld('skycordTitleBar', {
    onState: (cb: (state: unknown) => void) => { ipcRenderer.on('titlebar:state', (_e, s) => cb(s)) },
    onColors: (cb: (colors: unknown) => void) => { ipcRenderer.on('titlebar:colors', (_e, c) => cb(c)) },
    nav: (dir: 'back' | 'forward') => ipcRenderer.send('titlebar:nav', dir),
  })
} else if (local) {
  contextBridge.exposeInMainWorld('skycordPicker', {
    lookup: (address: string) => ipcRenderer.invoke('picker:lookup', address),
    choose: (origin: string, meta?: { name?: string; icon?: string | null }) => ipcRenderer.invoke('picker:choose', origin, meta),
    list: () => ipcRenderer.invoke('servers:list'),
    save: (entry: unknown) => ipcRenderer.invoke('servers:save', entry),
    rename: (origin: string, name: string) => ipcRenderer.invoke('servers:rename', origin, name),
    readdress: (origin: string, next: unknown) => ipcRenderer.invoke('servers:readdress', origin, next),
    remove: (origin: string) => ipcRenderer.invoke('servers:remove', origin),
    close: () => ipcRenderer.invoke('servers:close'),
  })
} else {
  // Only the chosen instance ever loads here: the main process pins
  // navigation to it.
  contextBridge.exposeInMainWorld('skycordDesktop', {
    platform: process.platform,
    changeInstance: () => ipcRenderer.invoke('desktop:changeInstance'),
    // Opens the share picker before the page captures. Resolves with the
    // stream settings chosen, or null if the member closed it.
    pickShare: (hints?: { dark?: boolean }) => ipcRenderer.invoke('desktop:pickShare', { dark: hints?.dark !== false }),
    // Ends the native capture of a shared app's sound. Send, not invoke:
    // stopping is never refused and nothing waits on the answer.
    stopShareAudio: () => ipcRenderer.send('desktop:shareAudioStop'),
    // Updating. The page reads the state, subscribes to it, and asks for the
    // two things a person can decide: check now, and restart into it.
    updates: {
      state: () => ipcRenderer.invoke('desktop:updateState'),
      onChange: (cb: (s: unknown) => void) => {
        const h = (_e: unknown, s: unknown) => cb(s)
        ipcRenderer.on('desktop:updateState', h)
        return () => { ipcRenderer.off('desktop:updateState', h) }
      },
      check: () => ipcRenderer.send('desktop:updateCheck'),
      install: () => ipcRenderer.send('desktop:updateInstall'),
    },
    // Versions and capability facts, for the Debug page and a bug report.
    about: () => ipcRenderer.invoke('desktop:about'),
    // Opens the app's Servers window.
    openServers: (hints?: { dark?: boolean }) => ipcRenderer.invoke('desktop:openServers', { dark: hints?.dark !== false }),
    // Feeds the app's title bar: what the page is, and its theme's colours.
    titleBar: {
      update: (state: unknown) => ipcRenderer.send('desktop:title', state),
      colors: (colors: unknown) => ipcRenderer.send('desktop:titleColors', colors),
    },
    // The title bar's back and forward. Returns a function that stops listening.
    onNavigate: (cb: (dir: 'back' | 'forward') => void) => {
      const listener = (_e: unknown, dir: 'back' | 'forward') => cb(dir)
      ipcRenderer.on('desktop:nav', listener)
      return () => { ipcRenderer.removeListener('desktop:nav', listener) }
    },
    performance: {
      // The page decides; the shell stores it for the next start.
      level: (level: string, switches: unknown) => ipcRenderer.send('desktop:perf', { level, switches }),
      memory: () => ipcRenderer.invoke('desktop:perfMemory'),
      applied: () => ipcRenderer.invoke('desktop:perfApplied'),
      restart: () => ipcRenderer.send('desktop:perfRestart'),
    },
    // Notifications the app shows itself. Interactions come back here.
    notifications: {
      show: (notice: unknown) => ipcRenderer.send('desktop:notify', notice),
      ring: (call: unknown) => ipcRenderer.send('desktop:ring', call),
      unread: (count: number) => ipcRenderer.send('desktop:unread', count),
      callState: (s: unknown) => ipcRenderer.send('desktop:callState', s),
      onActivated: (cb: (a: unknown) => void) => {
        const h = (_e: unknown, a: unknown) => cb(a)
        ipcRenderer.on('desktop:noticeActivated', h)
        return () => { ipcRenderer.off('desktop:noticeActivated', h) }
      },
      onCallAction: (cb: (a: unknown) => void) => {
        const h = (_e: unknown, a: unknown) => cb(a)
        ipcRenderer.on('desktop:callAction', h)
        return () => { ipcRenderer.off('desktop:callAction', h) }
      },
      onTrayCommand: (cb: (c: unknown) => void) => {
        const h = (_e: unknown, c: unknown) => cb(c)
        ipcRenderer.on('desktop:trayCommand', h)
        return () => { ipcRenderer.off('desktop:trayCommand', h) }
      },
      onWindowFocus: (cb: (inFront: unknown) => void) => {
        const h = (_e: unknown, v: unknown) => cb(v)
        ipcRenderer.on('desktop:windowFocus', h)
        return () => { ipcRenderer.off('desktop:windowFocus', h) }
      },
      keepInTray: () => ipcRenderer.invoke('desktop:keepInTray'),
      setKeepInTray: (on: boolean) => ipcRenderer.send('desktop:setKeepInTray', on),
    },
  })

  // The shell asks when the window has been hidden a while. Only the renderer
  // can drop its own decoded images, and only webFrame reaches them.
  ipcRenderer.on('desktop:trimCache', () => webFrame.clearCache())

  /**
   * Hand the shared application's audio port through to the page.
   *
   * `webContents.postMessage` delivers to ipcRenderer, not to the page's own
   * `message` event, so without this the port arrives in the preload and stops
   * there. Re-posting it with window.postMessage carries the MessagePort
   * across the isolated-world boundary, which is the only way the page can
   * receive one.
   */
  ipcRenderer.on('share-audio-port', event => {
    window.postMessage('share-audio-port', '*', event.ports)
  })
}

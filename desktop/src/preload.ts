/**
 * The only surface a page gets. Which surface depends on which page it is:
 *
 *   - the local server picker gets `skycordPicker` (look up, choose, saved servers);
 *   - the local share picker gets `skycordShare` (list sources, choose one);
 *   - the local title bar gets `skycordTitleBar` (what to show, back/forward);
 *   - the chosen instance gets `skycordDesktop`.
 *
 * Deciding here, by the page's own URL, means an instance's web client can never
 * reach the local pages' calls. The main process checks every call's sender too.
 */
import { contextBridge, ipcRenderer } from 'electron'

const local = location.protocol === 'file:'
const page = location.pathname.split('/').pop()

if (local && page === 'share.html') {
  contextBridge.exposeInMainWorld('skycordShare', {
    init: () => ipcRenderer.invoke('share:init'),
    sources: () => ipcRenderer.invoke('share:sources'),
    choose: (choice: unknown) => ipcRenderer.invoke('share:choose', choice),
    cancel: () => ipcRenderer.invoke('share:cancel'),
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
  })
}

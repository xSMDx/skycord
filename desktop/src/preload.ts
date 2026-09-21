/**
 * The only surface a page gets. Which surface depends on which page it is:
 *
 *   - the local server picker gets `skycordPicker` (look an address up, choose one);
 *   - the local share picker gets `skycordShare` (list sources, choose one);
 *   - the chosen instance gets `skycordDesktop`.
 *
 * Deciding here, by the page's own URL, means an instance's web client can never
 * reach the local pages' calls. The main process checks every call's sender too.
 */
import { contextBridge, ipcRenderer } from 'electron'

if (location.protocol === 'file:' && location.pathname.endsWith('/share.html')) {
  contextBridge.exposeInMainWorld('skycordShare', {
    init: () => ipcRenderer.invoke('share:init'),
    sources: () => ipcRenderer.invoke('share:sources'),
    choose: (choice: unknown) => ipcRenderer.invoke('share:choose', choice),
    cancel: () => ipcRenderer.invoke('share:cancel'),
  })
} else if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('skycordPicker', {
    lookup: (address: string) => ipcRenderer.invoke('picker:lookup', address),
    choose: (origin: string) => ipcRenderer.invoke('picker:choose', origin),
  })
} else {
  // Only the chosen instance ever loads here: the main process pins
  // navigation to it. Tray, notifications and push-to-talk extend this in
  // 0.20.x.
  contextBridge.exposeInMainWorld('skycordDesktop', {
    platform: process.platform,
    changeInstance: () => ipcRenderer.invoke('desktop:changeInstance'),
    // Opens the share picker before the page captures. Resolves with the
    // stream settings chosen, or null if the member closed it.
    pickShare: (hints?: { dark?: boolean }) => ipcRenderer.invoke('desktop:pickShare', { dark: hints?.dark !== false }),
  })
}

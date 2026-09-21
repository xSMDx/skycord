/**
 * The only surface the page gets. Which surface depends on which page it is:
 *
 *   - the local picker page gets `skycordPicker` (look an address up, choose one);
 *   - the chosen instance gets `skycordDesktop` (added in a later task).
 *
 * Deciding here, by the page's own URL, means an instance's web client can never
 * reach the picker's calls. The main process checks every call's sender as well.
 */
import { contextBridge, ipcRenderer } from 'electron'

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('skycordPicker', {
    lookup: (address: string) => ipcRenderer.invoke('picker:lookup', address),
    choose: (origin: string) => ipcRenderer.invoke('picker:choose', origin),
  })
}

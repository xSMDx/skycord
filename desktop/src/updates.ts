/**
 * Updates, from the public releases repo.
 *
 * The app never waits for one. A check runs at launch and every six hours,
 * the download runs in the background, and nothing restarts until a person
 * asks.
 *
 * The previous design gave the launch check eight seconds and then detached
 * its own listeners: the download carried on into the cache and the install
 * was dropped, every launch, with nothing on screen to say so. An installer
 * downloaded on 21 September was still sitting unapplied on 28 September with
 * two releases published since, and a feature was tested three times on a
 * build that did not contain it. The gate is deleted rather than lengthened —
 * two code paths racing for `update-downloaded` is what hid the fault.
 *
 * Differential downloads are NOT implemented here and must not be: NsisUpdater
 * already tries `differentialDownloadInstaller()` first and only falls back to
 * a full download, `disableDifferentialDownload` defaults to false, and every
 * release publishes a .exe.blockmap. It diffs against the previous installer
 * in the updater cache, which is why nothing here ever deletes that file.
 *
 * Only a packaged app updates: `electron .` has nothing to replace.
 */
import { app, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { initialUpdateState, reduceUpdate, type UpdateEvent, type UpdateState } from './updateState'

const SIX_HOURS = 6 * 60 * 60 * 1000

let state: UpdateState = initialUpdateState
let getPage: () => WebContents | null = () => null

export const currentUpdateState = (): UpdateState => state

const apply = (e: UpdateEvent): void => {
  const next = reduceUpdate(state, e)
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  try { getPage()?.send('desktop:updateState', state) } catch { /* the page may be gone */ }
}

export const checkForUpdatesNow = (): void => {
  if (!app.isPackaged) return
  apply({ type: 'check' })
  autoUpdater.checkForUpdates().catch(err =>
    apply({ type: 'error', message: String(err?.message ?? err), at: Date.now() }))
}

let beforeInstall: () => void = () => {}
/**
 * Called just before quitAndInstall, so the window really closes — closing
 * to the tray must never hold an update. The other install path,
 * autoInstallOnAppQuit, only runs on a real quit, which already marks it.
 */
export const onBeforeInstall = (fn: () => void): void => { beforeInstall = fn }

/** Only ever called because someone pressed a button. */
export const installUpdateNow = (): void => {
  if (state.phase !== 'ready') return
  beforeInstall()
  autoUpdater.quitAndInstall()
}

export const startUpdates = (page: () => WebContents | null): void => {
  getPage = page
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // A backstop only. The Restart button is the route people are meant to use.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', info => apply({ type: 'available', version: info.version }))
  autoUpdater.on('download-progress', p => apply({ type: 'progress', percent: p.percent, bytesPerSecond: p.bytesPerSecond }))
  autoUpdater.on('update-downloaded', info => apply({ type: 'downloaded', version: info.version }))
  autoUpdater.on('update-not-available', () => apply({ type: 'none', at: Date.now() }))
  autoUpdater.on('error', err => apply({ type: 'error', message: String(err?.message ?? err), at: Date.now() }))

  checkForUpdatesNow()
  setInterval(checkForUpdatesNow, SIX_HOURS)
}

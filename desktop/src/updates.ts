/**
 * Updates, from the public releases repo. Two phases:
 *
 *   - At launch, on the splash: an update found then is downloaded and
 *     installed before the app opens, as Discord does, so nobody starts on a
 *     version that is already replaced. Offline, slow or failing, the app
 *     starts anyway — a check never keeps anyone out — and a slow download can
 *     be left to finish in the background.
 *   - While running: a check every six hours, downloaded quietly, and a
 *     question before restarting — a call in progress is never cut off.
 *
 * Only a packaged app updates: `electron .` in development has nothing to
 * replace, and electron-updater would only log an error.
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

const SIX_HOURS = 6 * 60 * 60 * 1000
/** How long the launch check may take before the app starts without it. */
const CHECK_MS = 8_000
/** How long a launch download runs before "Continue without updating" is offered. */
const SKIP_AFTER_MS = 12_000

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number; canSkip: boolean }
  | { state: 'installing'; version: string }

/** The launch phase. Resolves when the app should start; an installed update restarts it instead. */
export const updateAtLaunch = (report: (s: UpdateStatus) => void, onSkip: (cb: () => void) => void): Promise<void> =>
  new Promise(resolve => {
    if (!app.isPackaged) { resolve(); return }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    let settled = false
    let version = ''
    let canSkip = false
    let percent = 0
    let skipTimer: ReturnType<typeof setTimeout> | undefined
    const checkTimer = setTimeout(() => start(), CHECK_MS)

    const onAvailable = (info: UpdateInfo) => {
      clearTimeout(checkTimer)
      version = info.version
      report({ state: 'downloading', version, percent, canSkip })
      skipTimer = setTimeout(() => { canSkip = true; report({ state: 'downloading', version, percent, canSkip }) }, SKIP_AFTER_MS)
    }
    const onProgress = (p: ProgressInfo) => { percent = p.percent; report({ state: 'downloading', version, percent, canSkip }) }
    const onDownloaded = (info: UpdateInfo) => {
      if (settled) return
      report({ state: 'installing', version: info.version })
      // Silent, and straight back into the new version.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 600)
    }
    const onError = (err: Error) => { console.warn('[updates] launch:', err?.message ?? err); start() }
    const onNone = () => start()

    // Starting leaves any download running: the in-app check picks it up.
    function start() {
      if (settled) return
      settled = true
      clearTimeout(checkTimer)
      clearTimeout(skipTimer)
      autoUpdater.off('update-available', onAvailable)
      autoUpdater.off('download-progress', onProgress)
      autoUpdater.off('update-downloaded', onDownloaded)
      autoUpdater.off('update-not-available', onNone)
      autoUpdater.off('error', onError)
      resolve()
    }

    autoUpdater.on('update-available', onAvailable)
    autoUpdater.on('download-progress', onProgress)
    autoUpdater.on('update-downloaded', onDownloaded)
    autoUpdater.on('update-not-available', onNone)
    autoUpdater.on('error', onError)
    onSkip(start)
    report({ state: 'checking' })
    autoUpdater.checkForUpdates().catch(onError)
  })

/** The running phase: a check every six hours, and a question before restarting. */
export const startUpdates = (getWindow: () => BrowserWindow | null): void => {
  if (!app.isPackaged) return

  // A failed check is not the member's problem: they keep the version they
  // have, and the next check tries again.
  autoUpdater.on('error', err => console.warn('[updates]', err?.message ?? err))

  autoUpdater.on('update-downloaded', async info => {
    const win = getWindow()
    const options = {
      type: 'info' as const,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Skycord ${info.version} is ready.`,
      detail: 'Restart to finish updating. If you choose Later, it installs the next time you quit.',
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 0) autoUpdater.quitAndInstall()
  })

  // The launch just checked; the next check is six hours on.
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => { /* reported by 'error' */ }) }, SIX_HOURS)
}

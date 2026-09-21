/**
 * Updates. The installed app checks the public releases repo on launch and
 * every six hours, downloads in the background, and asks before restarting —
 * a call in progress is never cut off by an update.
 *
 * Only a packaged app updates: `electron .` in development has nothing to
 * replace, and electron-updater would only log an error.
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

const SIX_HOURS = 6 * 60 * 60 * 1000

export const startUpdates = (getWindow: () => BrowserWindow | null): void => {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

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

  const check = () => { autoUpdater.checkForUpdates().catch(() => { /* reported by 'error' */ }) }
  check()
  setInterval(check, SIX_HOURS)
}

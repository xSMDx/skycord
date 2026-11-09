/**
 * The identity Windows groups Skycord's windows under: the taskbar button,
 * pins, Alt+Tab and toasts all follow it, and whichever Start-menu shortcut
 * carries it lends the button its icon and the pin its target.
 *
 * The installed app's is the installer's appId (electron-builder.yml), so the
 * shortcut the installer makes is the one that claims its windows. A dev run
 * (`electron .`) gets an id of its own. It used to share the installed one,
 * and on 2026-10-04 a shortcut made to test a dev build's toasts carried it:
 * from then on the installed Skycord showed Electron's logo on the taskbar
 * and a pin launched the dev electron.exe, until that shortcut was removed.
 */
export const APP_USER_MODEL_ID = 'xyz.skycord.desktop'

export const appUserModelId = (packaged: boolean): string =>
  packaged ? APP_USER_MODEL_ID : `${APP_USER_MODEL_ID}.dev`

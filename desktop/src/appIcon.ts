/**
 * The icon every Skycord window hands the system for its taskbar button,
 * Alt+Tab and title.
 *
 * Without one, Windows draws the icon baked into Skycord.exe, and after an
 * update it keeps drawing the *old* exe icon from its icon cache, sometimes for
 * days. A window icon set at runtime is read fresh every launch, so a new icon
 * shows on the running app the moment the update lands. (The installer also
 * asks the shell to rebuild its cache for pinned shortcuts: build/installer.nsh.)
 *
 * Linux cannot read an .ico, so it gets the PNG. Its launcher icon comes from
 * the .desktop entry; this one covers a window the desktop could not match to
 * that entry, such as an AppImage nobody integrated.
 *
 * Both are copies of build/icon.ico and build/icon.png, in static/ because
 * build/ is not packaged.
 */
import { app } from 'electron'
import { join } from 'path'

export const APP_ICON = join(app.getAppPath(), 'static', process.platform === 'win32' ? 'icon.ico' : 'icon.png')

/**
 * What the shell remembers: which instance to open, and the last screen-share
 * settings (read back through readRemembered, never trusted as written).
 *
 * A small JSON file in the app's user data. A missing or unreadable file is
 * treated as "nothing chosen yet", which sends the member back to the picker
 * rather than crashing on launch.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

export interface Stored { instanceOrigin?: string; share?: unknown }

const file = () => join(app.getPath('userData'), 'skycord.json')

export const readStore = (): Stored => {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed as Stored : {}
  } catch {
    return {}
  }
}

export const writeStore = (next: Stored): void => {
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(next, null, 2))
}

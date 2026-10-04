/**
 * Notification settings, per device: they are about this screen (who can see
 * it), these speakers and this machine, not the account.
 */
import { reactive } from 'vue'

const KEY = 'skycord_notifications'

export interface NotificationPrefs {
  /** The boxes: toasts in the desktop app, the browser's notifications on the web. */
  enabled: boolean
  /** Show message text in them. */
  previews: boolean
  /** The browser has been asked for permission once, on its own. Never again after that. */
  asked: boolean
  /** Flash the taskbar button (desktop app). Independent of the boxes. */
  flash: boolean
  /** The unread badge on the taskbar and the tray dot (desktop app). */
  badge: boolean
  /** Sounds for messages, mentions and friend requests. */
  messageSound: boolean
  /** …including in the conversation you are reading. */
  readingSound: boolean
  /** The incoming call ring. */
  ringSound: boolean
  /** Every sound the app makes. Leaves the switches above as they were. */
  allSoundsOff: boolean
}
export type NotificationPrefKey = keyof NotificationPrefs

const DEFAULTS: NotificationPrefs = {
  enabled: true, previews: true, asked: false, flash: true, badge: true,
  messageSound: true, readingSound: false, ringSound: true, allSoundsOff: false,
}

const read = (): Partial<Record<NotificationPrefKey, unknown>> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {} } catch { return {} }
}
const saved = read()

export const notificationPrefs = reactive<NotificationPrefs>(Object.fromEntries(
  (Object.keys(DEFAULTS) as NotificationPrefKey[]).map(k => [k, typeof saved[k] === 'boolean' ? saved[k] : DEFAULTS[k]]),
) as unknown as NotificationPrefs)

export const setNotificationPref = (key: NotificationPrefKey, on: boolean): void => {
  notificationPrefs[key] = on
  try { localStorage.setItem(KEY, JSON.stringify({ ...notificationPrefs })) } catch { /* private mode */ }
}

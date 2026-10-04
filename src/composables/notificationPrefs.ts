/**
 * Notification settings, per device: they are about this screen (who can see
 * it) and this machine, not the account.
 */
import { reactive } from 'vue'

const KEY = 'skycord_notifications'

const read = (): { enabled?: boolean; previews?: boolean; asked?: boolean } => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {} } catch { return {} }
}
const saved = read()

export const notificationPrefs = reactive({
  enabled: saved.enabled !== false,
  previews: saved.previews !== false,
  /** The browser has been asked for permission once, on its own. Never again after that. */
  asked: saved.asked === true,
})

export const setNotificationPref = (key: 'enabled' | 'previews' | 'asked', on: boolean): void => {
  notificationPrefs[key] = on
  try { localStorage.setItem(KEY, JSON.stringify({ ...notificationPrefs })) } catch { /* private mode */ }
}

/**
 * The debug page, and the seven taps that reveal it.
 *
 * Device-local on purpose. Everything the page reports — app version, whether
 * the capture addon loaded, whether the worklet fetched — is a fact about the
 * machine it is running on, so following the account to another device would
 * show facts belonging somewhere else.
 *
 * Seven taps, each within three seconds of the last. The window is what keeps
 * it out of reach by accident: an icon gets double-clicked, not tapped seven
 * times in a row.
 */
import { ref } from 'vue'

export const TAPS_NEEDED = 7
export const TAP_WINDOW_MS = 3000
const KEY = 'sykord_debug'

const read = (): boolean => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** Reactive so the settings sidebar shows and hides the entry live. */
export const debugUnlocked = ref(read())

export const setDebugUnlocked = (on: boolean): void => {
  debugUnlocked.value = on
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch { /* private window */ }
}

export interface TapCounter { tap(): boolean }

/** `now` is injected so the window can be tested without waiting for it. */
export const createTapCounter = (now: () => number = () => Date.now()): TapCounter => {
  let count = 0
  let last = -Infinity
  return {
    tap() {
      const t = now()
      count = t - last > TAP_WINDOW_MS ? 1 : count + 1
      last = t
      if (count < TAPS_NEEDED) return false
      count = 0
      return true
    },
  }
}

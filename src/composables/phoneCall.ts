/**
 * The phone call screen's state, and the three things it needs from the device.
 *
 * `CallBar` hosts the screen but ChatApp has to know whether it is showing (the
 * return bar, Android Back, the keep-awake) so the flag is module state rather
 * than a prop. Everything else here is a composable the screen's parts share:
 * the controls that fade away over a video, the display that must not sleep
 * mid-call, and the speaker button's link to the Android app.
 */
import { reactive, ref, watch, getCurrentScope, onScopeDispose, type Ref } from 'vue'
import { appBridge, type AudioRouteState } from './desktopBridge'

// ── Open and minimised ─────────────────────────────────────────────────────
/**
 * Whether the screen is up. Minimising does not leave the call, so this is not
 * "in a call": it is only whether the full-screen layer is showing, as opposed
 * to the slim return bar.
 */
export const phoneCall = reactive({ open: false })

export const openPhoneCall = (): void => { phoneCall.open = true }
export const minimizePhoneCall = (): void => { phoneCall.open = false }

// ── Controls that fade away ────────────────────────────────────────────────
const AUTO_HIDE_MS = 4000

/**
 * Hide the controls a moment after the last touch, but only while `enabled()`
 * (a video is filling the screen and the sheet is down).
 *
 * `enabled` is read through a watcher, so it must read reactive state. Turning
 * it off shows the controls at once, and turning it on counts a full delay from
 * that moment — a video starting is not a reason to snatch the buttons away
 * the instant it does. `poke()` is the touch: it reveals and starts the count.
 */
export const useAutoHide = (opts: { enabled: () => boolean; delayMs?: number }): {
  hidden: Ref<boolean>
  poke(): void
  stop(): void
} => {
  const delay = opts.delayMs ?? AUTO_HIDE_MS
  const hidden = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const arm = () => {
    clear()
    if (!opts.enabled()) return
    timer = setTimeout(() => {
      timer = null
      // Re-read: a plain function given as `enabled` has no way to tell us it changed.
      if (opts.enabled()) hidden.value = true
    }, delay)
  }

  const poke = () => {
    hidden.value = false
    arm()
  }

  // Sync, so the controls are back in the same tick the sheet is pulled up.
  const stopWatch = watch(opts.enabled, on => {
    if (on) arm()
    else { clear(); hidden.value = false }
  }, { immediate: true, flush: 'sync' })

  const stop = () => {
    stopWatch()
    clear()
    // A stopped auto-hide must not leave the controls hidden with nothing to bring them back.
    hidden.value = false
  }
  if (getCurrentScope()) onScopeDispose(stop)

  return { hidden, poke, stop }
}

/**
 * Whether a finger (or the mouse) is down on the screen. Auto-hide counts from
 * the last touch, and a press is one touch that can outlast the delay — Hold
 * to talk is held for as long as you talk — so the controls must stay up until
 * it ends.
 *
 * `down` and `up` take the pointer's id; `up` answers whether that was the
 * last one, the moment the count should start. A primary pointer going down
 * means no other is down, so a press whose release was never heard (lifted
 * outside the screen) is dropped then, rather than holding the controls up
 * for good.
 */
export const usePointersHeld = (): {
  held: Ref<boolean>
  down(id: number, primary: boolean): void
  up(id: number): boolean
} => {
  const ids = new Set<number>()
  const held = ref(false)
  return {
    held,
    down(id, primary) {
      if (primary) ids.clear()
      ids.add(id)
      held.value = true
    },
    up(id) {
      if (!ids.delete(id)) return false
      held.value = ids.size > 0
      return !held.value
    },
  }
}

// ── The display stays on ───────────────────────────────────────────────────
/**
 * Keep the display awake while `active()`. If it sleeps, Android puts the app
 * in the background and silences the mic, so a call on a phone left on the
 * table would go quiet.
 *
 * The Android app sets a window flag through its bridge. Anywhere else the
 * page asks for a screen wake lock, if the browser has one; the browser drops
 * that lock whenever the page is hidden, so coming back to visible takes it
 * again. Where there is neither, this does nothing.
 */
export const useCallKeepAwake = (active: () => boolean): void => {
  let releaseNative: (() => void) | null = null
  let browser = false
  let lock: WakeLockSentinel | null = null
  let requesting = false

  const requestLock = () => {
    const wakeLock = globalThis.navigator?.wakeLock
    // `released` is false while the browser still honours it: nothing to redo.
    if (!wakeLock || requesting || (lock && lock.released === false)) return
    requesting = true
    wakeLock.request('screen').then(
      s => {
        requesting = false
        if (browser) lock = s
        // The call ended while the browser was deciding.
        else void s.release()
      },
      // Refused (battery saver, page hidden): the call goes on, and a later visit may be let in.
      () => { requesting = false },
    )
  }
  const onVisibility = () => {
    if (browser && globalThis.document?.visibilityState === 'visible') requestLock()
  }

  const hold = () => {
    const bridge = appBridge()
    if (bridge?.keepScreenOn) {
      bridge.keepScreenOn(true)
      releaseNative = () => bridge.keepScreenOn?.(false)
      return
    }
    if (!globalThis.navigator?.wakeLock) return
    browser = true
    globalThis.document?.addEventListener('visibilitychange', onVisibility)
    requestLock()
  }
  const drop = () => {
    releaseNative?.()
    releaseNative = null
    if (!browser) return
    browser = false
    globalThis.document?.removeEventListener('visibilitychange', onVisibility)
    void lock?.release()
    lock = null
  }

  const stopWatch = watch(active, on => { if (on) hold(); else drop() }, { immediate: true, flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { stopWatch(); drop() })
}

// ── The speaker button ─────────────────────────────────────────────────────
/**
 * Where the call's sound comes out. `supported` is false until the app says it
 * can move the route — in a browser, and in every app build so far, it stays
 * false and the screen draws no speaker circle: a button that cannot work is
 * worse than none.
 */
export const speaker = reactive({ supported: false, on: false, headset: false })

const applyRoute = (s: AudioRouteState) => {
  speaker.on = s.speaker
  speaker.headset = s.headset
}

let teardownSpeaker: (() => void) | null = null

/**
 * Start following the app's audio route. Safe to call anywhere: with no bridge
 * it does nothing and the returned function is a no-op. It keeps at most one
 * subscription — calling it again replaces the earlier one, whose own
 * unsubscribe then does nothing.
 */
export const initSpeaker = (): (() => void) => {
  teardownSpeaker?.()
  teardownSpeaker = null

  const bridge = appBridge()
  const audio = bridge?.audio
  if (!bridge || !audio) return () => {}

  speaker.supported = true
  let live = true
  let heardRoute = false

  // The first answer only fills in a start state; a route event is newer than it.
  audio.state().then(s => { if (live && !heardRoute) applyRoute(s) }, () => {})
  const unsubscribe = bridge.onAudioRoute?.(s => { heardRoute = true; applyRoute(s) })

  const teardown = () => {
    if (!live) return
    live = false
    unsubscribe?.()
    Object.assign(speaker, { supported: false, on: false, headset: false })
    if (teardownSpeaker === teardown) teardownSpeaker = null
  }
  teardownSpeaker = teardown
  return teardown
}

/** Choose the loudspeaker (true) or the earpiece (false). A headset still overrides it. */
export const setSpeaker = (on: boolean): void => {
  const audio = appBridge()?.audio
  if (!audio) return
  audio.setSpeaker(on)
  // Shown at once; the app's route event corrects it if the choice did not take.
  speaker.on = on
}

/**
 * Tell the app a call has started or ended. A call starts on the speaker: a
 * crew call is usually held away from the ear, and a call's default route is
 * the earpiece. Ending it hands the route back.
 */
export const callAudioActive = (active: boolean): void => {
  const audio = appBridge()?.audio
  if (!audio) return
  audio.setCall(active)
  if (active) setSpeaker(true)
}

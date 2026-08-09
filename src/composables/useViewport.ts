/**
 * useViewport — one source of truth for "are we on a phone", how much of the
 * screen the OS has taken, and where the keyboard is.
 *
 * A singleton: every consumer shares the same listeners. Mounting a matchMedia
 * listener per component would mean dozens of them answering the same question.
 */
import { ref, computed, readonly } from 'vue'

/** Below this, the desktop three-column shell can't work: the rail (68px) plus
 *  the sidebar (234px) alone eat 302px before any conversation is shown. */
const MOBILE_MAX = 768

const mq = (q: string) => (typeof window === 'undefined' ? null : window.matchMedia(q))

const mobileQuery     = mq(`(max-width: ${MOBILE_MAX}px)`)
const standaloneQuery = mq('(display-mode: standalone)')
const coarseQuery     = mq('(pointer: coarse)')

const isMobile  = ref(!!mobileQuery?.matches)
const isCoarse  = ref(!!coarseQuery?.matches)

/**
 * Installed to the home screen, rather than running in a browser tab.
 *
 * This decides whether we may claim the left-edge swipe. In a Safari tab the
 * OS owns that edge for its own back-navigation, and fighting it loses; once
 * installed, the edge is ours. iOS exposes this through a non-standard
 * navigator.standalone, so both are checked.
 */
const isStandalone = ref(
  !!standaloneQuery?.matches || (typeof navigator !== 'undefined' && (navigator as any).standalone === true),
)

/** Height of the on-screen keyboard, in px. 0 when it's closed. */
const keyboardHeight = ref(0)

if (typeof window !== 'undefined') {
  mobileQuery?.addEventListener('change', e => { isMobile.value = e.matches })
  coarseQuery?.addEventListener('change', e => { isCoarse.value = e.matches })
  standaloneQuery?.addEventListener('change', e => { isStandalone.value = e.matches })

  /*
   * The keyboard doesn't resize the layout viewport on iOS — it slides over the
   * top of it. So a composer pinned to the bottom ends up underneath the
   * keyboard, and no amount of CSS notices. visualViewport is the only thing
   * that reports the actually-visible area, and the difference between it and
   * the layout viewport IS the keyboard.
   */
  const vv = window.visualViewport
  if (vv) {
    const sync = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop
      // Small deltas are the URL bar collapsing, not a keyboard.
      keyboardHeight.value = overlap > 80 ? Math.round(overlap) : 0
      document.documentElement.style.setProperty('--keyboard-h', `${keyboardHeight.value}px`)
    }
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    sync()
  }
}

export const useViewport = () => ({
  isMobile:     readonly(isMobile),
  isStandalone: readonly(isStandalone),
  isCoarse:     readonly(isCoarse),
  keyboardHeight: readonly(keyboardHeight),
  /** Only claim the back-swipe where the platform isn't already using it. */
  canOwnEdgeSwipe: computed(() => isMobile.value && isStandalone.value),
  keyboardOpen:    computed(() => keyboardHeight.value > 0),
})

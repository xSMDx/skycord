/**
 * Where a notification is shown. One shape, two places: the browser's own
 * notifications, or the desktop shell's richer ones. The page picks once at
 * start-up and nothing else needs to know which.
 */
import type { ConvRef, Notice } from './notifyRules'
import type { DesktopBridge } from './desktopBridge'
import { notificationPrefs, setNotificationPref } from './notificationPrefs'

export interface NoticeActivation { type: 'click' | 'reply' | 'read'; notice: { id: string; conversation: ConvRef | null }; reply?: string }
export interface RingInfo { name: string; icon: string | null; group: boolean }
export interface CallTrayState { inCall: boolean; muted: boolean; deafened: boolean }
/** A notice on its way out, saying whether the app should flash the taskbar with it. */
export type ShownNotice = Notice & { flash: boolean }

export interface Sink {
  kind: 'web' | 'desktop'
  show(n: ShownNotice): void
  /** Flash the taskbar without a box. Nothing in a browser, or in app builds before it. */
  flash(): void
  ring(call: RingInfo | null): void
  unread(count: number): void
  callState(s: CallTrayState): void
  onActivated(cb: (a: NoticeActivation) => void): () => void
  onCallAction(cb: (a: 'accept' | 'decline') => void): () => void
  onTrayCommand(cb: (c: 'mute' | 'deafen') => void): () => void
  /**
   * Whether the window is in front, from the one who knows. Inside the
   * desktop app the page reports focus and visibility as true even while the
   * window is hidden in the tray, so the shell says. A browser never calls
   * this — the page asks the document there.
   */
  onWindowFocus(cb: (inFront: boolean) => void): () => void
}

const never = () => () => {}

/**
 * The browser's notifications. They only open the conversation when clicked:
 * buttons on a web notification need a service worker, which this app does
 * not have. Permission is asked the first time one would show, once — after
 * that only the Allow button in Settings asks.
 */
export const webSink = (env: { Notification?: typeof Notification; focus?: () => void } = {
  Notification: typeof Notification === 'undefined' ? undefined : Notification,
  focus: () => window.focus(),
}): Sink => {
  const listeners = new Set<(a: NoticeActivation) => void>()
  const N = env.Notification

  const ready = async (): Promise<boolean> => {
    if (!N) return false
    if (N.permission === 'granted') return true
    if (N.permission === 'denied' || notificationPrefs.asked) return false
    setNotificationPref('asked', true)
    return (await N.requestPermission()) === 'granted'
  }

  return {
    kind: 'web',
    show(n) {
      void ready().then(ok => {
        if (!ok || !N) return
        const shown = new N(n.title, { body: n.body, icon: n.icon ?? undefined, tag: n.group?.id ?? n.id, silent: true })
        shown.onclick = () => {
          env.focus?.()
          shown.close()
          for (const cb of listeners) cb({ type: 'click', notice: { id: n.id, conversation: n.conversation } })
        }
      }).catch(() => {})
    },
    flash() {},
    ring() {},          // a browser has no call window: the call arrives as a notice, via show()
    unread() {},
    callState() {},
    onActivated(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    onCallAction: never,
    onTrayCommand: never,
    onWindowFocus: never,
  }
}

const desktopSink = (d: NonNullable<DesktopBridge['notifications']>): Sink => ({
  kind: 'desktop',
  show: n => d.show(n),
  flash: () => d.flash?.(),
  ring: c => d.ring(c),
  unread: n => d.unread(n),
  callState: s => d.callState(s),
  onActivated: cb => d.onActivated(cb),
  onCallAction: cb => d.onCallAction(cb),
  onTrayCommand: cb => d.onTrayCommand(cb),
  onWindowFocus: cb => d.onWindowFocus(cb),
})

/**
 * A notice, as the switches allow. With notifications on, the box, telling the
 * app whether to flash; with them off, only the flash — for a message or a
 * mention, which are what flashed before there was a switch.
 */
export const deliver = (sink: Sink, n: Notice, p: { enabled: boolean; flash: boolean }): void => {
  if (p.enabled) sink.show({ ...n, flash: p.flash })
  else if (p.flash && (n.kind === 'message' || n.kind === 'mention')) sink.flash()
}

/** The desktop app when its build has the bridge; the browser's notifications otherwise. */
export const pickSink = (bridge: DesktopBridge | null): Sink =>
  bridge?.notifications ? desktopSink(bridge.notifications) : webSink()

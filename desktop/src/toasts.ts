/**
 * Windows toasts for the page's notices.
 *
 * Interactions arrive on each Notification object's own events, which is how
 * a Reply reaches the conversation it belongs to. The shell keeps the objects
 * so that it can (a) replace the previous toast of the same conversation and
 * (b) close all of them on quit — Windows has no remove-all for an app
 * (Notification.removeAll is macOS only), and closing one also takes it out
 * of Action Center. handleActivation is registered for the one case those
 * events cannot cover, a cold start from a toast a crash left behind: that
 * can only bring the window up, because it carries no notification identity.
 */
import { Notification, nativeImage, type WebContents } from 'electron'
import { toastOptions, type ShellNotice } from './notice'

const live = new Map<string, { n: Notification; notice: ShellNotice }>()   // by notice id
const byGroup = new Map<string, string>()                                    // group id -> notice id
const LIVE_MAX = 50

export interface ToastHooks {
  page(): WebContents | null
  showWindow(): void
}
let hooks: ToastHooks | null = null

export const initToasts = (h: ToastHooks): void => {
  hooks = h
  Notification.handleActivation(() => h.showWindow())
}

const send = (type: 'click' | 'reply' | 'read', notice: ShellNotice, reply?: string) =>
  hooks?.page()?.send('desktop:noticeActivated', {
    type, notice: { id: notice.id, conversation: notice.conversation }, ...(reply !== undefined ? { reply } : {}),
  })

const forget = (id: string) => {
  const entry = live.get(id)
  if (!entry) return
  live.delete(id)
  if (entry.notice.group && byGroup.get(entry.notice.group.id) === id) byGroup.delete(entry.notice.group.id)
}

export const showToast = (notice: ShellNotice): void => {
  if (!Notification.isSupported()) return
  // A newer message in the same conversation replaces the older toast.
  const prevId = notice.group ? byGroup.get(notice.group.id) : undefined
  if (prevId) { live.get(prevId)?.n.close(); forget(prevId) }
  if (live.size >= LIVE_MAX) {
    const oldest = live.keys().next().value as string
    live.get(oldest)?.n.close(); forget(oldest)
  }

  const n = new Notification({
    ...toastOptions(notice),
    ...(notice.icon ? { icon: nativeImage.createFromDataURL(notice.icon) } : {}),
  })
  n.on('click', () => { hooks?.showWindow(); send('click', notice); forget(notice.id) })
  n.on('reply', (e, legacy) => {
    hooks?.showWindow()
    send('reply', notice, (e as { reply?: string } | undefined)?.reply ?? legacy ?? '')
    forget(notice.id)
  })
  n.on('action', () => { send('read', notice); n.close(); forget(notice.id) })
  n.on('close', () => forget(notice.id))
  live.set(notice.id, { n, notice })
  if (notice.group) byGroup.set(notice.group.id, notice.id)
  n.show()
}

/** On quit: close every toast, which also removes it from Action Center. */
export const closeAllToasts = (): void => {
  for (const { n } of live.values()) n.close()
  live.clear(); byGroup.clear()
}

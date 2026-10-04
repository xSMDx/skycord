/**
 * Notifications, wired: a decided Notice gets its icon and goes to the sink;
 * whatever the person does with it comes back through onNoticeActivated.
 *
 * Channel mentions are tracked here because they are the one unread the
 * client did not already count: a channel's unread flag covers every
 * message, and the badge counts only what would notify.
 */
import { reactive } from 'vue'
import type { Notice } from './notifyRules'
import { pickSink, type RingInfo, type CallTrayState, type NoticeActivation } from './notificationSinks'
import { desktopBridge } from './desktopBridge'
import { roundIcon } from './noticeIcon'

const sink = pickSink(desktopBridge())
export const desktopDelivers = sink.kind === 'desktop'

export const notify = async (n: Notice | null, iconSrc: string | null): Promise<void> => {
  if (!n) return
  const icon = iconSrc ? await roundIcon(iconSrc) : null
  sink.show({ ...n, icon })
}

let ringSeq = 0
/** Open (or update) the call window, or close it with null. The last call wins. */
export const ringFor = async (call: RingInfo | null): Promise<void> => {
  const mine = ++ringSeq
  if (!call) { sink.ring(null); return }
  const icon = call.icon ? await roundIcon(call.icon) : null
  if (mine === ringSeq) sink.ring({ ...call, icon })
}

export const setUnread = (count: number): void => sink.unread(count)
export const setCallTray = (s: CallTrayState): void => sink.callState(s)
export const onNoticeActivated = (cb: (a: NoticeActivation) => void): (() => void) => sink.onActivated(cb)
export const onCallAction = (cb: (a: 'accept' | 'decline') => void): (() => void) => sink.onCallAction(cb)
export const onTrayCommand = (cb: (c: 'mute' | 'deafen') => void): (() => void) => sink.onTrayCommand(cb)

export const mentionedChannels = reactive(new Set<string>())
export const noteMention = (channelId: string): void => { mentionedChannels.add(channelId) }
export const clearMention = (channelId: string): void => { mentionedChannels.delete(channelId) }

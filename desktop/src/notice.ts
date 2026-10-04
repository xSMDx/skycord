/**
 * What the page asks the shell to show, checked. The page is a server's web
 * client: whatever it sends is untrusted, the same as every other bridge call.
 *
 * An icon is accepted only as a small PNG data URL, which the page draws
 * itself (src/composables/noticeIcon.ts). The shell never fetches anything a
 * page names, so a notification cannot be used to make it dial out.
 */
export type ConversationKind = 'dm' | 'group' | 'channel'

export interface ShellNotice {
  id: string
  kind: 'message' | 'mention' | 'call' | 'friend'
  conversation: { kind: ConversationKind; id: string; serverId?: string } | null
  title: string
  body: string
  icon: string | null
  group: { id: string; title: string } | null
  canReply: boolean
  /** Flash the taskbar with it. Pages from before the switch send nothing, and flash. */
  flash: boolean
}
export interface RingInfo { name: string; icon: string | null; group: boolean }

const KINDS = ['message', 'mention', 'call', 'friend'] as const
const CONV = ['dm', 'group', 'channel'] as const
const ID = /^[\w:-]{1,128}$/
const ICON = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/
const ICON_MAX = 200_000

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.slice(0, max) : null
const icon = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= ICON_MAX && ICON.test(v) ? v : null

export const parseNotice = (v: unknown): ShellNotice | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !ID.test(o.id)) return null
  if (!KINDS.includes(o.kind as never)) return null
  const title = text(o.title, 120), body = text(o.body, 300)
  if (title === null || body === null) return null

  let conversation: ShellNotice['conversation'] = null
  if (o.conversation !== null && o.conversation !== undefined) {
    const c = o.conversation as Record<string, unknown>
    if (!CONV.includes(c.kind as never) || typeof c.id !== 'string' || !ID.test(c.id)) return null
    if (c.serverId !== undefined && (typeof c.serverId !== 'string' || !ID.test(c.serverId))) return null
    conversation = { kind: c.kind as ConversationKind, id: c.id, ...(c.serverId ? { serverId: c.serverId as string } : {}) }
  }

  let group: ShellNotice['group'] = null
  if (o.group !== null && o.group !== undefined) {
    const g = o.group as Record<string, unknown>
    const gt = text(g.title, 120)
    if (typeof g.id !== 'string' || !ID.test(g.id) || gt === null) return null
    group = { id: g.id, title: gt }
  }

  return {
    id: o.id, kind: o.kind as ShellNotice['kind'], conversation, title, body,
    icon: icon(o.icon), group, canReply: o.canReply === true, flash: o.flash !== false,
  }
}

export const parseRing = (v: unknown): RingInfo | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = text(o.name, 80)
  if (!name) return null
  return { name, icon: icon(o.icon), group: o.group === true }
}

/** Electron Notification options for a notice, minus the icon (the glue decodes it). */
export const toastOptions = (n: ShellNotice) => ({
  title: n.title,
  body: n.body,
  silent: true as const,
  hasReply: n.canReply,
  ...(n.canReply ? { replyPlaceholder: 'Reply…' } : {}),
  actions: n.conversation && n.kind !== 'call' ? [{ type: 'button' as const, text: 'Mark as read' }] : [],
  ...(n.group ? { groupId: n.group.id, groupTitle: n.group.title } : {}),
})

/**
 * Whether something that just happened becomes a notification, and what it
 * says. Pure: everything it needs comes in, so every rule is tested without a
 * socket, a window or a browser.
 *
 * The rules (spec: docs/superpowers/specs/2026-10-04-tray-and-notifications-design.md):
 * DMs, group messages, channel messages that mention you, calls, friend
 * requests — never your own, never a muted conversation, nothing while you are
 * Do Not Disturb, and nothing while the window is in front of you.
 */
import { stripMarkers } from '@/utils/richText'

export type ConvRef = { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }

export interface Notice {
  /** Stable per message or call, so a repeat replaces rather than stacks. */
  id: string
  kind: 'message' | 'mention' | 'call' | 'friend'
  conversation: ConvRef | null
  title: string
  body: string
  /** A 64 px round PNG data URL, filled in by useNotifications. */
  icon: string | null
  /** One stack per conversation in Windows' notification centre. */
  group: { id: string; title: string } | null
  canReply: boolean
}

export interface Me { id: string; displayName: string; username: string }

export interface RuleState {
  me: Me
  status: 'online' | 'idle' | 'dnd' | 'invisible'
  /** The window is in front and visible. */
  focused: boolean
  /** Settings › Notifications › Desktop notifications. */
  enabled: boolean
  /** Settings › Notifications › Show message text. */
  previews: boolean
  /** The existing per-conversation mute, keyed as mutes are: a DM by partner id. */
  isMuted: (key: string) => boolean
}

export type Incoming =
  | { type: 'dm'; messageId: string; partnerId: string; authorId: string; authorName: string; content: string }
  | { type: 'group'; messageId: string; groupId: string; groupName: string; authorId: string; authorName: string; content: string }
  | {
      type: 'channel'; messageId: string; channelId: string; channelName: string; serverId: string; serverName: string
      authorId: string; authorName: string; content: string; mentionsEveryone: boolean
    }
  | { type: 'friend'; userId: string; name: string; accepted: boolean }
  | { type: 'call'; room: string; kind: 'dm' | 'group'; convId: string; muteKey: string; name: string }

export const BODY_MAX = 200

/** The message as one line of plain text: markers turned into words, cut short. */
export const plainBody = (content: string, max = BODY_MAX): string => {
  const flat = stripMarkers(content ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a message mentions you. Mentions are written by name today
 * (`<@Name>`), so two people sharing a display name are both matched — the
 * known limit, until mentions carry user ids.
 */
export const mentionsMe = (content: string, me: Me): boolean => {
  const names = [me.displayName, me.username].map(n => (n ?? '').trim()).filter(Boolean).map(literal)
  if (!names.length) return false
  return new RegExp(`<@(?:${names.join('|')})>`, 'i').test(content ?? '')
}

export const decide = (e: Incoming, s: RuleState): Notice | null => {
  if (!s.enabled || s.focused || s.status === 'dnd') return null
  const text = (content: string) => (s.previews ? plainBody(content) || 'New message' : 'New message')

  switch (e.type) {
    case 'dm':
      if (e.authorId === s.me.id || s.isMuted(e.partnerId)) return null
      return {
        id: `msg:${e.messageId}`, kind: 'message', conversation: { kind: 'dm', id: e.partnerId },
        title: e.authorName, body: text(e.content), icon: null,
        group: { id: `dm:${e.partnerId}`, title: e.authorName }, canReply: true,
      }
    case 'group':
      if (e.authorId === s.me.id || s.isMuted(e.groupId)) return null
      return {
        id: `msg:${e.messageId}`, kind: 'message', conversation: { kind: 'group', id: e.groupId },
        title: `${e.authorName} · ${e.groupName}`, body: text(e.content), icon: null,
        group: { id: `group:${e.groupId}`, title: e.groupName }, canReply: true,
      }
    case 'channel': {
      if (e.authorId === s.me.id || s.isMuted(e.channelId)) return null
      if (!e.mentionsEveryone && !mentionsMe(e.content, s.me)) return null
      const where = `#${e.channelName} · ${e.serverName}`
      return {
        id: `msg:${e.messageId}`, kind: 'mention',
        conversation: { kind: 'channel', id: e.channelId, ...(e.serverId ? { serverId: e.serverId } : {}) },
        title: `${e.authorName} · ${where}`, body: text(e.content), icon: null,
        group: { id: `channel:${e.channelId}`, title: where }, canReply: true,
      }
    }
    case 'friend':
      return {
        id: `friend:${e.userId}:${e.accepted ? 'accepted' : 'request'}`, kind: 'friend', conversation: null,
        title: e.accepted ? 'Friend request accepted' : 'Friend request',
        body: e.accepted ? `${e.name} accepted your friend request.` : `${e.name} sent you a friend request.`,
        icon: null, group: null, canReply: false,
      }
    case 'call':
      if (s.isMuted(e.muteKey)) return null
      return {
        id: `call:${e.room}`, kind: 'call', conversation: { kind: e.kind, id: e.convId },
        title: e.name, body: 'Incoming call', icon: null, group: null, canReply: false,
      }
  }
}

/** What the tray dot and taskbar badge count: conversations holding something that would notify. */
export const unreadCount = (
  dms: { id: string; unread?: number }[],
  groups: { id: string; unread?: number }[],
  mentioned: Iterable<string>,
  isMuted: (key: string) => boolean,
): number => {
  let n = 0
  for (const d of dms) if ((d.unread ?? 0) > 0 && !isMuted(d.id)) n++
  for (const g of groups) if ((g.unread ?? 0) > 0 && !isMuted(g.id)) n++
  for (const _ of mentioned) n++
  return n
}

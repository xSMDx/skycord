/**
 * Whether something that just happened becomes a notification or a sound, and
 * what it says. Pure: everything it needs comes in, so every rule is tested
 * without a socket, a window or a browser.
 *
 * The rules (spec: docs/superpowers/specs/2026-10-04-tray-and-notifications-design.md):
 * DMs, group messages, channel messages at the channel's level (by default
 * those that mention you), calls, friend requests — never your own, never a
 * muted conversation, and nothing while you are Do Not Disturb.
 *
 * classify() says whether an event is for you at all. Notices and sounds are
 * both built on it, so a conversation can never ding without being able to
 * notify, or the other way round. They differ only in when: a notice never
 * shows while the window is in front; a sound plays then too, except for the
 * conversation you are reading.
 */
import { stripMarkers } from '@/utils/richText'
import { placeLevel, placeMuted, type LevelChoice } from './notifyLevels'

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
  /** Settings › Notifications › Show message text. */
  previews: boolean
  /**
   * The per-conversation mute, keyed as mutes are: a DM by partner id; a
   * group, server, category or channel by its own id.
   */
  isMuted: (key: string) => boolean
  /** A server's, category's or channel's notification level. */
  levelOf: (key: string) => LevelChoice
  /** The conversation whose text is on screen, if any. */
  open: ConvRef | null
  /** Settings › Notifications › Sounds. */
  sounds: { messages: boolean; reading: boolean }
}

export type Incoming =
  | { type: 'dm'; messageId: string; partnerId: string; authorId: string; authorName: string; content: string }
  | { type: 'group'; messageId: string; groupId: string; groupName: string; authorId: string; authorName: string; content: string }
  | {
      type: 'channel'; messageId: string; channelId: string; channelName: string
      categoryId: string | null; serverId: string; serverName: string
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

/**
 * Whether an event is for you, and as what. Not your own messages, not a muted
 * conversation, not a channel message below its channel's level. Nothing here
 * looks at the window or your status — decide and chime do.
 */
export const classify = (e: Incoming, s: RuleState): Notice['kind'] | null => {
  switch (e.type) {
    case 'dm':    return e.authorId === s.me.id || s.isMuted(e.partnerId) ? null : 'message'
    case 'group': return e.authorId === s.me.id || s.isMuted(e.groupId) ? null : 'message'
    case 'channel': {
      if (e.authorId === s.me.id) return null
      const place = { channelId: e.channelId, categoryId: e.categoryId, serverId: e.serverId }
      if (placeMuted(place, s)) return null
      const level = placeLevel(place, s)
      const forMe = e.mentionsEveryone || mentionsMe(e.content, s.me)
      if (level === 'nothing' || (level === 'mentions' && !forMe)) return null
      return forMe ? 'mention' : 'message'
    }
    case 'friend': return 'friend'
    case 'call':   return s.isMuted(e.muteKey) ? null : 'call'
  }
}

/** Whether the event happened in the conversation on screen. */
const inOpen = (e: Incoming, open: ConvRef | null): boolean => {
  if (!open) return false
  switch (e.type) {
    case 'dm':      return open.kind === 'dm' && open.id === e.partnerId
    case 'group':   return open.kind === 'group' && open.id === e.groupId
    case 'channel': return open.kind === 'channel' && open.id === e.channelId
    default:        return false
  }
}

/**
 * The sound for an event, or null for none. 'notification' is the brighter
 * chime for what is addressed to you — a mention, @everyone, a friend request.
 * Calls ring on their own (soundRingStart).
 */
export const chime = (e: Incoming, s: RuleState): 'message' | 'notification' | null => {
  if (s.status === 'dnd' || !s.sounds.messages || e.type === 'call') return null
  const kind = classify(e, s)
  if (!kind) return null
  if (s.focused && inOpen(e, s.open) && !s.sounds.reading) return null
  if (kind === 'mention' || kind === 'friend') return 'notification'
  if ((e.type === 'dm' || e.type === 'group') && /@everyone\b/.test(e.content ?? '')) return 'notification'
  return 'message'
}

/** The notice for an event, or null. Never while the window is in front, never while Do Not Disturb. */
export const decide = (e: Incoming, s: RuleState): Notice | null => {
  if (s.focused || s.status === 'dnd') return null
  const kind = classify(e, s)
  if (!kind) return null
  const text = (content: string) => (s.previews ? plainBody(content) || 'New message' : 'New message')

  switch (e.type) {
    case 'dm':
      return {
        id: `msg:${e.messageId}`, kind: 'message', conversation: { kind: 'dm', id: e.partnerId },
        title: e.authorName, body: text(e.content), icon: null,
        group: { id: `dm:${e.partnerId}`, title: e.authorName }, canReply: true,
      }
    case 'group':
      return {
        id: `msg:${e.messageId}`, kind: 'message', conversation: { kind: 'group', id: e.groupId },
        title: `${e.authorName} · ${e.groupName}`, body: text(e.content), icon: null,
        group: { id: `group:${e.groupId}`, title: e.groupName }, canReply: true,
      }
    case 'channel': {
      const where = `#${e.channelName} · ${e.serverName}`
      return {
        id: `msg:${e.messageId}`, kind,
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
      return {
        id: `call:${e.room}`, kind: 'call', conversation: { kind: e.kind, id: e.convId },
        title: e.name, body: 'Incoming call', icon: null, group: null, canReply: false,
      }
  }
}

/**
 * What the tray dot and taskbar badge count: conversations holding something
 * that would notify. A channel muted since it was alerted no longer counts.
 */
export const unreadCount = (
  dms: { id: string; unread?: number }[],
  groups: { id: string; unread?: number }[],
  alerted: Iterable<string>,
  isMuted: (key: string) => boolean,
  channelMuted: (channelId: string) => boolean = () => false,
): number => {
  let n = 0
  for (const d of dms) if ((d.unread ?? 0) > 0 && !isMuted(d.id)) n++
  for (const g of groups) if ((g.unread ?? 0) > 0 && !isMuted(g.id)) n++
  for (const c of alerted) if (!channelMuted(c)) n++
  return n
}

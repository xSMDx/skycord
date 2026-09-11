import { ref } from 'vue'
import type { Message } from '@/types'

const dmMessages     = ref<Record<string, Message[]>>({})
const serverMessages = ref<Record<string, Message[]>>({})
const groupMessages  = ref<Record<string, Message[]>>({})

/** Which conversation a window belongs to — the store keeps three lists. */
export type ConvKind = 'dm' | 'group' | 'channel'

/**
 * Where a conversation's loaded messages sit in its history.
 *
 * Before this, every list was "the newest 50" and nothing else could be
 * loaded, so nothing needed saying. Now a list can be any stretch of history:
 * one reached by scrolling up, or one loaded around a message someone jumped
 * to, which is not the present and must not have live messages appended to it.
 */
export interface HistoryWindowMeta {
  /** There is history above the first loaded message. */
  hasOlder: boolean
  /** The window reaches the newest message, so live arrivals append to it. */
  live: boolean
  /** Messages that arrived while the window was not live — counted, not shown. */
  awayCount: number
}

const windowMeta = ref<Record<string, HistoryWindowMeta>>({})
const metaKey = (kind: ConvKind, id: string) => `${kind}:${id}`
const FRESH: HistoryWindowMeta = Object.freeze({ hasOlder: false, live: true, awayCount: 0 })

const makeId  = () => Date.now() + Math.floor(Math.random() * 1000)
const fmtTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const useMessages = () => {
  // Always overwrite when seeding from DB
  const initDM = (id: string, seed: Message[] = []) => {
    dmMessages.value[id] = seed
    delete windowMeta.value[metaKey('dm', id)]
  }
  /**
   * Overwrites, like initDM and initGroup. The old guard (`if (!…)`) dated from
   * the mock era, where the seed was a constant and re-seeding was pointless.
   * Against a real database it is a bug: reopening a channel kept whatever was
   * in memory and never picked up messages sent while you were elsewhere.
   */
  const initChannel = (id: string, seed: Message[] = []) => {
    serverMessages.value[id] = seed
    delete windowMeta.value[metaKey('channel', id)]
  }
  const initGroup = (id: string, seed: Message[] = []) => {
    groupMessages.value[id] = seed
    delete windowMeta.value[metaKey('group', id)]
  }

  const getDMMessages      = (id: string) => dmMessages.value[id]     ?? []
  const getChannelMessages = (id: string) => serverMessages.value[id] ?? []
  const getGroupMessages   = (id: string) => groupMessages.value[id]  ?? []

  const listFor = (kind: ConvKind) =>
    kind === 'dm' ? dmMessages : kind === 'group' ? groupMessages : serverMessages

  /** The window's position; a conversation never paged reads as live and complete. */
  const windowOf = (kind: ConvKind, id: string): HistoryWindowMeta =>
    windowMeta.value[metaKey(kind, id)] ?? { ...FRESH }

  /** Replace a conversation's window: a first load (live) or a jump (usually not). */
  const setWindow = (
    kind: ConvKind, id: string, msgs: Message[], page: { hasOlder: boolean; hasNewer: boolean },
  ) => {
    listFor(kind).value[id] = msgs
    windowMeta.value[metaKey(kind, id)] = { hasOlder: page.hasOlder, live: !page.hasNewer, awayCount: 0 }
  }

  /**
   * Keyed on dbId, like pushChannelMessage: a page boundary can overlap a
   * message that arrived live after the window was loaded.
   */
  const withoutKnown = (list: Message[], incoming: Message[]) => {
    const known = new Set(list.map(m => m.dbId).filter(Boolean))
    return incoming.filter(m => !m.dbId || !known.has(m.dbId))
  }

  /** An older page, above the window. */
  const prependOlder = (kind: ConvKind, id: string, msgs: Message[], hasOlder: boolean) => {
    const list = listFor(kind).value[id] ?? []
    listFor(kind).value[id] = [...withoutKnown(list, msgs), ...list]
    windowMeta.value[metaKey(kind, id)] = { ...windowOf(kind, id), hasOlder }
  }

  /** A newer page, below the window. Reaching the end makes it live again. */
  const appendNewer = (kind: ConvKind, id: string, msgs: Message[], hasNewer: boolean) => {
    const list = listFor(kind).value[id] ?? []
    listFor(kind).value[id] = [...list, ...withoutKnown(list, msgs)]
    const was = windowOf(kind, id)
    windowMeta.value[metaKey(kind, id)] = {
      ...was, live: !hasNewer, awayCount: hasNewer ? was.awayCount : 0,
    }
  }

  /**
   * A live arrival for a conversation whose window is back in history: counted
   * for the "Jump to present" bar rather than appended below messages it does
   * not follow. Returns whether it was held.
   */
  const holdIfAway = (kind: ConvKind, id: string): boolean => {
    const m = windowMeta.value[metaKey(kind, id)]
    if (!m || m.live) return false
    m.awayCount += 1
    return true
  }

  // Push a single message (optimistic or from socket)
  const pushDMMessage = (dmId: string, msg: Message) => {
    if (!dmMessages.value[dmId]) dmMessages.value[dmId] = []
    // Avoid duplicates (optimistic + socket ack)
    if (!dmMessages.value[dmId].find(m => m.id === msg.id)) {
      dmMessages.value[dmId].push(msg)
    }
  }

  const pushGroupMessage = (groupId: string, msg: Message) => {
    if (!groupMessages.value[groupId]) groupMessages.value[groupId] = []
    if (!groupMessages.value[groupId].find(m => m.id === msg.id)) {
      groupMessages.value[groupId].push(msg)
    }
  }

  const pushChannelMessage = (channelId: string, msg: Message) => {
    if (!serverMessages.value[channelId]) serverMessages.value[channelId] = []
    // Keyed on dbId, not the numeric id: the numeric id is only the low 8 hex
    // digits of the ObjectId, so two distinct messages can collide on it.
    // Only dedupe when the incoming message has a dbId. An unstamped message
    // (dbId undefined) is an optimistic local message with no server identity
    // yet to compare — treating "undefined === undefined" as a match would
    // silently drop it, so it must always be appended.
    if (msg.dbId != null && serverMessages.value[channelId].some(m => m.dbId === msg.dbId)) {
      return
    }
    serverMessages.value[channelId].push(msg)
  }

type ReplyParents = { id: string; author: string; content: string }[]

const sendDM = (
  dmId: string,
  author: string,
  authorId: string,
  avatar: string,
  content: string,
  replyTo?: ReplyParents | null
): Message => {
  const msg: Message = {
    id: makeId(),
    author,
    authorId,
    content,
    time: fmtTime(),
    timestamp: Date.now(),
    avatar,
    avatarColor: '#5865f2',
    reactions: [],
    replyTo: replyTo && replyTo.length ? replyTo : undefined,
  }
  pushDMMessage(dmId, msg)
  return msg
}

  const sendGroup = (
    groupId: string,
    author: string,
    authorId: string,
    avatar: string,
    content: string,
    replyTo?: ReplyParents | null
  ): Message => {
    const msg: Message = {
      id: makeId(), author, authorId, content,
      time: fmtTime(), timestamp: Date.now(),
      avatar, avatarColor: '#5865f2', reactions: [],
      replyTo: replyTo && replyTo.length ? replyTo : undefined,
    }
    pushGroupMessage(groupId, msg)
    return msg
  }

  const toggleReaction = (list: Message[], msgId: number, emoji: string) => {
    const msg = list.find(m => m.id === msgId)
    if (!msg) return
    const r = msg.reactions.find(r => r.emoji === emoji)
    if (r) {
      r.reacted = !r.reacted
      r.count  += r.reacted ? 1 : -1
      if (r.count <= 0) msg.reactions = msg.reactions.filter(x => x !== r)
    } else {
      msg.reactions.push({ emoji, count: 1, reacted: true })
    }
  }

  const toggleDMReaction      = (dmId: string, msgId: number, emoji: string) =>
    toggleReaction(dmMessages.value[dmId] ?? [], msgId, emoji)
  const toggleChannelReaction = (chId: string, msgId: number, emoji: string) =>
    toggleReaction(serverMessages.value[chId] ?? [], msgId, emoji)

  const pinMessage = (list: Message[], msgId: number) => {
    const m = list.find(m => m.id === msgId); if (m) m.pinned = !m.pinned
  }
  const deleteMessage = (list: Message[], msgId: number) => {
    const i = list.findIndex(m => m.id === msgId); if (i !== -1) list.splice(i, 1)
  }
  const editMessage = (list: Message[], msgId: number, content: string) => {
    const m = list.find(m => m.id === msgId); if (m) { m.content = content; m.edited = true }
  }

  return {
    dmMessages, serverMessages, groupMessages,
    initDM, initChannel, initGroup,
    getDMMessages, getChannelMessages, getGroupMessages,
    pushDMMessage, pushGroupMessage, pushChannelMessage,
    sendDM, sendGroup,
    toggleDMReaction, toggleChannelReaction,
    pinMessage, deleteMessage, editMessage,
    windowMeta, windowOf, setWindow, prependOlder, appendNewer, holdIfAway,
  }
}
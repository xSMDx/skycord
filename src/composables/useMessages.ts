import { ref } from 'vue'
import type { Message } from '@/types'

const dmMessages     = ref<Record<string, Message[]>>({})
const serverMessages = ref<Record<string, Message[]>>({})
const groupMessages  = ref<Record<string, Message[]>>({})

const makeId  = () => Date.now() + Math.floor(Math.random() * 1000)
const fmtTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const useMessages = () => {
  // Always overwrite when seeding from DB
  const initDM = (id: string, seed: Message[] = []) => {
    dmMessages.value[id] = seed
  }
  /**
   * Overwrites, like initDM and initGroup. The old guard (`if (!…)`) dated from
   * the mock era, where the seed was a constant and re-seeding was pointless.
   * Against a real database it is a bug: reopening a channel kept whatever was
   * in memory and never picked up messages sent while you were elsewhere.
   */
  const initChannel = (id: string, seed: Message[] = []) => {
    serverMessages.value[id] = seed
  }
  const initGroup = (id: string, seed: Message[] = []) => {
    groupMessages.value[id] = seed
  }

  const getDMMessages      = (id: string) => dmMessages.value[id]     ?? []
  const getChannelMessages = (id: string) => serverMessages.value[id] ?? []
  const getGroupMessages   = (id: string) => groupMessages.value[id]  ?? []

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
  }
}
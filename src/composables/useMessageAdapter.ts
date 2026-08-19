/**
 * One wire-message → client-Message mapping, shared by every path that
 * receives one: DM history, group history, channel history, and the three
 * socket receive handlers.
 *
 * This existed as four separate copies inside ChatApp.vue. They had already
 * drifted — the history copies mapped `reactions`, the socket copies hardcoded
 * `[]` — so a reaction that arrived with a live message was silently dropped
 * until the next reload. One copy, one behaviour.
 */
import type { Message } from '@/types'
import { avatarFor } from './useAvatar'

/** Anything message-shaped off the wire: REST bodies and socket payloads differ. */
type WireMessage = Record<string, any>

/**
 * The client's `Message.id` is a number (it predates the database). The full
 * ObjectId lives in `dbId` and is what every server call uses — parsing the
 * hex id into a number truncates it to garbage, so the two are kept separate.
 * The numeric id only has to be unique within a rendered list, so the low 8
 * hex digits of the ObjectId are plenty.
 */
const numericId = (dbId: string): number =>
  parseInt(dbId.slice(-8), 16) || Date.now()

export const toClientMessage = (m: WireMessage, myId?: string): Message => {
  const dbId = m._id || m.id || ''
  return {
    id:          numericId(String(dbId)),
    dbId:        dbId || undefined,
    kind:        m.kind,
    systemType:  m.systemType,
    author:      m.authorName,
    authorId:    m.authorId,
    content:     m.content,
    time:        new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp:   new Date(m.createdAt).getTime(),
    avatar:      m.authorAvatar || avatarFor(m.authorName),
    avatarCrop:  m.authorAvatarCrop ?? null,
    avatarColor: '#5865f2',
    reactions:   (m.reactions || []).map((r: any) => ({
      emoji:   r.emoji,
      count:   r.userIds?.length || 0,
      reacted: !!myId && !!r.userIds?.includes(myId),
    })),
    pinned:  !!m.pinned,
    edited:  !!m.edited,
    replyTo: Array.isArray(m.replyTo) && m.replyTo.length ? m.replyTo : undefined,
  }
}

import { Request, Response, NextFunction } from 'express'
import { Message } from '../models/Message'
import { User } from '../models/User'
import mongoose from 'mongoose'

// Make a stable conversation ID from two user IDs (sorted so A↔B = B↔A)
export const dmConvId = (a: string, b: string) =>
  [a, b].sort().join('_')

/**
 * May this user open a DM with that one?
 *
 * There was no check at all: any authenticated user could DM any valid user id,
 * which makes cold-messaging every account on the instance a scripted loop.
 * `group:send` has always checked membership — DMs just never got the same
 * treatment.
 *
 * Deliberately permissive about *existing* relationships, because blocking
 * doesn't exist yet and this must not break real flows:
 *   · friends
 *   · members of a group you're both in (you can DM someone you met in a group)
 *   · anyone you already have history with — unfriending hides nothing and
 *     removes nothing, so an existing thread stays usable. Discord behaves the
 *     same way; stopping messages is what blocking is for, and that is still
 *     unimplemented (Friendship.status has 'blocked' but nothing reads it).
 *
 * What it does stop is the cold DM to a stranger's id, which is the actual
 * abuse vector.
 */
export const canDM = async (userId: string, partnerId: string): Promise<boolean> => {
  if (!mongoose.isValidObjectId(partnerId) || partnerId === userId) return false

  const { Friendship } = await import('../models/Friendship')
  const friends = await Friendship.exists({
    status: 'accepted',
    $or: [
      { requester: userId, receiver: partnerId },
      { requester: partnerId, receiver: userId },
    ],
  })
  if (friends) return true

  // Existing thread — one indexed lookup on conversationId.
  const prior = await Message.exists({ conversationId: dmConvId(userId, partnerId) })
  if (prior) return true

  const { Conversation } = await import('../models/Conversation')
  const shared = await Conversation.exists({ members: { $all: [userId, partnerId] } })
  return !!shared
}

// Shape of a resolved reply preview, matching what chatSocket.ts's message:get
// already produces over the socket path. Kept in one place so REST and socket
// never silently drift apart on what a "resolved" replyTo actually looks like.
interface ReplyPreview { id: string; author: string; content: string }

// Resolve a batch of raw message docs into client-ready shape: live author
// avatars (never the frozen per-message snapshot) and resolved replyTo
// previews. Shared by both DM and group message fetches so the two paths
// can never drift apart on what a "resolved" message looks like. Both lookups
// are batched (one query per distinct author / one for all reply targets)
// rather than per-message.
// Parent ids of a message — prefer the new replyToIds[]; fall back to the legacy
// single replyTo so old documents keep resolving.
const parentIdsOf = (m: any): string[] => {
  if (Array.isArray(m.replyToIds) && m.replyToIds.length) return m.replyToIds.map((id: any) => id.toString())
  if (m.replyTo) return [m.replyTo.toString()]
  return []
}

// `conversationId` is required, not optional: every call site resolves
// exactly one conversation's messages, so the scope is always known and
// unambiguous. Making it optional would leave the door open for a future
// call site to forget it and reopen this exact leak — a crafted replyToIds
// naming a message in someone else's DM would resolve here regardless of
// what conversation the reader is actually looking at, echoing that
// message's author name and a content snippet into a conversation the
// attacker chose.
export const resolveMessages = async (messages: any[], conversationId: string) => {
  const replyIds = [...new Set(messages.flatMap(parentIdsOf))]

  let replyPreviewById = new Map<string, ReplyPreview>()
  if (replyIds.length > 0) {
    const replyTargets = await Message.find({ _id: { $in: replyIds }, conversationId })
      .select('authorName content')
      .lean()
    replyPreviewById = new Map(
      replyTargets.map(rt => [
        rt._id.toString(),
        { id: rt._id.toString(), author: rt.authorName, content: rt.content.slice(0, 80) },
      ])
    )
  }

  const authorIds = [...new Set(messages.map(m => m.authorId.toString()))]
  const authors = await User.find({ _id: { $in: authorIds } })
    .select('avatar avatarCrop')
    .lean()
  // The crop has to travel with the avatar. Resolving one live and leaving the
  // other frozen would frame a new GIF with an old author's numbers.
  const avatarByAuthorId = new Map(
    authors.map(a => [a._id.toString(), { src: a.avatar ?? null, crop: (a as any).avatarCrop ?? null }])
  )

  return messages.map(m => ({
    ...m,
    authorAvatar:     avatarByAuthorId.get(m.authorId.toString())?.src  ?? null,
    authorAvatarCrop: avatarByAuthorId.get(m.authorId.toString())?.crop ?? null,
    // replyTo is now an array of resolved previews (drop ids that 404 / were deleted).
    replyTo: parentIdsOf(m)
      .map(id => replyPreviewById.get(id))
      .filter((p): p is ReplyPreview => !!p),
  }))
}

// ── Get DM messages (paginated) ──────────────────────────────────────────────
export const getDMMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { partnerId } = req.params
    const before  = req.query.before as string | undefined
    const limit   = Math.min(Number(req.query.limit) || 50, 100)

    const convId = dmConvId(userId, partnerId)
    // Include 'system' (call logs like "X started a call" / "Call ended") the
    // same way group history does — they were being written but never loaded,
    // so DM call logs vanished on refresh.
    const filter: any = { conversationId: convId, kind: { $in: ['dm', 'system'] } }
    if (before) filter.createdAt = { $lt: new Date(before) }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    const resolved = await resolveMessages(messages, convId)
    res.json({ messages: resolved.reverse() })
  } catch (err) { next(err) }
}

// ── Send DM message (REST fallback, Socket is primary) ───────────────────────
export const sendDMMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { partnerId } = req.params
    // authorName is accepted in the body by older clients but deliberately ignored.
    const { content, replyToIds } = req.body as { content: string; replyToIds?: string[] }

    if (!content?.trim()) { res.status(400).json({ message: 'Content required' }); return }

    if (!await canDM(userId, partnerId)) {
      res.status(403).json({ message: 'You can’t message this user' }); return
    }

    // Neither authorAvatar nor authorName is trusted from the request body —
    // both are looked up live from the User document, so (a) they're always
    // current rather than a stale snapshot, and (b) a client can't attribute
    // its own message to "Skycord System" or to another user's display name.
    // The avatar was hardened previously; the name beside it was missed.
    const sender = await User.findById(userId).select('avatar avatarCrop displayName username').lean()

    const conversationId = dmConvId(userId, partnerId)
    const rawReplyIds = Array.isArray(replyToIds) ? replyToIds : []
    // Persist only ids that resolve to a real message inside THIS DM. Storing
    // the client's raw array (as this path used to) meant a reply id naming a
    // message from someone else's DM sat in the document forever — harmless
    // only as long as every reader also scoped its lookup, which is exactly
    // the assumption that failed before resolveMessages was scoped above.
    // Defense in depth, not the primary fix.
    const validReplyIds = rawReplyIds.length
      ? new Set(
          (await Message.find({ _id: { $in: rawReplyIds }, conversationId })
            .select('_id').lean()).map(d => d._id.toString())
        )
      : new Set<string>()

    const msg = await Message.create({
      conversationId,
      kind:           'dm',
      authorId:       userId,
      authorName:     sender?.displayName || sender?.username || 'Unknown',
      authorAvatar:   sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:        content.trim(),
      replyToIds:     rawReplyIds.filter(id => validReplyIds.has(id)),
    })

    res.status(201).json({ message: msg })
  } catch (err) { next(err) }
}

// ── Delete a message ─────────────────────────────────────────────────────────
export const deleteMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { messageId } = req.params

    const msg = await Message.findById(messageId)
    if (!msg) { res.status(404).json({ message: 'Message not found' }); return }
    if (msg.authorId.toString() !== userId) {
      res.status(403).json({ message: 'Cannot delete another user\'s message' }); return
    }

    await msg.deleteOne()
    res.json({ message: 'Deleted' })
  } catch (err) { next(err) }
}

// ── Edit a message ────────────────────────────────────────────────────────────
export const editMessageContent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { messageId } = req.params
    const { content } = req.body

    if (!content?.trim()) { res.status(400).json({ message: 'Content required' }); return }

    const msg = await Message.findById(messageId)
    if (!msg) { res.status(404).json({ message: 'Message not found' }); return }
    if (msg.authorId.toString() !== userId) {
      res.status(403).json({ message: 'Cannot edit another user\'s message' }); return
    }

    msg.content = content.trim()
    msg.edited  = true
    await msg.save()
    res.json({ message: msg })
  } catch (err) { next(err) }
}
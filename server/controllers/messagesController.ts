import { Request, Response, NextFunction } from 'express'
import { Message, type IMessage } from '../models/Message'
import { User } from '../models/User'
import mongoose from 'mongoose'
import { loadHistoryWindow, type HistoryQuery } from '../utils/historyWindow'
import { wellFormed } from '../utils/wellFormed'
import { getIO } from '../sockets/chatSocket'
import { summarize, createWithAttachments, hasKeys, wireAttachments, removeAttachmentsOf, type AttachmentSummary } from '../services/attachments'
import type { EmbeddedAttachment } from '../models/Attachment'

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
/** `attachments` is there only when the parent has files, so a pill for a
 *  message sent with no text can still say what it was ("Sent 2 photos"). */
export interface ReplyPreview { id: string; author: string; content: string; attachments?: AttachmentSummary }

/**
 * The first 80 characters — except a message that is one link and nothing
 * else, which is kept whole. Cut, a GIF-picker message stops ending in .gif
 * and the client can no longer tell it is a GIF, so the pill would show half
 * a URL instead of "GIF". A link is one word; it cannot run on for paragraphs.
 */
const previewSnippet = (content: string): string => {
  const t = content.trim()
  return /^https?:\/\/\S+$/.test(t) && t.length <= 2048 ? t : content.slice(0, 80)
}

/** One shape for every reply preview, whichever path builds it. */
export const toReplyPreview = (t: { _id: { toString(): string }; authorName: string; content?: string | null; attachments?: EmbeddedAttachment[] }): ReplyPreview => {
  const summary = summarize(t.attachments)
  return {
    id: t._id.toString(), author: t.authorName, content: previewSnippet(t.content ?? ''),
    ...(summary ? { attachments: summary } : {}),
  }
}

// Resolve a list of parent message ids into reply previews, preserving order
// and dropping any that no longer exist. `conversationId` is required, not
// optional — every call site knows exactly which conversation it's building
// a message for, and an optional scope here is one forgotten call site away
// from reopening the same leak: a crafted replyToIds naming a message in
// someone else's DM would otherwise resolve and echo that message's author +
// a content snippet into whatever conversation the caller chose.
export const buildReplyPreviews = async (ids: string[] | undefined, conversationId: string): Promise<ReplyPreview[]> => {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const targets = await Message.find({ _id: { $in: ids }, conversationId }).select('authorName content attachments').lean()
  const byId = new Map(targets.map(t => [t._id.toString(), t]))
  return ids
    .map(id => byId.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map(toReplyPreview)
}

/**
 * A DM message as `dm:receive` and the `dm:send` ack carry it.
 *
 * One builder for both ways of sending — the socket handler and the REST route
 * — so the two can't drift on what a live DM looks like. Takes the previews
 * already resolved because the caller has to scope them to the conversation
 * (see buildReplyPreviews) before anything is persisted or sent.
 */
export const dmReceivePayload = (msg: IMessage, replyTo: ReplyPreview[]) => ({
  _id:            msg._id.toString(),
  conversationId: msg.conversationId,
  authorId:       msg.authorId.toString(),
  authorName:     msg.authorName,
  authorAvatar:   msg.authorAvatar,
  content:        msg.content,
  attachments:    wireAttachments(msg.attachments),
  reactions:      [],
  pinned:         false,
  edited:         false,
  replyTo,
  createdAt:      msg.createdAt.toISOString(),
})

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
      .select('authorName content attachments')
      .lean()
    replyPreviewById = new Map(
      replyTargets.map(rt => [rt._id.toString(), toReplyPreview(rt)])
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
    // Stored without URLs (the key and name are enough to rebuild one), so
    // every reader gets the same URL shape from one place.
    attachments: wireAttachments(m.attachments),
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
    const convId = dmConvId(userId, partnerId)
    // Include 'system' (call logs like "X started a call" / "Call ended") the
    // same way group history does — they were being written but never loaded,
    // so DM call logs vanished on refresh.
    const win = await loadHistoryWindow(
      { conversationId: convId, kind: { $in: ['dm', 'system'] } }, req.query as HistoryQuery,
    )
    if (!win.ok) { res.status(win.status).json({ message: win.message }); return }
    const resolved = await resolveMessages(win.messages, convId)
    res.json({ messages: resolved, hasOlder: win.hasOlder, hasNewer: win.hasNewer })
  } catch (err) { next(err) }
}

// ── Send DM message (REST fallback, Socket is primary) ───────────────────────
export const sendDMMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { partnerId } = req.params
    // authorName is accepted in the body by older clients but deliberately ignored.
    const { content, replyToIds, attachments: keys } = req.body as { content?: string; replyToIds?: string[]; attachments?: unknown }

    if (!content?.trim() && !hasKeys(keys)) { res.status(400).json({ message: 'Content required' }); return }

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

    const made = await createWithAttachments(keys, userId, conversationId, (_id, attachments) => Message.create({
      _id,
      conversationId,
      kind:           'dm',
      authorId:       userId,
      authorName:     sender?.displayName || sender?.username || 'Unknown',
      authorAvatar:   sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:        wellFormed((content ?? '').trim()),
      attachments,
      replyToIds:     rawReplyIds.filter(id => validReplyIds.has(id)),
    }))
    if (!made.ok) { res.status(made.status).json({ message: made.message }); return }
    const msg = made.value

    // Reach connected clients live — the partner's, and the sender's own other
    // devices. The sender used REST (a phone answering a notification, say)
    // rather than a socket, so nothing else will announce this message; without
    // it the partner only saw it after a reload. Best-effort: the message is
    // already saved, so a hiccup building or sending the notice must not turn
    // a stored message into a 500 that invites a duplicate retry.
    try {
      const io = getIO()
      if (io) {
        const replyTo = await buildReplyPreviews(msg.replyToIds.map(id => id.toString()), conversationId)
        io.to(`user:${userId}`).to(`user:${partnerId}`).emit('dm:receive', dmReceivePayload(msg, replyTo))
        // The partner only: the sender knows what they wrote.
        if (/@everyone\b/.test(msg.content)) {
          io.to(`user:${partnerId}`).emit('mention:everyone', { conversationId, authorName: msg.authorName })
        }
      }
    } catch (err) { console.error('[REST] dm live emit', err) }

    res.status(201).json({ message: { ...msg.toJSON(), attachments: wireAttachments(msg.attachments) } })
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
    await removeAttachmentsOf(msg._id)
    res.json({ message: 'Deleted' })
  } catch (err) { next(err) }
}

// ── Edit a message ────────────────────────────────────────────────────────────
export const editMessageContent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { messageId } = req.params
    const text = wellFormed(String(req.body?.content ?? '').trim())

    const msg = await Message.findById(messageId)
    if (!msg) { res.status(404).json({ message: 'Message not found' }); return }
    if (msg.authorId.toString() !== userId) {
      res.status(403).json({ message: 'Cannot edit another user\'s message' }); return
    }
    // A caption can be emptied while the files stay; a text-only message
    // cannot be edited down to nothing.
    if (!text && !msg.attachments?.length) { res.status(400).json({ message: 'Content required' }); return }

    msg.content = text
    msg.edited  = true
    await msg.save()
    res.json({ message: msg })
  } catch (err) { next(err) }
}
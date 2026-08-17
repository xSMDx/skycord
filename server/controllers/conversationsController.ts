import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { Conversation, MAX_GROUP_MEMBERS } from '../models/Conversation'
import { GroupInvite, generateInviteCode, inviteExpiry } from '../models/GroupInvite'
import { Message, SystemType } from '../models/Message'
import { User } from '../models/User'
import { Friendship } from '../models/Friendship'
import { resolveMessages } from './messagesController'
import { effectiveStatus } from '../state/presence'
import { getIO } from '../sockets/chatSocket'

// Shape a group doc into what the client's conversation list expects. The
// client renders a fallback name from member display names when `name` is
// null, so we send the member summary alongside.
const shapeGroup = (group: any, memberDocs: any[]) => ({
  id:            group._id.toString(),
  type:          'group' as const,
  name:          group.name ?? null,
  avatar:        group.avatar ?? null,
  owner:         group.owner.toString(),
  memberCount:   group.members.length,
  members: memberDocs.map(m => ({
    id:          m._id.toString(),
    username:    m.username,
    displayName: m.displayName,
    avatar:      m.avatar ?? null,
    avatarCrop:  m.avatarCrop ?? null,
    status:      effectiveStatus(m.status, m._id.toString()),
  })),
  lastMessageAt: group.lastMessageAt,
  createdAt:     group.createdAt,
})

// Create + broadcast a system log message (join/leave/add/rename/icon) into a
// group. Stored as a real Message (kind 'system') so it persists and reloads
// alongside chat, and broadcast live to everyone in the room.
const postGroupSystem = async (
  groupId: string, actorId: string, actorName: string, systemType: SystemType, content: string,
) => {
  const msg = await Message.create({
    conversationId: groupId,
    kind:           'system',
    authorId:       actorId,
    authorName:     actorName,
    authorAvatar:   null,
    content,
    systemType,
  })
  const payload = {
    _id:            msg._id.toString(),
    conversationId: groupId,
    kind:           'system',
    systemType,
    authorId:       actorId,
    authorName:     actorName,
    authorAvatar:   null,
    content,
    reactions:      [],
    pinned:         false,
    edited:         false,
    replyTo:        null,
    createdAt:      msg.createdAt.toISOString(),
  }
  const io = getIO()
  if (io) io.to(`group:${groupId}`).emit('group:receive', payload)
}

const actorNameOf = async (userId: string): Promise<string> => {
  const u = await User.findById(userId).select('displayName username').lean()
  return u?.displayName || u?.username || 'Someone'
}

// ── Create a group ────────────────────────────────────────────────────────────
export const createGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { memberIds, name } = req.body as { memberIds: string[]; name?: string }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ message: 'Select at least one person to start a group' }); return
    }

    // Always include the creator; dedupe in case the client sent them too.
    const uniqueMembers = [...new Set([userId, ...memberIds])]

    if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
      res.status(400).json({ message: `Group DMs can have up to ${MAX_GROUP_MEMBERS} members` }); return
    }

    // Every invited member must actually be a friend of the creator — you
    // can't pull a stranger into a group out of nowhere. (Invite links are
    // the path for adding non-friends; see joinViaInvite.)
    const others = uniqueMembers.filter(id => id !== userId)
    const friendships = await Friendship.find({
      status: 'accepted',
      $or: [
        { requester: userId, receiver: { $in: others } },
        { receiver: userId, requester: { $in: others } },
      ],
    }).lean()
    const friendIds = new Set(
      friendships.flatMap(f => [f.requester.toString(), f.receiver.toString()])
    )
    const allAreFriends = others.every(id => friendIds.has(id))
    if (!allAreFriends) {
      res.status(403).json({ message: 'You can only add friends to a group' }); return
    }

    const group = await Conversation.create({
      type:    'group',
      name:    name?.trim() || null,
      owner:   userId,
      members: uniqueMembers,
      lastMessageAt: new Date(),
    })

    const memberDocs = await User.find({ _id: { $in: uniqueMembers } })
      .select('username displayName avatar avatarCrop status').lean()

    // Notify every other member in real time so the group shows up in their
    // conversation list immediately.
    const io = getIO()
    if (io) {
      const shaped = shapeGroup(group, memberDocs)
      others.forEach(id => io.to(`user:${id}`).emit('group:created', shaped))
    }

    res.status(201).json({ group: shapeGroup(group, memberDocs) })
  } catch (err) { next(err) }
}

// ── List my conversations (groups only — DMs come from the existing path) ─────
export const getMyConversations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const groups = await Conversation.find({ members: userId })
      .sort({ lastMessageAt: -1 })
      .lean()

    const allMemberIds = [...new Set(groups.flatMap(g => g.members.map(m => m.toString())))]
    const memberDocs = await User.find({ _id: { $in: allMemberIds } })
      .select('username displayName avatar avatarCrop status').lean()
    const memberById = new Map(memberDocs.map(m => [m._id.toString(), m]))

    const shaped = groups.map(g =>
      shapeGroup(g, g.members.map(m => memberById.get(m.toString())).filter(Boolean))
    )
    res.json({ groups: shaped })
  } catch (err) { next(err) }
}

// ── DM conversations you actually have ───────────────────────────────────────
// Sourced from message history, NOT from the friends list. The client used to
// rebuild its DM list purely from friends, so unfriending someone made the
// whole conversation vanish on the next load even though every message was
// still here. A conversation exists because you talked, not because you're
// currently friends; only hiding it should take it off the list.
export const getMyDMs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub

    // conversationId for a DM is the two user ids sorted and joined with '_',
    // so the caller is either the prefix or the suffix. Anchored so the prefix
    // form can use the conversationId index. `userId` comes from a verified
    // JWT and is checked here anyway — it interpolates into a regex.
    if (!/^[a-f0-9]{24}$/i.test(userId)) { res.status(400).json({ message: 'Invalid user' }); return }

    const rows = await Message.aggregate([
      { $match: {
        kind: 'dm',
        $or: [
          { conversationId: { $regex: `^${userId}_` } },
          { conversationId: { $regex: `_${userId}$` } },
        ],
      }},
      { $sort: { createdAt: -1 } },
      { $group: {
        _id:           '$conversationId',
        lastMessageAt: { $first: '$createdAt' },
        lastMessage:   { $first: '$content' },
        lastKind:      { $first: '$systemType' },
      }},
    ])

    // Map each conversation to the other participant.
    const byPartner = new Map<string, typeof rows[number]>()
    for (const r of rows) {
      const [a, b] = String(r._id).split('_')
      const other  = a === userId ? b : a
      if (!other || other === userId || !mongoose.isValidObjectId(other)) continue
      byPartner.set(other, r)
    }

    const partners = await User.find({ _id: { $in: [...byPartner.keys()] } })
      .select('username displayName avatar avatarCrop status').lean()

    // A deleted account leaves messages behind; skip those rather than
    // shipping a row the client can't render a name for.
    const dms = partners.map(p => {
      const r = byPartner.get(p._id.toString())!
      return {
        id:            p._id.toString(),
        username:      p.username,
        displayName:   p.displayName,
        avatar:        p.avatar,
        avatarCrop:    p.avatarCrop ?? null,
        status:        effectiveStatus(p.status, p._id.toString()),
        lastMessage:   r.lastKind ? '' : String(r.lastMessage || ''),
        lastMessageAt: r.lastMessageAt,
      }
    }).sort((x, y) => +new Date(y.lastMessageAt) - +new Date(x.lastMessageAt))

    res.json({ dms })
  } catch (err) { next(err) }
}

// ── Get a group's messages (paginated) ────────────────────────────────────────
export const getGroupMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    const before = req.query.before as string | undefined
    const limit  = Math.min(Number(req.query.limit) || 50, 100)

    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }

    // Membership check — you can't read a group you're not in.
    const group = await Conversation.findById(groupId).lean()
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    const filter: any = { conversationId: groupId, kind: { $in: ['group', 'system'] } }
    if (before) filter.createdAt = { $lt: new Date(before) }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    const resolved = await resolveMessages(messages)
    res.json({ messages: resolved.reverse() })
  } catch (err) { next(err) }
}

// ── Send a group message (REST fallback when the socket is down) ──────────────
export const sendGroupMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    // authorName is still accepted in the body by older clients, and ignored.
    const { content, replyToIds } = req.body as { content: string; replyToIds?: string[] }

    if (!content?.trim()) { res.status(400).json({ message: 'Content required' }); return }
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }

    const group = await Conversation.findById(groupId)
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    // Name and avatar both come from the User document, never the request body.
    // The three socket send paths and the DM REST path were hardened when
    // authorName spoofing was fixed; this one was missed, leaving a client able
    // to post into a group as "Skycord System" or as another member.
    const sender = await User.findById(userId).select('avatar avatarCrop displayName username').lean()

    const ids = Array.isArray(replyToIds) ? replyToIds : []
    const targets = ids.length
      ? await Message.find({ _id: { $in: ids } }).select('authorName content').lean()
      : []
    const targetById = new Map(targets.map(t => [t._id.toString(), t]))
    const replyPreviews = ids
      .map(id => targetById.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(t => ({ id: t._id.toString(), author: t.authorName, content: t.content.slice(0, 80) }))

    const msg = await Message.create({
      conversationId: groupId,
      kind:           'group',
      authorId:       userId,
      authorName:     sender?.displayName || sender?.username || 'Unknown',
      authorAvatar:   sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:        content.trim(),
      replyToIds:     ids,
    })
    group.lastMessageAt = msg.createdAt
    await group.save()

    const payload = {
      _id:            msg._id.toString(),
      conversationId: groupId,
      authorId:       userId,
      authorName:     msg.authorName,
      authorAvatar:   sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:        msg.content,
      reactions:      [],
      pinned:         false,
      edited:         false,
      replyTo:        replyPreviews,
      createdAt:      msg.createdAt.toISOString(),
    }

    // Reach connected members live. The sender used REST because their own
    // socket is down, so they won't echo this back to themselves.
    const io = getIO()
    if (io) {
      io.to(`group:${groupId}`).emit('group:receive', payload)
      if (/@everyone\b/.test(msg.content)) io.to(`group:${groupId}`).emit('mention:everyone', { conversationId: groupId, authorName: msg.authorName })
    }

    res.status(201).json({ message: payload })
  } catch (err) { next(err) }
}

// ── Get a group's members ─────────────────────────────────────────────────────
export const getGroupMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }

    const group = await Conversation.findById(groupId).lean()
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    const members = await User.find({ _id: { $in: group.members } })
      .select('username displayName avatar avatarCrop status').lean()

    res.json({
      members: members.map(m => ({
        id:          m._id.toString(),
        username:    m.username,
        displayName: m.displayName,
        avatar:      m.avatar ?? null,
        avatarCrop:  m.avatarCrop ?? null,
        status:      effectiveStatus(m.status, m._id.toString()),
        isOwner:     group.owner.toString() === m._id.toString(),
      })),
    })
  } catch (err) { next(err) }
}

// ── Add members directly (friend-checkbox path) ───────────────────────────────
export const addGroupMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    const { memberIds } = req.body as { memberIds: string[] }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ message: 'No members selected' }); return
    }
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }

    const group = await Conversation.findById(groupId)
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    const existing = new Set(group.members.map(m => m.toString()))
    const toAdd = memberIds.filter(id => !existing.has(id))
    if (toAdd.length === 0) { res.status(400).json({ message: 'Those people are already in the group' }); return }

    if (existing.size + toAdd.length > MAX_GROUP_MEMBERS) {
      res.status(400).json({ message: `Group DMs can have up to ${MAX_GROUP_MEMBERS} members` }); return
    }

    group.members.push(...toAdd.map(id => new mongoose.Types.ObjectId(id)))
    await group.save()

    const memberDocs = await User.find({ _id: { $in: group.members } })
      .select('username displayName avatar avatarCrop status').lean()

    const io = getIO()
    if (io) {
      const shaped = shapeGroup(group, memberDocs)
      // Newly added members get the full group; existing members get an update.
      group.members.forEach(m => io.to(`user:${m.toString()}`).emit('group:updated', shaped))
    }

    // System log: "{actor} added {names} to the group"
    const actorName  = await actorNameOf(userId)
    const addedNames = memberDocs
      .filter(m => toAdd.includes(m._id.toString()))
      .map(m => m.displayName || m.username)
    await postGroupSystem(groupId, userId, actorName, 'add', `${actorName} added ${addedNames.join(', ')} to the group`)

    res.json({ group: shapeGroup(group, memberDocs) })
  } catch (err) { next(err) }
}

// ── Update a group (rename / set avatar) ──────────────────────────────────────
export const updateGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    const { name, avatar } = req.body as { name?: string | null; avatar?: string | null }

    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }
    if (name === undefined && avatar === undefined) {
      res.status(400).json({ message: 'Nothing to update' }); return
    }

    const group = await Conversation.findById(groupId)
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    let nameChanged = false
    let iconChanged = false
    if (name !== undefined) {
      const trimmed = (name ?? '').trim()
      if (trimmed.length > 100) { res.status(400).json({ message: 'Group name is too long' }); return }
      const next = trimmed || null
      nameChanged = next !== (group.name ?? null)
      group.name = next
    }
    if (avatar !== undefined) {
      // Stored as a base64 data URL (same approach as user/sticker avatars).
      // Guard against oversized payloads slipping past the body-size limit.
      if (avatar && avatar.length > 1_500_000) { res.status(400).json({ message: 'Image is too large' }); return }
      const next = avatar || null
      iconChanged = next !== (group.avatar ?? null)
      group.avatar = next
    }
    await group.save()

    const memberDocs = await User.find({ _id: { $in: group.members } })
      .select('username displayName avatar avatarCrop status').lean()
    const shaped = shapeGroup(group, memberDocs)

    const io = getIO()
    if (io) group.members.forEach(m => io.to(`user:${m.toString()}`).emit('group:updated', shaped))

    // System logs for whatever actually changed.
    if (nameChanged || iconChanged) {
      const actorName = await actorNameOf(userId)
      if (nameChanged) {
        const text = group.name ? `${actorName} changed the group name: ${group.name}` : `${actorName} removed the group name`
        await postGroupSystem(groupId, userId, actorName, 'rename', text)
      }
      if (iconChanged) await postGroupSystem(groupId, userId, actorName, 'icon', `${actorName} changed the group icon`)
    }

    res.json({ group: shaped })
  } catch (err) { next(err) }
}

// ── Leave a group ─────────────────────────────────────────────────────────────
export const leaveGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }

    const group = await Conversation.findById(groupId)
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    group.members = group.members.filter(m => m.toString() !== userId)

    const io = getIO()

    // If the group is now empty, delete it entirely (and its invites).
    if (group.members.length === 0) {
      await Conversation.deleteOne({ _id: group._id })
      await GroupInvite.deleteMany({ group: group._id })
      res.json({ left: true, deleted: true }); return
    }

    // If the owner left, hand ownership to the oldest remaining member so the
    // group never ends up ownerless.
    if (group.owner.toString() === userId) {
      group.owner = group.members[0]
    }
    await group.save()

    if (io) {
      const memberDocs = await User.find({ _id: { $in: group.members } })
        .select('username displayName avatar avatarCrop status').lean()
      const shaped = shapeGroup(group, memberDocs)
      group.members.forEach(m => io.to(`user:${m.toString()}`).emit('group:updated', shaped))
    }

    // System log: "{name} left the group"
    const leaverName = await actorNameOf(userId)
    await postGroupSystem(group._id.toString(), userId, leaverName, 'leave', `${leaverName} left the group`)

    res.json({ left: true, deleted: false })
  } catch (err) { next(err) }
}

// ── Create an invite link ─────────────────────────────────────────────────────
export const createGroupInvite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { groupId } = req.params
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }

    const group = await Conversation.findById(groupId).lean()
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === userId)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }

    // Generate a code, retrying on the (astronomically unlikely) collision.
    let code = generateInviteCode()
    for (let i = 0; i < 5; i++) {
      const clash = await GroupInvite.exists({ code })
      if (!clash) break
      code = generateInviteCode()
    }

    const invite = await GroupInvite.create({
      code,
      group:     group._id,
      createdBy: userId,
      expiresAt: inviteExpiry(),
    })

    res.status(201).json({ code: invite.code, expiresAt: invite.expiresAt })
  } catch (err) { next(err) }
}

// ── Look up an invite (for rendering the join card before joining) ────────────
export const getInvite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { code } = req.params
    const invite = await GroupInvite.findOne({ code }).lean()
    if (!invite) { res.status(404).json({ message: 'This invite is invalid or has expired' }); return }
    if (invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }

    const group = await Conversation.findById(invite.group).lean()
    if (!group) { res.status(404).json({ message: 'This group no longer exists' }); return }

    const memberDocs = await User.find({ _id: { $in: group.members } })
      .select('username displayName avatar avatarCrop').lean()

    res.json({
      code:        invite.code,
      group: {
        id:          group._id.toString(),
        name:        group.name ?? null,
        memberCount: group.members.length,
        memberNames: memberDocs.map(m => m.displayName || m.username),
        // Lets the in-chat join card render "Joined" up front for someone who's
        // already in the group, instead of a useless "Join".
        isMember:    group.members.some(m => m.toString() === userId),
      },
    })
  } catch (err) { next(err) }
}

// ── Join a group via invite code ──────────────────────────────────────────────
export const joinViaInvite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { code } = req.params

    const invite = await GroupInvite.findOne({ code }).lean()
    if (!invite) { res.status(404).json({ message: 'This invite is invalid or has expired' }); return }
    if (invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }

    const group = await Conversation.findById(invite.group)
    if (!group) { res.status(404).json({ message: 'This group no longer exists' }); return }

    // Already a member — treat as success (idempotent), just return the group.
    const alreadyIn = group.members.some(m => m.toString() === userId)
    if (!alreadyIn) {
      if (group.members.length >= MAX_GROUP_MEMBERS) {
        res.status(400).json({ message: 'This group is full' }); return
      }
      group.members.push(new mongoose.Types.ObjectId(userId))
      await group.save()
    }

    const memberDocs = await User.find({ _id: { $in: group.members } })
      .select('username displayName avatar avatarCrop status').lean()
    const shaped = shapeGroup(group, memberDocs)

    if (!alreadyIn) {
      const io = getIO()
      if (io) group.members.forEach(m => io.to(`user:${m.toString()}`).emit('group:updated', shaped))
      // System log: "{name} joined the group"
      const joinerName = await actorNameOf(userId)
      await postGroupSystem(group._id.toString(), userId, joinerName, 'join', `${joinerName} joined the group`)
    }

    res.json({ group: shaped, alreadyMember: alreadyIn })
  } catch (err) { next(err) }
}
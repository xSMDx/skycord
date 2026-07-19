import { Request, Response, NextFunction } from 'express'
import { User } from '../models/User'
import { Friendship } from '../models/Friendship'
import mongoose from 'mongoose'
import { getIO, isUserOnline } from '../sockets/chatSocket'

// Anyone without a live socket is offline, whatever the DB says. Connected
// users keep their chosen status (idle/dnd/invisible) rather than being forced
// to 'online'.
const presenceFor = (userId: string, stored: string): string =>
  isUserOnline(userId) ? (stored === 'offline' ? 'online' : stored) : 'offline'

// ── Search users by username/displayName ────────────────────────────────────
export const searchUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q || q.length < 2) { res.json({ users: [] }); return }

    const users = await User.find({
      $and: [
        { _id: { $ne: req.user?.sub } },  // exclude self
        {
          $or: [
            { username:    { $regex: q, $options: 'i' } },
            { displayName: { $regex: q, $options: 'i' } },
          ]
        }
      ]
    }).limit(20).lean()

    res.json({ users: users.map(u => ({
      id:            u._id.toString(),
      username:      u.username,
      displayName:   u.displayName,
      discriminator: u.discriminator,
      avatar:        u.avatar,
      status:        presenceFor(u._id.toString(), u.status),
    })) })
  } catch (err) { next(err) }
}

// ── Send friend request ──────────────────────────────────────────────────────
export const sendFriendRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const requesterId = req.user!.sub
    const { targetId } = req.body

    if (requesterId === targetId) {
      res.status(400).json({ message: "You can't friend yourself" }); return
    }

    const target = await User.findById(targetId)
    if (!target) { res.status(404).json({ message: 'User not found' }); return }

    // Check if friendship already exists either direction
    const existing = await Friendship.findOne({
      $or: [
        { requester: requesterId, receiver: targetId },
        { requester: targetId,   receiver: requesterId },
      ]
    })
    if (existing) {
      if (existing.status === 'accepted') {
        res.status(409).json({ message: 'Already friends' }); return
      }
      if (existing.status === 'pending') {
        res.status(409).json({ message: 'Friend request already sent' }); return
      }
    }

    const friendship = await Friendship.create({ requester: requesterId, receiver: targetId })

    // Live notification to recipient so the pending-requests badge updates instantly
    const io = getIO()
    if (io) {
      const requester = await User.findById(requesterId).lean()
      io.to(`user:${targetId}`).emit('friend:request_received', {
        _id:       friendship._id.toString(),
        requester: {
          id:            requesterId,
          username:      requester?.username      ?? '',
          displayName:   requester?.displayName   ?? '',
          discriminator: requester?.discriminator ?? '0000',
          avatar:        requester?.avatar        ?? null,
          status:        requester?.status        ?? 'offline',
        },
        createdAt: friendship.createdAt.toISOString(),
      })
    }

    res.status(201).json({ message: 'Friend request sent' })
  } catch (err) { next(err) }
}

// ── Accept friend request ────────────────────────────────────────────────────
export const acceptFriendRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId      = req.user!.sub
    const { requestId } = req.params

    const friendship = await Friendship.findOne({
      _id: requestId,
      receiver: userId,
      status: 'pending',
    })
    if (!friendship) { res.status(404).json({ message: 'Request not found' }); return }

    friendship.status = 'accepted'
    await friendship.save()

    // Live notification to the original requester so their friends list updates
    const io = getIO()
    if (io) {
      io.to(`user:${friendship.requester.toString()}`).emit('friend:request_accepted', {
        friendId: userId,
      })
    }

    res.json({ message: 'Friend request accepted' })
  } catch (err) { next(err) }
}

// ── Get friends list ─────────────────────────────────────────────────────────
export const getFriends = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub

    const friendships = await Friendship.find({
      $or: [{ requester: userId }, { receiver: userId }],
      status: 'accepted',
    }).populate('requester receiver', 'username displayName discriminator avatar status bio')

    // Presence comes from the LIVE socket registry, not the stored status. A
    // crash, deploy or missed disconnect can leave `status: 'online'` in the DB
    // forever, which is what made closed tabs keep showing as online.
    const friends = friendships.map(f => {
      const friend: any = f.requester._id.toString() === userId ? f.receiver : f.requester
      const o = friend.toObject ? friend.toObject() : { ...friend }
      o.status = presenceFor(o._id.toString(), o.status)
      return o
    })

    res.json({ friends })
  } catch (err) { next(err) }
}

// ── Get pending requests ──────────────────────────────────────────────────────
export const getPendingRequests = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const requests = await Friendship.find({ receiver: userId, status: 'pending' })
      .populate('requester', 'username displayName discriminator avatar status')
    res.json({ requests })
  } catch (err) { next(err) }
}

// ── Update own profile ────────────────────────────────────────────────────────
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { displayName, bio, status } = req.body

    const allowed: Record<string, any> = {}
    if (displayName) allowed.displayName = String(displayName).trim().slice(0, 50)
    if (bio !== undefined) allowed.bio   = String(bio).slice(0, 190)
    if (status && ['online','idle','dnd','invisible'].includes(status)) allowed.status = status

    const user = await User.findByIdAndUpdate(userId, allowed, { new: true })
    if (!user) { res.status(404).json({ message: 'User not found' }); return }
    res.json({ user: user.toPublicJSON() })
  } catch (err) { next(err) }
}

// ── Change username (requires current password) ──────────────────────────────
export const changeUsername = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { newUsername, currentPassword } = req.body

    if (!newUsername?.trim()) { res.status(400).json({ message: 'New username is required' }); return }
    if (!currentPassword)     { res.status(400).json({ message: 'Current password is required' }); return }

    // Schema already enforces length (3-32) and character set (a-zA-Z0-9_-)
    // via UserSchema's `match` validator — Mongoose will reject an invalid
    // value on save below, no need to duplicate that check here.

    const user = await User.findById(userId).select('+password')
    if (!user) { res.status(404).json({ message: 'User not found' }); return }

    const passwordOk = await user.comparePassword(currentPassword)
    if (!passwordOk) { res.status(401).json({ message: 'Incorrect password' }); return }

    user.username = newUsername.trim()
    try {
      await user.save()
    } catch (err: any) {
      // Mongoose throws code 11000 on a duplicate-key violation (unique:true
      // on the username field) — translate that into a clean message instead
      // of letting a raw Mongo error reach the client.
      if (err?.code === 11000) {
        res.status(409).json({ message: 'That username is already taken' }); return
      }
      throw err
    }

    res.json({ user: user.toPublicJSON() })
  } catch (err) { next(err) }
}

// ── Change email (requires current password) ─────────────────────────────────
export const changeEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { newEmail, currentPassword } = req.body

    if (!newEmail?.trim())   { res.status(400).json({ message: 'New email is required' }); return }
    if (!currentPassword)    { res.status(400).json({ message: 'Current password is required' }); return }

    // Basic format check — kept intentionally simple (not a strict RFC 5322
    // regex) since over-strict email regexes are a common source of rejecting
    // genuinely valid addresses. This just catches obvious typos.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!EMAIL_RE.test(newEmail.trim())) {
      res.status(400).json({ message: 'That doesn\'t look like a valid email address' }); return
    }

    const user = await User.findById(userId).select('+password')
    if (!user) { res.status(404).json({ message: 'User not found' }); return }

    const passwordOk = await user.comparePassword(currentPassword)
    if (!passwordOk) { res.status(401).json({ message: 'Incorrect password' }); return }

    user.email = newEmail.trim().toLowerCase()
    try {
      await user.save()
    } catch (err: any) {
      if (err?.code === 11000) {
        res.status(409).json({ message: 'That email is already in use' }); return
      }
      throw err
    }

    res.json({ user: user.toPublicJSON() })
  } catch (err) { next(err) }
}

// ── Change password ───────────────────────────────────────────────────────────
export const changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { currentPassword, newPassword } = req.body

    if (!currentPassword) { res.status(400).json({ message: 'Current password is required' }); return }
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ message: 'New password must be at least 8 characters' }); return
    }

    const user = await User.findById(userId).select('+password')
    if (!user) { res.status(404).json({ message: 'User not found' }); return }

    const passwordOk = await user.comparePassword(currentPassword)
    if (!passwordOk) { res.status(401).json({ message: 'Incorrect current password' }); return }

    // Plain assignment is enough — UserSchema's pre('save') hook rehashes
    // automatically whenever `password` is modified (see User.ts), so there's
    // no need to call bcrypt directly here.
    user.password = newPassword
    await user.save()

    res.json({ message: 'Password updated' })
  } catch (err) { next(err) }
}

// ── Conversation preferences (pin / mute) ────────────────────────────────────
// Keyed by conversation id: a group's ObjectId, or a DM's synthetic dmConvId.
// Expiry is applied on READ, so a mute that has run out needs no cron sweeper
// and no write — it simply stops reporting as muted.

const liveConvPref = (p: any) => {
  const expired = p?.muted && p?.mutedUntil && new Date(p.mutedUntil).getTime() <= Date.now()
  return {
    pinned:     !!p?.pinned,
    muted:      !!p?.muted && !expired,
    mutedUntil: expired ? null : (p?.mutedUntil ?? null),
  }
}

const prefsToObject = (prefs: Map<string, any> | undefined) => {
  const out: Record<string, ReturnType<typeof liveConvPref>> = {}
  if (!prefs) return out
  prefs.forEach((v, k) => {
    const live = liveConvPref(v)
    // Skip entries that carry no information — an expired mute on an unpinned
    // conversation is just noise the client would have to filter anyway.
    if (live.pinned || live.muted) out[k] = live
  })
  return out
}

export const getConvPrefs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await User.findById(req.user!.sub).select('+convPrefs')
    if (!user) { res.status(404).json({ message: 'User not found' }); return }
    res.json({ prefs: prefsToObject(user.convPrefs as any) })
  } catch (err) { next(err) }
}

export const setConvPref = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { convId } = req.params
    // convId is only ever a Map key on this user's own document, so it can't
    // reach another user's data — but an over-long key would still bloat the
    // doc, and Mongo forbids dots in map keys.
    if (!convId || convId.length > 128 || convId.includes('.')) {
      res.status(400).json({ message: 'Invalid conversation id' }); return
    }

    const user = await User.findById(req.user!.sub).select('+convPrefs')
    if (!user) { res.status(404).json({ message: 'User not found' }); return }

    const prefs  = (user.convPrefs ?? new Map()) as Map<string, any>
    const cur    = liveConvPref(prefs.get(convId))
    const { pinned, mute } = req.body as { pinned?: boolean; mute?: string | null }

    const next_: any = { ...cur }
    if (pinned !== undefined) next_.pinned = !!pinned

    if (mute !== undefined) {
      if (mute === null) {
        next_.muted = false; next_.mutedUntil = null
      } else if (mute === 'forever') {
        next_.muted = true;  next_.mutedUntil = null
      } else {
        const until = new Date(mute)
        if (isNaN(until.getTime()) || until.getTime() <= Date.now()) {
          res.status(400).json({ message: 'mute must be null, "forever", or a future timestamp' }); return
        }
        next_.muted = true; next_.mutedUntil = until
      }
    }

    // Drop the key entirely once nothing is set, so the map doesn't accumulate
    // an entry for every conversation the user has ever right-clicked.
    if (!next_.pinned && !next_.muted) prefs.delete(convId)
    else prefs.set(convId, next_)

    user.convPrefs = prefs as any
    user.markModified('convPrefs')
    await user.save({ validateModifiedOnly: true })

    res.json({ convId, pref: liveConvPref(prefs.get(convId)), prefs: prefsToObject(prefs) })
  } catch (err) { next(err) }
}


// ── Decline a pending friend request ─────────────────────────────────────────
// The client had a decline button that only filtered the row out of local
// state, so the request reappeared on refresh. This is what it should have
// been calling. Scoped to receiver + pending so it can't be used to cancel
// someone else's request or to delete an established friendship.
export const declineFriendRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId        = req.user!.sub
    const { requestId } = req.params

    const result = await Friendship.deleteOne({
      _id: requestId,
      receiver: userId,
      status: 'pending',
    })
    if (!result.deletedCount) { res.status(404).json({ message: 'Request not found' }); return }

    res.json({ message: 'Friend request declined' })
  } catch (err) { next(err) }
}

// ── Remove a friend ──────────────────────────────────────────────────────────
// Either side may remove, so the match is direction-agnostic. Restricted to
// 'accepted' so this can't be repurposed to silently drop a pending request
// (that's decline) or to clear a block (that's a separate, unbuilt flow).
export const removeFriend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId   = req.user!.sub
    const { userId: otherId } = req.params

    if (!mongoose.Types.ObjectId.isValid(otherId)) {
      res.status(400).json({ message: 'Invalid user id' }); return
    }

    const result = await Friendship.deleteOne({
      status: 'accepted',
      $or: [
        { requester: userId,  receiver: otherId },
        { requester: otherId, receiver: userId  },
      ],
    })
    if (!result.deletedCount) { res.status(404).json({ message: 'Friendship not found' }); return }

    // Tell the other side so their list updates without a refresh.
    const io = getIO()
    if (io) io.to(`user:${otherId}`).emit('friend:removed', { friendId: userId })

    res.json({ message: 'Friend removed' })
  } catch (err) { next(err) }
}

import { Request, Response, NextFunction } from 'express'
import { User } from '../models/User'
import { Friendship } from '../models/Friendship'
import mongoose from 'mongoose'
import { getIO } from '../sockets/chatSocket'

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
      status:        u.status,
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

    const friends = friendships.map(f => {
      const friend = f.requester._id.toString() === userId ? f.receiver : f.requester
      return friend
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
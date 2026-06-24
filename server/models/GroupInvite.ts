import mongoose, { Document, Schema, Types } from 'mongoose'
import { randomBytes } from 'crypto'

// Invite links expire 24h after creation, matching the reference UI's
// "Your invite link expires in 24 hours."
const INVITE_TTL_MS = 24 * 60 * 60 * 1000

export interface IGroupInvite extends Document {
  _id:       Types.ObjectId
  code:      string
  group:     Types.ObjectId
  createdBy: Types.ObjectId
  expiresAt: Date
  createdAt: Date
}

const GroupInviteSchema = new Schema<IGroupInvite>(
  {
    code:      { type: String, required: true, unique: true, index: true },
    group:     { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
)

// TTL index — MongoDB automatically deletes invite docs once expiresAt passes,
// so expired invites clean themselves up without a manual sweep job.
GroupInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Generate a short, URL-safe invite code (e.g. "438CGkAe" in the reference).
// 6 random bytes → 8 base64url chars, collision-checked by the caller.
export const generateInviteCode = (): string =>
  randomBytes(6).toString('base64url')

export const inviteExpiry = (): Date => new Date(Date.now() + INVITE_TTL_MS)

export const GroupInvite = mongoose.model<IGroupInvite>('GroupInvite', GroupInviteSchema)
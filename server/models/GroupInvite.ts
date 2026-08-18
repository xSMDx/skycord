import mongoose, { Document, Schema, Types } from 'mongoose'
import { generateInviteCode, inviteExpiry } from '../utils/inviteCode'
export { generateInviteCode, inviteExpiry }

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

export const GroupInvite = mongoose.model<IGroupInvite>('GroupInvite', GroupInviteSchema)
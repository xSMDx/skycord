import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * Separate from GroupInvite rather than a generalisation of it: a server link
 * may never expire, which needs a nullable expiresAt. Mongo's TTL index skips
 * documents whose field is not a date, so "never" needs no special-casing.
 */
export interface IServerInvite extends Document {
  _id:       Types.ObjectId
  code:      string
  server:    Types.ObjectId
  createdBy: Types.ObjectId
  /** A voice channel to land in, or null for a plain server invite. The
   *  channel can be deleted while the invite lives, so every reader treats a
   *  dangling id as "no destination" rather than as an error. */
  channel:   Types.ObjectId | null
  expiresAt: Date | null
  uses:      number
  createdAt: Date
}

const ServerInviteSchema = new Schema<IServerInvite>(
  {
    code:      { type: String, required: true, unique: true, index: true },
    server:    { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channel:   { type: Schema.Types.ObjectId, ref: 'Channel', default: null },
    expiresAt: { type: Date, default: null },
    // Reported, not enforced. There is deliberately no maxUses.
    uses:      { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
)

ServerInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
ServerInviteSchema.index({ server: 1 })

export const ServerInvite = mongoose.model<IServerInvite>('ServerInvite', ServerInviteSchema)

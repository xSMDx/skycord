import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A place to talk inside a server. No members array — membership belongs to
 * the Server, and this cycle has no per-channel permissions.
 */
export type ChannelType = 'text' | 'voice'

export interface IChannel extends Document {
  _id:      Types.ObjectId
  server:   Types.ObjectId
  name:     string
  type:     ChannelType
  /** Order within its type group. Assigned by appending; no reorder UI yet. */
  position: number
  createdAt: Date
  updatedAt: Date
}

const ChannelSchema = new Schema<IChannel>(
  {
    server:   { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    name:     { type: String, required: true, maxlength: 100 },
    type:     { type: String, enum: ['text', 'voice'], required: true, default: 'text' },
    position: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
)

ChannelSchema.index({ server: 1, position: 1 })

export const Channel = mongoose.model<IChannel>('Channel', ChannelSchema)

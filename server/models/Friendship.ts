import mongoose, { Document, Schema, Types } from 'mongoose'

export interface IFriendship extends Document {
  _id:       Types.ObjectId
  requester: Types.ObjectId   // user who sent request
  receiver:  Types.ObjectId   // user who received it
  status:    'pending' | 'accepted' | 'blocked'
  createdAt: Date
  updatedAt: Date
}

const FriendshipSchema = new Schema<IFriendship>(
  {
    requester: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status:    { type: String, enum: ['pending','accepted','blocked'], default: 'pending' },
  },
  { timestamps: true, versionKey: false }
)

// Each pair can only have one friendship record
FriendshipSchema.index({ requester: 1, receiver: 1 }, { unique: true })

export const Friendship = mongoose.model<IFriendship>('Friendship', FriendshipSchema)

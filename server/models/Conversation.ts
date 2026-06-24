import mongoose, { Document, Schema, Types } from 'mongoose'

export const MAX_GROUP_MEMBERS = 20

export interface IConversation extends Document {
  _id:           Types.ObjectId
  type:          'group'
  name:          string | null
  avatar:        string | null
  owner:         Types.ObjectId
  members:       Types.ObjectId[]
  lastMessageAt: Date
  createdAt:     Date
  updatedAt:     Date
}

const ConversationSchema = new Schema<IConversation>(
  {
    type:    { type: String, enum: ['group'], required: true, default: 'group' },
    name:    { type: String, default: null },
    avatar:  { type: String, default: null },
    owner:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
)

ConversationSchema.index({ members: 1, lastMessageAt: -1 })

export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema)

import mongoose, { Document, Schema, Types } from 'mongoose'

export type SystemType = 'rename' | 'icon' | 'add' | 'join' | 'leave' | 'call'

export interface IMessage extends Document {
  _id:        Types.ObjectId
  conversationId: string   // dmId (sorted userIds joined) or channelId
  kind:       'dm' | 'group' | 'channel' | 'system'
  authorId:   Types.ObjectId
  authorName: string
  authorAvatar: string | null
  /** Framing for an animated authorAvatar. Static avatars are cropped at
   *  upload, so this is null for all but GIFs. */
  authorAvatarCrop: { zoom: number; x: number; y: number } | null
  content:    string
  systemType: SystemType | null
  reactions:  { emoji: string; userIds: Types.ObjectId[] }[]
  pinned:     boolean
  /**
   * Whether this message's `@everyone` is a real mention.
   *
   * Decided by the SERVER at send time, from the author's Mention @everyone
   * permission, and stored — because the alternative is what the client used to
   * do: regex the content and highlight on a match. That made the permission
   * unenforceable by construction. Anyone could type the word and every client
   * would light the row up, and re-deciding it on read would also mean an old
   * message changing meaning whenever a role was edited.
   *
   * False on every message written before this existed, which is correct:
   * nothing was enforcing it, so nothing should retroactively claim it was.
   */
  mentionsEveryone: boolean
  edited:     boolean
  replyTo:    Types.ObjectId | null   // legacy single parent (read-only back-compat)
  replyToIds: Types.ObjectId[]        // new: a reply can target multiple messages
  createdAt:  Date
  updatedAt:  Date
}

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: { type: String, required: true, index: true },
    kind:           { type: String, enum: ['dm','group','channel','system'], required: true },
    authorId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName:     { type: String, required: true },
    authorAvatar:   { type: String, default: null },
    authorAvatarCrop: { type: { zoom: Number, x: Number, y: Number }, default: null, _id: false },
    content:        { type: String, required: true, maxlength: 4000 },
    systemType:     { type: String, enum: ['rename','icon','add','join','leave','call'], default: null },
    reactions:      [{ emoji: String, userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }] }],
    pinned:         { type: Boolean, default: false },
    mentionsEveryone: { type: Boolean, default: false },
    edited:         { type: Boolean, default: false },
    replyTo:        { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    replyToIds:     [{ type: Schema.Types.ObjectId, ref: 'Message' }],
  },
  { timestamps: true, versionKey: false }
)

// Efficient pagination: fetch last N messages in a conversation
MessageSchema.index({ conversationId: 1, createdAt: -1 })
// Slowmode asks one question on every send: when did THIS person last post
// HERE. The index above is conversation-wide, so answering it would mean
// walking back through everyone else's messages — in a busy channel, past
// hundreds of them — to find one author's most recent. This makes it a single
// index seek.
MessageSchema.index({ conversationId: 1, authorId: 1, createdAt: -1 })

export const Message = mongoose.model<IMessage>('Message', MessageSchema)
import mongoose, { Document, Schema, Types } from 'mongoose'
import { classifyHas, mentionNames, resolveMentions, SEARCH_HAS, type SearchHas } from '../utils/searchFields'
import { mentionCandidates } from '../utils/searchMembers'
import { searchWords } from '../utils/searchWords'

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
  /** What the message contains, for `has:` search. Derived from `content`. */
  has:        SearchHas[]
  /** Whom it mentions, for `mentions:` search. Resolved from `<@Name>` tokens. */
  mentions:   Types.ObjectId[]
  /** Its words as search reads them, for whole-word matching. Never sent to clients. */
  words:      string[]
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
    has:            [{ type: String, enum: SEARCH_HAS }],
    mentions:       [{ type: Schema.Types.ObjectId, ref: 'User' }],
    words:          { type: [String], select: false },
    edited:         { type: Boolean, default: false },
    replyTo:        { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    replyToIds:     [{ type: Schema.Types.ObjectId, ref: 'Message' }],
  },
  {
    timestamps: true, versionKey: false,
    // `words` is there to be searched, not read: `select: false` keeps it out
    // of queries, and this keeps it out of a document just created or edited
    // when that document is sent as it is.
    toJSON: { transform: (_doc, ret) => { delete (ret as { words?: unknown }).words; return ret } },
  }
)

// Efficient pagination: fetch last N messages in a conversation
MessageSchema.index({ conversationId: 1, createdAt: -1 })
// Slowmode asks one question on every send: when did THIS person last post
// HERE. The index above is conversation-wide, so answering it would mean
// walking back through everyone else's messages — in a busy channel, past
// hundreds of them — to find one author's most recent. This makes it a single
// index seek.
MessageSchema.index({ conversationId: 1, authorId: 1, createdAt: -1 })

/**
 * Keep `has`, `mentions` and `words` in step with the text on every path that saves a
 * message — channel, DM and group sends, both edit paths — without each of
 * them having to remember. `validate` runs for create(), insertMany() and
 * doc.save() alike. A member lookup happens only when the text has a mention.
 */
MessageSchema.pre('validate', async function () {
  if (!this.isNew && !this.isModified('content')) return
  if (this.kind === 'system') { this.has = []; this.mentions = []; this.words = []; return }
  this.has = classifyHas(this.content)
  this.words = searchWords(this.content)
  const names = mentionNames(this.content)
  const people = names.length ? await mentionCandidates(this.kind, this.conversationId, names) : []
  this.mentions = resolveMentions(names, people).map(id => new Types.ObjectId(id))
})

/**
 * Search. `none` tokenises on whitespace and punctuation in any language
 * instead of stemming everything as English: "running" does not find "run",
 * but Arabic, Persian and every other script are searchable at all.
 */
MessageSchema.index({ content: 'text' }, { default_language: 'none', name: 'content_text' })
MessageSchema.index({ conversationId: 1, mentions: 1, createdAt: -1 })
MessageSchema.index({ conversationId: 1, has: 1, createdAt: -1 })

export const Message = mongoose.model<IMessage>('Message', MessageSchema)
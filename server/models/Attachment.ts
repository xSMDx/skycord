import mongoose, { Document, Schema, Types } from 'mongoose'
import type { AttachmentKind } from '../utils/attachmentSniff'

/**
 * One uploaded file.
 *
 * Uploaded first, sent second: the composer uploads as soon as a file is
 * picked, and the message that eventually names it claims it by setting
 * `messageId`. Until then it belongs to nobody but its owner, who can discard
 * it; an hourly sweep removes the ones never sent (server/services/attachments).
 *
 * `key` is the only thing anyone outside the API ever sees — 128 random bits,
 * which is what makes the public file URL safe to hand to an `<img>`.
 */
export interface EmbeddedAttachment {
  key:    string
  name:   string
  size:   number
  /** The sniffed type, never the uploader's claim. */
  mime:   string
  kind:   AttachmentKind
  width:  number | null
  height: number | null
}

export type WireAttachment = EmbeddedAttachment & { url: string }

export interface IAttachment extends Document, EmbeddedAttachment {
  _id:            Types.ObjectId
  ownerId:        Types.ObjectId
  store:          { kind: 'gridfs'; id: Types.ObjectId }
  messageId:      Types.ObjectId | null
  conversationId: string | null
  createdAt:      Date
}

const AttachmentSchema = new Schema<IAttachment>(
  {
    key:            { type: String, required: true, unique: true },
    ownerId:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name:           { type: String, required: true, maxlength: 400 },
    size:           { type: Number, required: true },
    mime:           { type: String, required: true },
    kind:           { type: String, enum: ['image', 'video', 'file'], required: true },
    width:          { type: Number, default: null },
    height:         { type: Number, default: null },
    store:          { type: { kind: { type: String, enum: ['gridfs'] }, id: Schema.Types.ObjectId }, required: true, _id: false },
    messageId:      { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    conversationId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
)

// The sweep asks two questions: which are still unsent past a day, and which
// sent ones have lost their message. Both start from messageId.
AttachmentSchema.index({ messageId: 1, createdAt: 1 })

export const Attachment = mongoose.model<IAttachment>('Attachment', AttachmentSchema)

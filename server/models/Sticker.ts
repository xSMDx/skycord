import mongoose, { Document, Schema, Types } from 'mongoose'

export interface IStickerDocument extends Document {
  _id:        Types.ObjectId
  creatorId:  Types.ObjectId
  name:       string
  type:       'text' | 'image'
  // Text stickers: short styled text rendered as a sticker (color, weight, bg).
  // Image stickers: a user-uploaded picture, stored as a base64 data URI.
  // Only one of these two blocks is populated, depending on `type`.
  text?: {
    content:    string
    color:      string
    background: string
    fontWeight: 'normal' | 'bold'
  }
  image?: {
    // Base64 data URI (e.g. "data:image/png;base64,...") — stored directly in
    // Mongo rather than external object storage. Size is enforced in
    // stickersController.ts at upload time (1MB cap pre-encoding), not by
    // this schema — Mongoose itself won't reject an oversized string here.
    data: string
  }
  starredBy:  Types.ObjectId[]
  createdAt:  Date
  updatedAt:  Date
}

const StickerSchema = new Schema<IStickerDocument>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:      { type: String, required: true, trim: true, maxlength: 32 },
    type:      { type: String, enum: ['text', 'image'], required: true },
    text: {
      content:    { type: String, maxlength: 12 },
      color:      { type: String, default: '#ffffff' },
      background: { type: String, default: '#5865f2' },
      fontWeight: { type: String, enum: ['normal', 'bold'], default: 'bold' },
    },
    image: {
      data: { type: String },
    },
    starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, versionKey: false }
)

// Fast lookup for "stickers I've starred" and "stickers I created"
StickerSchema.index({ starredBy: 1 })

export const Sticker = mongoose.model<IStickerDocument>('Sticker', StickerSchema)
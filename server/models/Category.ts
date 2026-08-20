import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A named group of channels inside a server.
 *
 * Deliberately its own collection rather than a third `Channel.type`. Discord
 * models categories as channels with a parent, but here `Channel.type` is
 * `'text' | 'voice'` and that enum is load-bearing: sendChannelMessage rejects
 * anything non-text, loadChannel and the chan:<id> room joins assume it, and
 * the client splits on it. A third value would need a new guard at every one
 * of those sites, and a missed one would treat a category as postable. A
 * separate collection cannot be posted to by construction.
 */
export const MAX_CATEGORIES = 50

export interface ICategory extends Document {
  _id:      Types.ObjectId
  server:   Types.ObjectId
  name:     string
  /** Order within the server. Assigned by appending; no reorder UI yet. */
  position: number
  createdAt: Date
  updatedAt: Date
}

const CategorySchema = new Schema<ICategory>(
  {
    server:   { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    name:     { type: String, required: true, maxlength: 100 },
    position: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
)

CategorySchema.index({ server: 1, position: 1 })

export const Category = mongoose.model<ICategory>('Category', CategorySchema)

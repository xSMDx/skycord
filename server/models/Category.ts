import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A named group of channels inside a server.
 *
 * Deliberately its own collection rather than a third `Channel.type`. Discord
 * models categories as channels with a parent, but here `Channel.type` is
 * `'text' | 'voice'` and that enum is load-bearing: sendChannelMessage's
 * `type !== 'text'` guard rejects anything non-text (channelsController.ts),
 * deleteChannel's last-channel guard only counts `type: 'text'` channels
 * (channelsController.ts), and the client splits rendering by type
 * (`groupedChannels` in useServers.ts buckets each group into text/voice).
 * Note that loadChannel
 * and the chan:<id> room joins (createChannel, chatSocket) are already
 * type-agnostic — they resolve or join by id alone, so a third value would
 * not need new guards there. A third value would still need auditing at the
 * sites above, and a missed guard on sendChannelMessage in particular would
 * treat a category as postable. A separate collection cannot be posted to by
 * construction.
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

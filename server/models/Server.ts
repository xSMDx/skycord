import mongoose, { Document, Schema, Types } from 'mongoose'
import type { ICrop } from './User'

/**
 * A server: a named place with members and channels. Deliberately separate
 * from Conversation — group DMs keep working untouched, and unifying them
 * would be a live-data migration across every DM and group path.
 */
export const MAX_SERVER_MEMBERS = 100

export interface IServer extends Document {
  _id:         Types.ObjectId
  name:        string
  icon:        string | null
  iconCrop:    ICrop | null
  bannerColor: string | null
  description: string | null
  owner:       Types.ObjectId
  members:     Types.ObjectId[]
  isPublic:    boolean
  createdAt:   Date
  updatedAt:   Date
}

const ServerSchema = new Schema<IServer>(
  {
    // Free unicode: reference channel and server names carry emoji, so there
    // is no slug validation here on purpose.
    name:        { type: String, required: true, maxlength: 100 },
    icon:        { type: String, default: null },
    iconCrop:    { type: { zoom: Number, x: Number, y: Number }, default: null, _id: false },
    bannerColor: { type: String, default: null },
    description: { type: String, default: null, maxlength: 300 },
    owner:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members:     [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // Opt-in, and false is the only safe default. Discover lists servers by
    // this flag alone -- listing anything the owner has not deliberately
    // published would expose every private friend-group server on the
    // instance, which is the opposite of what this project is for.
    isPublic:    { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
)

ServerSchema.index({ members: 1 })
// Discover reads public servers newest-first; without this it is a collection
// scan on every visit.
ServerSchema.index({ isPublic: 1, createdAt: -1 })

export const Server = mongoose.model<IServer>('Server', ServerSchema)

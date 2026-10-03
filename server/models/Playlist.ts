import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * An ordered set of a member's own tracks.
 *
 * Order is the whole point, so this is an array of ids rather than a tag on
 * Track — a playlist is a sequence someone arranged, and the same track can
 * appear in several of them. The array is capped in the controller, not here;
 * a schema cannot express "at most N" in a way Mongoose enforces on $push.
 *
 * Deliberately not shared, owned jointly, or collaborative in this phase.
 * Sharing music happens in a call, by playing it into a music channel, which
 * shares the sound and not the file.
 */
export interface IPlaylistDocument extends Document {
  _id:     Types.ObjectId
  ownerId: Types.ObjectId
  name:        string
  description: string
  /**
   * References into Track. Entries can outlive the track they name — deleting
   * a track does not rewrite every playlist that mentioned it — so readers
   * resolve these and drop what no longer exists rather than trusting the
   * length of this array.
   */
  trackIds: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

const PlaylistSchema = new Schema<IPlaylistDocument>(
  {
    ownerId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:        { type: String, required: true, trim: true, maxlength: 64 },
    description: { type: String, default: '', trim: true, maxlength: 300 },
    trackIds:    [{ type: Schema.Types.ObjectId, ref: 'Track' }],
  },
  { timestamps: true, versionKey: false }
)

/** The rail: one member's playlists, most recently touched first. */
PlaylistSchema.index({ ownerId: 1, updatedAt: -1 })

export const Playlist = mongoose.model<IPlaylistDocument>('Playlist', PlaylistSchema)

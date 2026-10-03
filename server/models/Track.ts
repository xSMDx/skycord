import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * One piece of audio somebody owns.
 *
 * The audio itself is NOT here. Every other media type in this app lives in
 * its document as a base64 data URI — see Sticker.image.data — and that works
 * because an avatar is 40KB. One four-minute track is 5–10MB, base64 adds a
 * third, and Mongo refuses a document over 16MB, so a library of them is not
 * expressible that way. The bytes go to GridFS; this is the card in the index.
 *
 * What is stored is also not what was uploaded. Ingest re-encodes everything
 * to Opus, so `store` points at bytes our own encoder wrote — see
 * docs/music-phase-2.md for why that is the load-bearing part of the pipeline
 * rather than the virus scan.
 */
export interface ITrackDocument extends Document {
  _id:     Types.ObjectId
  ownerId: Types.ObjectId

  /** Tag text, already clamped and stripped of control characters by ingest. */
  title:  string
  artist: string
  album:  string

  durationSec: number
  /** Size of the normalised audio, not of the original upload. */
  bytes:       number

  /**
   * Cover art, re-encoded small. Inline because it is thumbnail-sized and
   * every list view wants it — the reasoning that rules out inline audio is
   * about megabytes, and this is kilobytes.
   */
  coverWebp?: string

  store: {
    kind: 'gridfs'
    id:   Types.ObjectId
  }

  source:    'upload' | 'link'
  /** Kept for "where did this come from", never re-fetched. */
  sourceUrl?: string

  /**
   * `skipped` means no scanner was configured, and is honest rather than
   * reassuring: it is not a claim the file is clean. A scanner that is
   * configured and failing yields `error`, and ingest refuses the file —
   * nothing reaches here in that state except by a later scanner change.
   */
  scan: 'clean' | 'skipped' | 'infected' | 'error'

  createdAt: Date
  updatedAt: Date
}

const TrackSchema = new Schema<ITrackDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    title:  { type: String, required: true, trim: true, maxlength: 200 },
    artist: { type: String, default: '', trim: true, maxlength: 200 },
    album:  { type: String, default: '', trim: true, maxlength: 200 },

    durationSec: { type: Number, required: true, min: 0 },
    bytes:       { type: Number, required: true, min: 0 },
    coverWebp:   { type: String },

    store: {
      kind: { type: String, enum: ['gridfs'], required: true },
      id:   { type: Schema.Types.ObjectId, required: true },
    },

    source:    { type: String, enum: ['upload', 'link'], required: true },
    sourceUrl: { type: String, maxlength: 2048 },

    scan: { type: String, enum: ['clean', 'skipped', 'infected', 'error'], required: true },
  },
  { timestamps: true, versionKey: false }
)

/** The library view: one member's tracks, newest first. */
TrackSchema.index({ ownerId: 1, createdAt: -1 })

/**
 * Library search. A text index rather than a regex scan because the field it
 * searches is the one people type into, and a leading-wildcard regex cannot
 * use an index at all.
 */
TrackSchema.index({ title: 'text', artist: 'text', album: 'text' })

export const Track = mongoose.model<ITrackDocument>('Track', TrackSchema)

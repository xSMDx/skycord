import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A place to talk inside a server. No members array — membership belongs to
 * the Server, and this cycle has no per-channel permissions.
 */
export type ChannelType = 'text' | 'voice'

export interface IChannel extends Document {
  _id:      Types.ObjectId
  server:   Types.ObjectId
  name:     string
  type:     ChannelType
  /** Order within its type group. Assigned by appending; no reorder UI yet. */
  position: number
  /**
   * The category this channel sits under, or null for uncategorised.
   *
   * Null is the default precisely so no migration is needed: every channel
   * that existed before categories reads as uncategorised, which is exactly
   * what it is.
   */
  category: Types.ObjectId | null

  // ── Overview settings ───────────────────────────────────────────────────
  // Each defaults to the behaviour channels had before it existed, so nothing
  // needs migrating and an old channel reads as "unset" rather than "zero".

  /** Text only. Shown in the header, under the channel name. */
  topic: string | null
  /** Text only. Seconds between messages per member, 0 = off. */
  slowmode: number
  /** Voice only. 0 = unlimited, which is what every channel was until now. */
  userLimit: number
  /** Voice only, kbps. 64 is LiveKit's own default for speech. */
  bitrate: number
  /**
   * Voice only. Which registered VoiceServer this channel uses, or null to
   * follow the server's default.
   *
   * Overrides a member's own preference deliberately: everyone in one channel
   * has to be on the same media server to hear each other, so this is not a
   * preference that can be individually honoured. The member setting applies
   * to DMs and group calls, which have no channel to say otherwise.
   */
  /** A guild VoiceServer's id, or an `instance:<slug>` id from the instance's
   *  own configuration. A String rather than an ObjectId precisely so it can
   *  hold both — existing ObjectId values stringify to the same characters, so
   *  nothing needs migrating. */
  voiceServer: string | null

  createdAt: Date
  updatedAt: Date
}

/** Above 96 the gain is inaudible for speech and the cost is real for anyone
 *  on a poor connection — the same ceiling Discord settled on. */
export const MAX_BITRATE = 96
export const MIN_BITRATE = 8
/** Matches the server member cap; a channel cannot hold more than the server. */
export const MAX_USER_LIMIT = 99
/** Six hours. Longer is indistinguishable from locking the channel. */
export const MAX_SLOWMODE = 21_600

const ChannelSchema = new Schema<IChannel>(
  {
    server:   { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    name:     { type: String, required: true, maxlength: 100 },
    type:     { type: String, enum: ['text', 'voice'], required: true, default: 'text' },
    position: { type: Number, default: 0 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', default: null },

    // Stored regardless of type rather than in a discriminator: a channel's
    // type is fixed at creation today, but if converting one ever lands, the
    // settings for the other kind should survive the round trip rather than
    // being silently dropped.
    topic:     { type: String, default: null, maxlength: 1024 },
    slowmode:  { type: Number, default: 0, min: 0, max: MAX_SLOWMODE },
    userLimit: { type: Number, default: 0, min: 0, max: MAX_USER_LIMIT },
    bitrate:   { type: Number, default: 64, min: MIN_BITRATE, max: MAX_BITRATE },
    // Not a hard ref cleanup: deleting a VoiceServer leaves channels pointing
    // at a dead id, and resolution treats an unresolvable id as "fall back to
    // the default" rather than as an error. Same tolerance `category` has.
    // Not a ref: the value may name an instance server, which has no document.
    voiceServer: { type: String, default: null, maxlength: 80 },
  },
  { timestamps: true, versionKey: false }
)

ChannelSchema.index({ server: 1, position: 1 })

export const Channel = mongoose.model<IChannel>('Channel', ChannelSchema)

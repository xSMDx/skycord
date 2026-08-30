import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A LiveKit server registered by a server owner, for their own voice channels.
 *
 * Per-server rather than instance-wide on purpose: a community whose members
 * are mostly in one place can run their own media server there, and stop
 * routing everyone's audio through whichever machine happens to host the
 * instance. The instance's own LiveKit (from `.env`) remains the fallback for
 * anyone who registers none, and is the only option for DMs and group calls,
 * which belong to no server.
 *
 * Two consequences the UI has to be honest about, because both are inherent
 * rather than incidental:
 *
 *  1. The API secret belongs to the owner, not to us. It is encrypted at rest
 *     (utils/secretBox) and never leaves the server — not in any response, not
 *     to the owner who typed it. A `hint` is stored so the UI can show WHICH
 *     secret without showing it.
 *
 *  2. Whoever supplies the media server can record the calls on it. A server
 *     owner pointing a channel at their own LiveKit controls the audio path
 *     for everyone in that channel. That is the same trust anyone extends to a
 *     self-hoster, but it must be VISIBLE — the call UI names the server it is
 *     connected to rather than switching silently.
 */
export interface IVoiceServer extends Document {
  _id:    Types.ObjectId
  /** The Skycord server (guild) that owns this entry. */
  server: Types.ObjectId
  /** What members see: "Frankfurt", "Home box". Not a hostname. */
  name:   string
  /** Client-reachable signalling URL, handed to the browser. */
  url:    string
  apiKey: string
  /** Sealed by utils/secretBox. `select: false` so a forgotten `.select()`
   *  cannot leak it into a response — the field has to be asked for by name. */
  apiSecret: string
  /** Last four characters of the plaintext, for the settings list. */
  secretHint: string
  /** Used when a channel names no server of its own. Exactly one per server;
   *  see the controller, which clears the others on write. */
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

/** Enough for a region list, few enough that the picker stays a picker. */
export const MAX_VOICE_SERVERS = 10

const VoiceServerSchema = new Schema<IVoiceServer>(
  {
    server:     { type: Schema.Types.ObjectId, ref: 'Server', required: true, index: true },
    name:       { type: String, required: true, maxlength: 40 },
    url:        { type: String, required: true, maxlength: 300 },
    apiKey:     { type: String, required: true, maxlength: 200 },
    apiSecret:  { type: String, required: true, select: false },
    secretHint: { type: String, default: '••••' },
    isDefault:  { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
)

// Two names that differ only by case in one picker is a support ticket.
VoiceServerSchema.index({ server: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const VoiceServer = mongoose.model<IVoiceServer>('VoiceServer', VoiceServerSchema)

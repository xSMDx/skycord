import mongoose, { Schema, Document, Types } from 'mongoose'
import crypto from 'crypto'

/**
 * One signed-in device.
 *
 * Until now a session was nothing but a stateless refresh JWT: the server held
 * no record of who was signed in from where, so "Logged-in Devices" had nothing
 * to list and `logout` could only revoke by incrementing `tokenVersion` — which
 * signs out *every* device, so leaving your laptop also kicked your phone.
 *
 * Each row is addressed by a `sid` carried inside the refresh token. That makes
 * revocation per-device: delete the row and that one cookie stops working,
 * while `tokenVersion` stays as the blunt "everything, now" lever for password
 * changes.
 *
 * The row holds an IP address and a User-Agent, which are personal data. They
 * are here because the screen cannot do its job without them — "is that login
 * from Frankfurt mine?" is the entire question — and they expire with the
 * session rather than accumulating into a history.
 */
export interface ISession extends Document {
  _id:       Types.ObjectId
  user:      Types.ObjectId
  /** Opaque id embedded in the refresh token as `sid`. */
  sid:       string
  userAgent: string
  ip:        string
  /** ISO-3166 alpha-2, uppercase. Null for private addresses or an unknown range. */
  country:   string | null
  lastSeenAt: Date
  expiresAt:  Date
  createdAt:  Date
}

/** 128 bits. Not a bearer credential on its own — it only names a row, and the
 *  signed refresh token is what proves the holder may use it. */
export const newSid = (): string => crypto.randomBytes(16).toString('base64url')

const SessionSchema = new Schema<ISession>(
  {
    user:       { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sid:        { type: String, required: true, unique: true },
    // Bounded: both come straight off a request header, and a header is
    // whatever the caller decided to send.
    userAgent:  { type: String, default: '', maxlength: 512 },
    ip:         { type: String, default: '', maxlength: 64 },
    country:    { type: String, default: null, maxlength: 2 },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt:  { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
)

// Rows outlive their usefulness the moment the refresh token they name expires,
// and a stale row would show as a live device on this screen — the one place
// where a wrong answer actively misleads. Mongo sweeps them itself.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Session = mongoose.model<ISession>('Session', SessionSchema)

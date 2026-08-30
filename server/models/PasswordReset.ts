import mongoose, { Schema, Document, Types } from 'mongoose'
import crypto from 'crypto'

/**
 * A pending password reset.
 *
 * Its own collection rather than fields on User, for three reasons: the
 * documents expire themselves via a TTL index, the reset state stays out of a
 * document read on every authenticated request, and issuing a second reset can
 * revoke the first by deleting rather than by overwriting a field and hoping
 * nothing else read it in between.
 *
 * The token is stored HASHED. A reset token is a bearer credential — anyone
 * holding it can take the account — so a leaked database dump must not contain
 * usable ones. Same reasoning as passwords, and the same reason the plaintext
 * exists only inside the request that mails it.
 */
export interface IPasswordReset extends Document {
  _id:       Types.ObjectId
  user:      Types.ObjectId
  tokenHash: string
  expiresAt: Date
  usedAt:    Date | null
  createdAt: Date
}

/** Long enough that guessing is hopeless, short enough to survive an email
 *  client wrapping the URL. 32 bytes = 256 bits. */
export const RESET_TOKEN_BYTES = 32

/** Deliberately short. The window in which a stolen inbox is also a stolen
 *  account is exactly this long. */
export const RESET_TTL_MINUTES = 30

/** A plaintext token for the email, and the hash to store. The plaintext is
 *  never persisted and never logged. */
export const newResetToken = () => {
  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashResetToken(token) }
}

/**
 * SHA-256, not bcrypt.
 *
 * bcrypt's slowness defends low-entropy human passwords against offline
 * guessing. This input is 256 bits of CSPRNG output, so there is nothing to
 * guess and the cost would buy nothing — while making every verification
 * slow enough to be its own small denial-of-service lever.
 */
export const hashResetToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex')

const PasswordResetSchema = new Schema<IPasswordReset>(
  {
    user:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date,   required: true },
    usedAt:    { type: Date,   default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
)

// Mongo deletes these on its own once expiresAt passes. `expireAfterSeconds: 0`
// means "at the time in this field", not "immediately". Without it, a busy
// instance accumulates dead reset rows forever.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const PasswordReset =
  mongoose.model<IPasswordReset>('PasswordReset', PasswordResetSchema)

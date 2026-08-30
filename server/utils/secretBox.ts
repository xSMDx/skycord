/**
 * Encryption for third-party secrets we are trusted to hold.
 *
 * Only one thing needs this today: the LiveKit API secret a server owner
 * registers so their voice channels can use their own media server. That
 * secret belongs to THEM, not to this instance — a database dump must not
 * hand it to whoever took the dump, the way a plaintext column would.
 *
 * AES-256-GCM, so a tampered value fails to decrypt rather than decrypting to
 * something attacker-chosen. Fresh 12-byte IV per encryption, which is what
 * makes it safe to encrypt the same secret twice.
 *
 * NOT hashing: unlike a password or a reset token, this has to be read back to
 * be used. Reversibility is the requirement, which is exactly why the key
 * matters so much.
 */
import crypto from 'crypto'
import { config } from '../config/env'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12          // GCM's standard; 96 bits is what the mode is built around
const TAG_BYTES = 16

/**
 * The key, derived once.
 *
 * `ENCRYPTION_KEY` if set. Otherwise derived from `JWT_ACCESS_SECRET`, so an
 * existing instance can register a voice server without first inventing new
 * configuration — the alternative is a feature that appears broken until you
 * find a paragraph in a document.
 *
 * The cost of that fallback is real and worth stating: **rotating
 * JWT_ACCESS_SECRET without setting ENCRYPTION_KEY makes every stored secret
 * undecryptable.** They are unrelated concerns sharing a value. Anyone who
 * expects to rotate JWT secrets — which is the correct thing to do after a
 * leak — should set ENCRYPTION_KEY once, first.
 *
 * HKDF rather than using the secret directly: the input is an arbitrary-length
 * string and AES needs exactly 32 bytes, and a domain-separated derivation
 * means the key here is not literally the JWT signing key even when it comes
 * from it.
 */
let cachedKey: Buffer | null = null
const key = (): Buffer => {
  if (cachedKey) return cachedKey
  const material = process.env.ENCRYPTION_KEY || config.jwt.accessSecret
  cachedKey = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(material, 'utf8'), Buffer.alloc(0),
      Buffer.from('skycord:secretbox:v1', 'utf8'), 32)
  )
  return cachedKey
}

/** True when the fallback is in use, so setup docs and warnings can say so. */
export const usingDerivedKey = (): boolean => !process.env.ENCRYPTION_KEY

/**
 * `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 *
 * Versioned from the first line so a future algorithm change can be told apart
 * from this one at read time instead of guessed at.
 */
export const seal = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_BYTES)
  const c = crypto.createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.')
}

/**
 * Returns null rather than throwing on anything unreadable — a wrong key, a
 * tampered value, a truncated column.
 *
 * Null so the one caller can answer "this server's credentials cannot be read"
 * instead of a 500. That distinction matters: after a JWT_ACCESS_SECRET
 * rotation this is the *expected* outcome for every stored secret, and the
 * owner needs to be told to re-enter them, not shown a crash.
 */
export const open = (sealed: string): string | null => {
  try {
    const [v, iv, tag, data] = sealed.split('.')
    if (v !== 'v1' || !iv || !tag || !data) return null
    const ivBuf = Buffer.from(iv, 'base64url')
    const tagBuf = Buffer.from(tag, 'base64url')
    if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) return null
    const d = crypto.createDecipheriv(ALGO, key(), ivBuf)
    d.setAuthTag(tagBuf)
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Last four characters, for showing which secret is stored without showing
 *  it. Never derived from the ciphertext — that would leak nothing useful and
 *  change on every re-encryption of the same value. */
export const hint = (plaintext: string): string =>
  plaintext.length <= 4 ? '••••' : '••••' + plaintext.slice(-4)

import { randomBytes } from 'crypto'

const INVITE_TTL_MS = 24 * 60 * 60 * 1000

/** Short, URL-safe invite code. Collision-checked by the caller. */
export const generateInviteCode = (): string => randomBytes(6).toString('base64url')

/** Default expiry for a group invite: 24 hours. */
export const inviteExpiry = (): Date => new Date(Date.now() + INVITE_TTL_MS)

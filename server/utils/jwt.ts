/**
 * Two tokens, and the difference between them decides what "sign out
 * everywhere" actually means here.
 *
 * The REFRESH token carries `tokenVersion`, checked against the user document
 * on every refresh. Bumping that column is how a session is revoked: password
 * reset, password change, and the reuse-detection path in `refresh` all do it.
 *
 * The ACCESS token carries no such field and is verified by signature and
 * expiry alone — no database read, which is the point of it. So revocation is
 * NOT instant: a killed session keeps working until its current access token
 * runs out, up to JWT_ACCESS_EXPIRES_IN (15m by default). That is the standard
 * trade and it is deliberate, but it is worth knowing before promising anyone
 * that a password change locks an intruder out immediately. Shorten the TTL to
 * shrink the window; checking tokenVersion on every request would close it and
 * cost a lookup per call.
 */
import jwt, { SignOptions } from 'jsonwebtoken'
import { config } from '../config/env'
import { Types } from 'mongoose'

export interface AccessTokenPayload {
  sub:      string
  username: string
  iat?:     number
  exp?:     number
}

export interface RefreshTokenPayload {
  sub:          string
  tokenVersion: number
  /**
   * Names the Session row this cookie belongs to, so one device can be revoked
   * without touching the others.
   *
   * OPTIONAL, permanently. Every cookie issued before sessions existed lacks
   * it, and those are valid for up to REFRESH_EXPIRES_IN after the deploy —
   * requiring it would sign out every user at once. `refresh` upgrades a
   * session-less cookie in place instead.
   */
  sid?:         string
  iat?:         number
  exp?:         number
}

export const signAccessToken = (userId: Types.ObjectId, username: string): string =>
  jwt.sign(
    { sub: userId.toString(), username },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn } as SignOptions
  )

export const signRefreshToken = (userId: Types.ObjectId, tokenVersion: number, sid?: string): string =>
  jwt.sign(
    sid ? { sub: userId.toString(), tokenVersion, sid } : { sub: userId.toString(), tokenVersion },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn } as SignOptions
  )

/** When a Session row's `expiresAt` should be set, matching the cookie that
 *  names it — so the row and the credential die together. */
export const refreshExpiryDate = (): Date => new Date(Date.now() + config.cookie.maxAge)

// `algorithms` is pinned on both. jsonwebtoken already defaults sensibly for a
// string secret, so this is not a live hole — but stating the one algorithm we
// sign with removes the algorithm-confusion class outright rather than relying
// on a library default staying the way it is.
const ALGS: jwt.Algorithm[] = ['HS256']

export const verifyAccessToken  = (token: string) =>
  jwt.verify(token, config.jwt.accessSecret, { algorithms: ALGS }) as AccessTokenPayload

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, config.jwt.refreshSecret, { algorithms: ALGS }) as RefreshTokenPayload

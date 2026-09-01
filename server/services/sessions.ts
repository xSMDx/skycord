/**
 * Creating, touching and revoking the rows behind "Logged-in Devices".
 *
 * Kept out of the controllers because four of them need it — register, login,
 * refresh and the two password paths — and because the ordering rule below
 * (write the row before issuing the cookie) is easy to get wrong once per call
 * site and impossible to get wrong once here.
 */
import type { Request, Response } from 'express'
import type { Types } from 'mongoose'
import { Session, newSid } from '../models/Session'
import { signRefreshToken, refreshExpiryDate } from '../utils/jwt'
import { setRefreshCookie } from '../utils/cookie'
import { clientIp } from '../utils/clientIp'
import { lookupCountry } from '../utils/geoip'

/** How stale `lastSeenAt` may get before a refresh bothers to write. */
const TOUCH_AFTER_MS = 5 * 60 * 1000

/**
 * Record a new signed-in device and hand its cookie to the browser.
 *
 * The row is written BEFORE the cookie is set. The other order leaves a window
 * where a valid refresh cookie names a session that does not exist, and
 * `refresh` reads that as "revoked" — so a failure mid-login would sign the
 * user straight back out with no way to tell why.
 */
export const startSession = async (
  req: Request, res: Response, userId: Types.ObjectId, tokenVersion: number,
): Promise<void> => {
  const ip = clientIp(req)
  const sid = newSid()

  await Session.create({
    user: userId,
    sid,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512),
    ip,
    country: await lookupCountry(ip),
    lastSeenAt: new Date(),
    expiresAt: refreshExpiryDate(),
  })

  setRefreshCookie(res, signRefreshToken(userId, tokenVersion, sid))
}

/**
 * Mark a session as still alive, and follow it if it has moved.
 *
 * Rate-limited to one write per TOUCH_AFTER_MS: a client refreshes every ~15
 * minutes per tab, and an unconditional write would make this the busiest
 * collection in the database for information nobody reads at that resolution.
 * An address change is written immediately regardless — "last seen from a new
 * country" is the single most useful thing this screen can tell anyone, and
 * delaying it by five minutes to save a write would be the wrong trade.
 *
 * @returns false when the session no longer exists, i.e. it was revoked.
 */
export const touchSession = async (req: Request, sid: string): Promise<boolean> => {
  const row = await Session.findOne({ sid })
  if (!row) return false

  const ip = clientIp(req)
  const moved = ip !== '' && ip !== row.ip
  const stale = Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS
  if (!moved && !stale) return true

  row.lastSeenAt = new Date()
  if (moved) {
    row.ip = ip
    row.country = await lookupCountry(ip)
  }
  // The row's life is tied to the cookie's, and refresh does not mint a new
  // cookie — so this must NOT be extended here, or a session would outlive the
  // credential naming it and sit in the list as a device that cannot come back.
  await row.save()
  return true
}

/**
 * Upgrade a pre-sessions refresh cookie in place.
 *
 * Cookies issued before this feature carry no `sid`, and stay valid for up to
 * REFRESH_EXPIRES_IN after the deploy. Rejecting them would sign out every user
 * at once; ignoring them would leave those devices invisible on the very screen
 * meant to show every device. So the first refresh from an old cookie creates
 * the row and swaps the cookie — the user notices nothing.
 */
export const adoptLegacySession = startSession

/** Sign out one device. */
export const revokeSession = (userId: Types.ObjectId, sid: string) =>
  Session.deleteOne({ user: userId, sid })

/** Sign out every device except the one named. Used by the password paths and
 *  by "Sign out all other devices". */
export const revokeOtherSessions = (userId: Types.ObjectId, keepSid?: string | null) =>
  Session.deleteMany(keepSid ? { user: userId, sid: { $ne: keepSid } } : { user: userId })

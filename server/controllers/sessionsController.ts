/**
 * The API behind Settings → Logged-in Devices.
 *
 * Two rules run through all of it:
 *
 *  - **Never return the sid.** It names a revocation target, and the client
 *    needs to name one too — so rows are addressed by their `_id` instead. The
 *    sid stays server-side, where it is only ever compared against the one
 *    inside a signed cookie.
 *  - **Every query is scoped by `user`.** A devices list is a location history;
 *    an id-only lookup would let anyone read, or revoke, anyone else's.
 */
import { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Session, type ISession } from '../models/Session'
import { verifyRefreshToken } from '../utils/jwt'
import { REFRESH_COOKIE } from '../utils/cookie'
import { parseUserAgent } from '../utils/userAgent'

/** The sid of the caller's own device, from the refresh cookie. */
const callerSid = (req: Request): string | null => {
  try { return verifyRefreshToken(req.cookies?.[REFRESH_COOKIE] ?? '').sid ?? null }
  catch { return null }
}

const toClient = (row: ISession, currentSid: string | null) => {
  const ua = parseUserAgent(row.userAgent)
  return {
    id:         row._id.toString(),
    label:      ua.label,
    browser:    ua.browser,
    os:         ua.os,
    kind:       ua.kind,
    ip:         row.ip,
    /** ISO-3166 alpha-2. The client turns this into a flag and a country name. */
    country:    row.country,
    createdAt:  row.createdAt,
    lastSeenAt: row.lastSeenAt,
    /** Drives the "This device" badge, and hides its own revoke button. */
    current:    !!currentSid && row.sid === currentSid,
  }
}

// ── GET /auth/sessions ───────────────────────────────────────────────────
export const listSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user!.sub)
    // Most recent first, but the caller's own device is pinned to the top by
    // the client — sorting it there keeps this endpoint a plain list.
    const rows = await Session.find({ user: userId }).sort({ lastSeenAt: -1 }).limit(100)
    const current = callerSid(req)
    res.json({ sessions: rows.map(r => toClient(r, current)) })
  } catch (err) { next(err) }
}

// ── DELETE /auth/sessions/:id ────────────────────────────────────────────
export const revokeOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user!.sub)
    const { id } = req.params
    if (!Types.ObjectId.isValid(id)) { res.status(400).json({ message: 'Unknown device' }); return }

    const row = await Session.findOne({ _id: id, user: userId })
    if (!row) { res.status(404).json({ message: 'Unknown device' }); return }

    // Revoking your own row is allowed — it is just a sign-out — but the client
    // has to know, because it must then clear its token and return to login
    // rather than sit there holding an access token for a dead session.
    const isCurrent = row.sid === callerSid(req)
    await row.deleteOne()

    res.json({ message: 'Device signed out', current: isCurrent })
  } catch (err) { next(err) }
}

// ── DELETE /auth/sessions ────────────────────────────────────────────────
export const revokeAllOthers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = new Types.ObjectId(req.user!.sub)
    const keep = callerSid(req)

    // Without a readable cookie there is no way to tell which row is the
    // caller's, and deleting every row would sign them out of the tab they are
    // standing in — from a button that says "other devices". Refuse instead.
    if (!keep) { res.status(400).json({ message: 'Sign in again to use this' }); return }

    const { deletedCount } = await Session.deleteMany({ user: userId, sid: { $ne: keep } })
    res.json({ message: 'Other devices signed out', count: deletedCount ?? 0 })
  } catch (err) { next(err) }
}

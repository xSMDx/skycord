/**
 * The one thing the music service tells the API.
 *
 * Only the service knows when a track ran out, because only the service is
 * decoding it. This is the way back: it says "that finished", and the API
 * advances the channel's queue and tells the room.
 *
 * ## Why this is not behind requireAuth
 *
 * The caller is a container, not a person, and has no account. It presents
 * the shared secret the API gave it, compared in constant time. Mounted
 * under `/internal` so the name says what it is, and the deployment does
 * not expose that prefix publicly — but the secret is the control, not the
 * path, because a path is not a credential.
 */
import { Router, type Request, type Response } from 'express'
import { timingSafeEqual } from 'crypto'
import { config } from '../config/env'
import { musicTrackEnded } from '../sockets/chatSocket'

/** Constant time, and length-checked first: timingSafeEqual throws on a mismatch. */
const secretOk = (given: unknown, want: string): boolean => {
  if (typeof given !== 'string' || !want) return false
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * The secret is injected rather than read from config at import.
 *
 * Same shape as instanceRouter: config captures the environment when the
 * module loads, which makes the value impossible to set from a test that
 * imports the app — and a route whose authorisation cannot be tested is a
 * route whose authorisation nobody has checked.
 */
export const internalMusicRouter = (opts: { secret?: string } = {}): Router => {
  const router = Router()

  router.post('/music/ended', (req: Request, res: Response) => {
    const want = opts.secret ?? config.music?.secret ?? ''
    // No secret configured means the feature is off. Refuse rather than
    // fall open: an empty expected secret matching an empty header would
    // make this endpoint public on every instance that never enabled music.
    if (!want || !secretOk(req.headers['x-music-secret'], want)) {
      res.status(401).json({ message: 'Not allowed' })
      return
    }

    const { room, channelId } = (req.body ?? {}) as { room?: unknown; channelId?: unknown }
    if (typeof room !== 'string' || typeof channelId !== 'string' || !room || !channelId) {
      res.status(400).json({ message: 'room and channelId are required' })
      return
    }

    musicTrackEnded(room, channelId)
    res.json({ ok: true })
  })

  return router
}

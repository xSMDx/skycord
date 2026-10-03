/**
 * What the API and the music service say to each other out of band.
 *
 * Two things. The service reports that a track finished, because only the
 * service is decoding it and only the API owns the queue. And the service
 * reads a library track's audio, because the audio is in GridFS and the
 * service deliberately has no database credentials.
 *
 * That second one is why a library track never travels as a URL the member
 * supplied. The client names a track id, the API checks who owns it and
 * hands the service an address the API itself composed. Nothing a member
 * typed reaches the fetcher on this path at all.
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
import { Types } from 'mongoose'
import { config } from '../config/env'
import { musicTrackEnded } from '../sockets/chatSocket'
import { Track } from '../models/Track'
import { trackStore } from '../utils/trackStore'

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

  /**
   * Stream a library track to the service so it can decode it.
   *
   * No range support and no caching, unlike the member-facing route: the
   * consumer is ffmpeg reading start to finish exactly once.
   *
   * Deliberately not scoped to an owner. The API has already checked that
   * the member asking for this channel owns the track; by the time the
   * service calls back it is acting for the room, and the id it was given
   * came from the API rather than from anyone's browser.
   */
  router.get('/music/track/:trackId/audio', (req: Request, res: Response) => {
    void (async () => {
      const want = opts.secret ?? config.music?.secret ?? ''
      if (!want || !secretOk(req.headers['x-music-secret'], want)) {
        res.status(401).json({ message: 'Not allowed' })
        return
      }

      const id = String(req.params.trackId)
      if (!Types.ObjectId.isValid(id)) { res.status(404).json({ message: 'No such track' }); return }

      const doc = await Track.findById(id)
      if (!doc) { res.status(404).json({ message: 'No such track' }); return }

      res.status(200).set({
        'content-type': 'audio/webm',
        'content-length': String(doc.bytes),
      })
      trackStore.open(doc.store as { kind: 'gridfs'; id: Types.ObjectId }).pipe(res)
    })().catch(() => { if (!res.headersSent) res.status(500).json({ message: 'Could not read that track' }) })
  })

  return router
}

/**
 * A member's own music: tracks they own, playlists they arranged.
 *
 * Everything here is scoped to the caller. There is no "browse someone
 * else's library" endpoint and no sharing flag, because sharing music in
 * this app means playing it into a music channel — which shares the sound,
 * not the file. Keeping that distinction in the data layer rather than only
 * in the UI is what stops it eroding later.
 *
 * The audio itself never passes through this process in one piece. Uploads
 * stream to the music service, the normalised result streams back into
 * GridFS, and playback streams out — see server/utils/trackStore.ts.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { Types } from 'mongoose'
import { Readable } from 'stream'
import { Track } from '../models/Track'
import { Playlist } from '../models/Playlist'
import { trackStore } from '../utils/trackStore'
import {
  libraryCapsFromEnv, canStoreTrack, canCreatePlaylist, canAddToPlaylist,
  checkPlaylistName, checkUrlShape,
} from '../utils/musicLimits'
import {
  musicConfigured, musicIngestUpload, musicIngestLink, musicCollect, musicDropIngest,
  type IngestAnswer,
} from '../utils/musicService'

const caps = () => libraryCapsFromEnv()

/**
 * The caller's id.
 *
 * `req.user.sub`, which is what verifyAccessToken puts there and what every
 * other controller reads. This asked for `req.userId` at first, which does
 * not exist — so `new Types.ObjectId(String(undefined))` threw, and because
 * Express 4 does not catch a rejected promise the request simply never
 * answered. Every route in this file hung, not only the one with the bug.
 */
const me = (req: Request): Types.ObjectId => new Types.ObjectId(req.user!.sub)

/**
 * Send a thrown handler to the error middleware instead of nowhere.
 *
 * The rest of the codebase does this with try/catch and `next(err)` in each
 * handler. There are a dozen here and one of them having been forgotten is
 * exactly the failure above — a hang with no log line and no response, which
 * is the worst thing a server can do with a bug.
 */
const wrap = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => { void fn(req, res).catch(next) }

/** Errors are `{ message }` here, as everywhere else in this API. */
const bad = (res: Response, reason: string, status = 400): void => { res.status(status).json({ message: reason }) }

/** The shape the client renders. `store` and owner never leave the server. */
const card = (t: InstanceType<typeof Track>) => ({
  id:          String(t._id),
  title:       t.title,
  artist:      t.artist,
  album:       t.album,
  durationSec: t.durationSec,
  bytes:       t.bytes,
  cover:       t.coverWebp ?? null,
  source:      t.source,
  scan:        t.scan,
  createdAt:   t.createdAt,
})

// ── tracks ──────────────────────────────────────────────────────────────────

export const listTracks = wrap(async (req: Request, res: Response): Promise<void> => {
  const owner = me(req)
  const q = String(req.query.q ?? '').trim()

  // $text for a real query, nothing for the whole library. Deliberately not
  // a regex: a leading-wildcard regex cannot use an index, and this is the
  // list that grows to 500 rows per member.
  const where = q
    ? { ownerId: owner, $text: { $search: q } }
    : { ownerId: owner }

  const tracks = await Track.find(where).sort({ createdAt: -1 }).limit(1000)
  const used = await usage(owner)
  res.json({ tracks: tracks.map(card), usage: used, caps: caps() })
})

const usage = async (owner: Types.ObjectId): Promise<{ tracks: number; bytes: number }> => {
  const [agg] = await Track.aggregate<{ tracks: number; bytes: number }>([
    { $match: { ownerId: owner } },
    { $group: { _id: null, tracks: { $sum: 1 }, bytes: { $sum: '$bytes' } } },
  ])
  return { tracks: agg?.tracks ?? 0, bytes: agg?.bytes ?? 0 }
}

/**
 * Both ways in finish the same way: the service holds a normalised file, we
 * pull it into GridFS and write the document. Factored out because the only
 * difference between an upload and an import is how the service got hold of
 * the bytes, and that difference ends at this point.
 */
const finishIngest = async (
  res: Response,
  owner: Types.ObjectId,
  answer: IngestAnswer,
  source: 'upload' | 'link',
  sourceUrl?: string,
): Promise<void> => {
  if (!answer.ok) { bad(res, answer.reason, 422); return }

  // The real size is only known now, after transcoding — the first cap check
  // happened before ingest with nothing to measure. See canStoreTrack.
  const used = await usage(owner)
  const room = canStoreTrack(used, answer.track.bytes, caps())
  if (!room.ok) {
    await musicDropIngest(answer.id)
    bad(res, room.reason, 409)
    return
  }

  const body = await musicCollect(answer.id)
  if (!body) { bad(res, 'That file could not be saved. Try again.', 502); return }

  let stored
  try {
    stored = await trackStore.put(Readable.fromWeb(body as never), {
      ownerId: owner,
      mimeType: answer.track.mimeType,
    })
  } catch {
    await musicDropIngest(answer.id)
    bad(res, 'That file could not be saved. Try again.', 502)
    return
  }

  try {
    const doc = await Track.create({
      ownerId: owner,
      title:  answer.track.title,
      artist: answer.track.artist,
      album:  answer.track.album,
      durationSec: answer.track.durationSec,
      bytes:  stored.bytes,
      coverWebp: answer.track.coverWebp,
      store: stored.ref,
      source,
      sourceUrl,
      scan: answer.track.scan,
    })
    res.status(201).json({ track: card(doc) })
  } catch (err) {
    // The bytes are already in GridFS. Leaving them there on a failed write
    // is an orphan nobody will ever find, so the blob goes with the document.
    await trackStore.remove(stored.ref).catch(() => {})
    throw err
  }
}

export const uploadTrack = wrap(async (req: Request, res: Response): Promise<void> => {
  if (!musicConfigured()) { bad(res, 'Music is not available on this server.', 503); return }
  const owner = me(req)

  // Cheap refusal before a minutes-long transcode: a member already at the
  // track ceiling cannot store this whatever it turns out to weigh.
  const first = canStoreTrack(await usage(owner), 0, caps())
  if (!first.ok) { bad(res, first.reason, 409); return }

  const answer = await musicIngestUpload(req, String(req.headers['content-type'] ?? ''))
  await finishIngest(res, owner, answer, 'upload')
})

export const importTrack = wrap(async (req: Request, res: Response): Promise<void> => {
  if (!musicConfigured()) { bad(res, 'Music is not available on this server.', 503); return }
  const owner = me(req)

  const link = String((req.body as { url?: string })?.url ?? '')
  // The cheap text pass. The real check is on the resolved address, in the
  // service, behind a firewall — see music/src/urlGuard.ts.
  const shape = checkUrlShape(link)
  if (!shape.ok) { bad(res, shape.reason); return }

  const first = canStoreTrack(await usage(owner), 0, caps())
  if (!first.ok) { bad(res, first.reason, 409); return }

  const answer = await musicIngestLink(link)
  await finishIngest(res, owner, answer, 'link', link)
})

export const deleteTrack = wrap(async (req: Request, res: Response): Promise<void> => {
  const owner = me(req)
  const id = String(req.params.trackId)
  if (!Types.ObjectId.isValid(id)) { bad(res, 'No such track.', 404); return }

  const doc = await Track.findOneAndDelete({ _id: id, ownerId: owner })
  if (!doc) { bad(res, 'No such track.', 404); return }

  // Playlists keep stale ids rather than being rewritten here: a member with
  // fifty playlists should not wait on fifty updates to delete one track,
  // and readers already drop entries that no longer resolve.
  await trackStore.remove(doc.store as { kind: 'gridfs'; id: Types.ObjectId }).catch(() => {})
  res.json({ ok: true })
})

/**
 * Stream a track for local playback.
 *
 * Range support is not a nicety here: without it an `<audio>` element cannot
 * seek, and a seek bar that does nothing is the first thing anyone notices.
 */
export const streamTrack = wrap(async (req: Request, res: Response): Promise<void> => {
  const owner = me(req)
  const id = String(req.params.trackId)
  if (!Types.ObjectId.isValid(id)) { bad(res, 'No such track.', 404); return }

  const doc = await Track.findOne({ _id: id, ownerId: owner })
  if (!doc) { bad(res, 'No such track.', 404); return }

  const total = doc.bytes
  const ref = doc.store as { kind: 'gridfs'; id: Types.ObjectId }
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))

  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1
    if (!Number.isFinite(start) || start >= total || end < start) {
      res.status(416).set('content-range', `bytes */${total}`).end()
      return
    }
    res.status(206).set({
      'content-type': 'audio/webm',
      'content-range': `bytes ${start}-${end}/${total}`,
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      'cache-control': 'private, max-age=3600',
    })
    trackStore.open(ref, { start, end }).pipe(res)
    return
  }

  res.status(200).set({
    'content-type': 'audio/webm',
    'content-length': String(total),
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  })
  trackStore.open(ref).pipe(res)
})

// ── playlists ───────────────────────────────────────────────────────────────

const playlistCard = (
  p: InstanceType<typeof Playlist>,
  tracks?: Array<ReturnType<typeof card>>,
) => ({
  id:          String(p._id),
  name:        p.name,
  description: p.description,
  trackIds:    p.trackIds.map(String),
  count:       tracks ? tracks.length : p.trackIds.length,
  ...(tracks ? { tracks } : {}),
  updatedAt:   p.updatedAt,
})

export const listPlaylists = wrap(async (req: Request, res: Response): Promise<void> => {
  const lists = await Playlist.find({ ownerId: me(req) }).sort({ updatedAt: -1 })
  res.json({ playlists: lists.map(p => playlistCard(p)) })
})

export const getPlaylist = wrap(async (req: Request, res: Response): Promise<void> => {
  const owner = me(req)
  const id = String(req.params.playlistId)
  if (!Types.ObjectId.isValid(id)) { bad(res, 'No such playlist.', 404); return }

  const list = await Playlist.findOne({ _id: id, ownerId: owner })
  if (!list) { bad(res, 'No such playlist.', 404); return }

  // Resolved in the stored order, and entries whose track is gone simply
  // fall out — see the note on deleteTrack.
  const found = await Track.find({ _id: { $in: list.trackIds }, ownerId: owner })
  const byId = new Map(found.map(t => [String(t._id), t]))
  const tracks = list.trackIds.map(String).map(tid => byId.get(tid)).filter(Boolean).map(t => card(t!))

  res.json({ playlist: playlistCard(list, tracks) })
})

export const createPlaylist = wrap(async (req: Request, res: Response): Promise<void> => {
  const owner = me(req)
  const body = req.body as { name?: string; description?: string }

  const named = checkPlaylistName(body?.name)
  if (!named.ok) { bad(res, named.reason); return }

  const room = canCreatePlaylist(await Playlist.countDocuments({ ownerId: owner }), caps())
  if (!room.ok) { bad(res, room.reason, 409); return }

  const list = await Playlist.create({
    ownerId: owner,
    name: String(body.name).trim(),
    description: String(body?.description ?? '').trim().slice(0, 300),
  })
  res.status(201).json({ playlist: playlistCard(list) })
})

export const renamePlaylist = wrap(async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.playlistId)
  if (!Types.ObjectId.isValid(id)) { bad(res, 'No such playlist.', 404); return }

  const body = req.body as { name?: string; description?: string }
  const named = checkPlaylistName(body?.name)
  if (!named.ok) { bad(res, named.reason); return }

  const list = await Playlist.findOneAndUpdate(
    { _id: id, ownerId: me(req) },
    { name: String(body.name).trim(), description: String(body?.description ?? '').trim().slice(0, 300) },
    { new: true },
  )
  if (!list) { bad(res, 'No such playlist.', 404); return }
  res.json({ playlist: playlistCard(list) })
})

export const deletePlaylist = wrap(async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.playlistId)
  if (!Types.ObjectId.isValid(id)) { bad(res, 'No such playlist.', 404); return }
  const gone = await Playlist.findOneAndDelete({ _id: id, ownerId: me(req) })
  if (!gone) { bad(res, 'No such playlist.', 404); return }
  // Only the arrangement is deleted. The tracks are the member's own and
  // outlive any list that mentioned them.
  res.json({ ok: true })
})

export const addToPlaylist = wrap(async (req: Request, res: Response): Promise<void> => {
  const owner = me(req)
  const id = String(req.params.playlistId)
  const trackId = String((req.body as { trackId?: string })?.trackId ?? '')
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(trackId)) { bad(res, 'No such track.', 404); return }

  const list = await Playlist.findOne({ _id: id, ownerId: owner })
  if (!list) { bad(res, 'No such playlist.', 404); return }

  // Owned by the caller, or a member could add a track id they guessed and
  // read its title back out of the playlist view.
  const owns = await Track.exists({ _id: trackId, ownerId: owner })
  if (!owns) { bad(res, 'No such track.', 404); return }

  const room = canAddToPlaylist(list.trackIds.length, caps())
  if (!room.ok) { bad(res, room.reason, 409); return }

  // Duplicates are allowed on purpose — a playlist is a sequence, and the
  // same track twice in one is a thing people do deliberately.
  list.trackIds.push(new Types.ObjectId(trackId))
  await list.save()
  res.json({ playlist: playlistCard(list) })
})

export const removeFromPlaylist = wrap(async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.playlistId)
  if (!Types.ObjectId.isValid(id)) { bad(res, 'No such playlist.', 404); return }

  const list = await Playlist.findOne({ _id: id, ownerId: me(req) })
  if (!list) { bad(res, 'No such playlist.', 404); return }

  // By position, not by id: duplicates are allowed, so removing "that track"
  // has to mean the one the member clicked rather than the first match.
  const at = Number(req.params.index)
  if (!Number.isInteger(at) || at < 0 || at >= list.trackIds.length) { bad(res, 'No such entry.', 404); return }

  list.trackIds.splice(at, 1)
  await list.save()
  res.json({ playlist: playlistCard(list) })
})

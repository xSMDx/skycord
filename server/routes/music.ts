import { Router, raw } from 'express'
import { requireAuth } from '../middleware/auth'
import { uploadLimit } from '../middleware/rateLimit'
import {
  listTracks, uploadTrack, importTrack, deleteTrack, streamTrack,
  listPlaylists, getPlaylist, createPlaylist, renamePlaylist, deletePlaylist,
  addToPlaylist, removeFromPlaylist,
} from '../controllers/musicLibraryController'

const router = Router()

router.use(requireAuth)

// ── tracks ──────────────────────────────────────────────────────────────────
router.get('/tracks', listTracks)

/**
 * The body is piped straight to the music service, so no body parser may
 * touch it first — express.json() further up the stack would consume the
 * stream and hand the controller an empty request. `raw` with a type that
 * matches nothing is the way to say "leave this alone": the route still
 * runs, and req is still the untouched stream.
 */
router.post('/tracks/upload', uploadLimit, raw({ type: () => false }), uploadTrack)

// Importing is the same work with a different source of bytes, and the same
// cost to the server, so it shares the upload limiter rather than the
// general one.
router.post('/tracks/import', uploadLimit, importTrack)

router.get('/tracks/:trackId/audio', streamTrack)
router.delete('/tracks/:trackId', deleteTrack)

// ── playlists ───────────────────────────────────────────────────────────────
router.get('/playlists', listPlaylists)
router.post('/playlists', createPlaylist)
router.get('/playlists/:playlistId', getPlaylist)
router.patch('/playlists/:playlistId', renamePlaylist)
router.delete('/playlists/:playlistId', deletePlaylist)
router.post('/playlists/:playlistId/tracks', addToPlaylist)
router.delete('/playlists/:playlistId/tracks/:index', removeFromPlaylist)

export default router

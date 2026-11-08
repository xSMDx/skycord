/**
 * /messages/attachments — mounted in app.ts ahead of the global apiLimit and
 * ahead of /messages itself.
 *
 * Under /messages on purpose: that prefix is already in the reverse proxy's
 * list and the Vite dev proxy, so no deployment needs a new route to reach
 * this. Ahead of apiLimit because a channel full of photos is one request
 * per photo, and they would otherwise spend the API budget meant for
 * everything else; serving has its own, larger limiter instead.
 */
import { Router, raw } from 'express'
import { requireAuth } from '../middleware/auth'
import { attachmentReadLimit, attachmentUploadLimit } from '../middleware/rateLimit'
import { uploadAttachment, serveAttachment, deleteAttachment } from '../controllers/attachmentsController'

const router = Router()

// Public: an <img> or <video> cannot send the Bearer token.
router.get('/:key/:name', attachmentReadLimit, serveAttachment)

router.use(requireAuth)
// `raw` with a type that never matches leaves the body unread, so the
// controller can count it as it streams (the music upload does the same).
router.post('/', attachmentUploadLimit, raw({ type: () => false }), uploadAttachment)
router.delete('/:key', deleteAttachment)

export default router

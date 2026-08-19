import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { writeLimit } from '../middleware/rateLimit'
import { joinViaInvite, previewInvite } from '../controllers/invitesController'

const router = Router()
router.use(requireAuth)

// A preview is a read — no limiter beyond the apiLimit backstop already
// applied elsewhere. Mounted above the POST below so the two stay easy to
// tell apart on the page, though method alone is enough for Express to
// route them correctly.
router.get('/:code', previewInvite)

// A join mutates server membership (and the invite's use count) and is
// reachable by any authenticated user who can guess or scrape a code —
// same class of write as createServer/createChannel, so it gets the same
// writeLimit rather than going unlimited or getting a bespoke tighter cap.
router.post('/:code', writeLimit, joinViaInvite)

export default router

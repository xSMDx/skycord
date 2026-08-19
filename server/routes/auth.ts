import { Router } from 'express'
import { register, login, refresh, logout, me } from '../controllers/authController'
import { requireAuth } from '../middleware/auth'
import { make } from '../middleware/rateLimit'

const router = Router()

// Routed through the shared make() factory (carries the VITEST skip) rather
// than building rateLimit() inline, so a limiter added here later can't
// forget it. Windows, maxes and messages are unchanged from before.
// make() keys by req.user?.sub || req.ip; these routes run before
// requireAuth, so req.user is always unset here and this reduces to the
// same req.ip keying express-rate-limit's own default used previously.
const strictLimit = make(15 * 60 * 1000, 10, 'Too many attempts — please wait 15 minutes')
const refreshLimit = make(15 * 60 * 1000, 60, 'Too many refresh requests')

router.post('/register', strictLimit,  register)
router.post('/login',    strictLimit,  login)
router.post('/refresh',  refreshLimit, refresh)
router.post('/logout',               logout)
router.get( '/me',       requireAuth,  me)

export default router

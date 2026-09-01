import { Router } from 'express'
import {
  register, login, refresh, logout, me,
  forgotPassword, resetPassword, resetAvailability,
} from '../controllers/authController'
import { listSessions, revokeOne, revokeAllOthers } from '../controllers/sessionsController'
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

// Both behind strictLimit, and for different reasons. Requesting a link is a
// way to make this server send mail to an address of the caller's choosing, so
// it is a spam lever as much as an account one. Redeeming is a guessing surface
// -- 256-bit tokens make that hopeless, but a limit costs nothing and means a
// mistake in the token check is not also an unlimited oracle.
router.post('/forgot-password', strictLimit, forgotPassword)
router.post('/reset-password',  strictLimit, resetPassword)
// Unlimited: a boolean about this deployment, read once when the login page
// renders, revealing nothing about any account.
router.get( '/reset-available', resetAvailability)
router.get( '/me',       requireAuth,  me)

// Logged-in devices. Reading is cheap and the page polls nothing, so it rides
// the shared limiter; revoking is a write and gets the same treatment as the
// other credential routes — it is the button an attacker would reach for to
// push a real owner out of their own account.
router.get(   '/sessions',     requireAuth, listSessions)
router.delete('/sessions/:id', requireAuth, strictLimit, revokeOne)
router.delete('/sessions',     requireAuth, strictLimit, revokeAllOthers)

export default router

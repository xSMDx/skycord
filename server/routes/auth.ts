import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { register, login, refresh, logout, me } from '../controllers/authController'
import { requireAuth } from '../middleware/auth'

const router = Router()

const strictLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts — please wait 15 minutes', code: 'RATE_LIMITED' },
  // VITEST (not NODE_ENV) — prod runs with NODE_ENV=development, so NODE_ENV
  // would disable this limiter live. VITEST is only ever set by the test runner.
  skip: () => !!process.env.VITEST,
})

const refreshLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many refresh requests', code: 'RATE_LIMITED' },
  // VITEST (not NODE_ENV) — prod runs with NODE_ENV=development, so NODE_ENV
  // would disable this limiter live. VITEST is only ever set by the test runner.
  skip: () => !!process.env.VITEST,
})

router.post('/register', strictLimit,  register)
router.post('/login',    strictLimit,  login)
router.post('/refresh',  refreshLimit, refresh)
router.post('/logout',               logout)
router.get( '/me',       requireAuth,  me)

export default router

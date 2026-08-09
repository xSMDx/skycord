import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { searchGifs, trendingGifs } from '../controllers/gifsController'
import { gifLimit } from '../middleware/rateLimit'

const router = Router()

// Authenticated: this is a proxy holding OUR api key, so it must not be an
// open endpoint anyone on the internet can burn the quota through.
router.use(requireAuth)

// Each call spends a KLIPY request — quota protection as much as abuse control.
router.get('/search',   gifLimit, searchGifs)
router.get('/trending', gifLimit, trendingGifs)

export default router

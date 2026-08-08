import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { searchGifs, trendingGifs } from '../controllers/gifsController'

const router = Router()

// Authenticated: this is a proxy holding OUR api key, so it must not be an
// open endpoint anyone on the internet can burn the quota through.
router.use(requireAuth)

router.get('/search',   searchGifs)
router.get('/trending', trendingGifs)

export default router

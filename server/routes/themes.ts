import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { createTheme, getTheme } from '../controllers/themesController'

const router = Router()
router.use(requireAuth)

router.post('/',      createTheme)
router.get('/:slug',  getTheme)

export default router

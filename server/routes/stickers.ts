import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { uploadLimit } from '../middleware/rateLimit'
import {
  createSticker, getStickers, toggleStarSticker, deleteSticker
} from '../controllers/stickersController'

const router = Router()

router.use(requireAuth)

router.get('/',                   getStickers)
// Base64 image bodies.
router.post('/',      uploadLimit, createSticker)
router.patch('/:stickerId/star',  toggleStarSticker)
router.delete('/:stickerId',      deleteSticker)

export default router
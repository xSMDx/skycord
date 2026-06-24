import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  createSticker, getStickers, toggleStarSticker, deleteSticker
} from '../controllers/stickersController'

const router = Router()

router.use(requireAuth)

router.get('/',                   getStickers)
router.post('/',                  createSticker)
router.patch('/:stickerId/star',  toggleStarSticker)
router.delete('/:stickerId',      deleteSticker)

export default router
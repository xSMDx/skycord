import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { getVoiceToken } from '../controllers/voiceController'

const router = Router()
router.use(requireAuth)

router.post('/token', getVoiceToken)

export default router

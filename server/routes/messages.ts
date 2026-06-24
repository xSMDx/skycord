import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { getDMMessages, sendDMMessage, deleteMessage, editMessageContent } from '../controllers/messagesController'

const router = Router()

router.use(requireAuth)

router.get('/dm/:partnerId',    getDMMessages)
router.post('/dm/:partnerId',   sendDMMessage)
router.delete('/:messageId',    deleteMessage)
router.patch('/:messageId',     editMessageContent)

export default router

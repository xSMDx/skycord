import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { getVoiceToken, moveVoiceCall } from '../controllers/voiceController'
import { listMyVoiceServers } from '../controllers/voiceServersController'

const router = Router()
router.use(requireAuth)

router.post('/token', getVoiceToken)
// Across every server the caller is in — the per-server list lives under
// /servers/:sid/voice-servers and is scoped to one community.
router.get('/servers', listMyVoiceServers)
// DM and group calls only — a voice channel's server is a channel setting.
router.post('/move', moveVoiceCall)

export default router

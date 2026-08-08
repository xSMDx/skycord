import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  createGroup, getMyConversations, getGroupMessages, sendGroupMessage, getGroupMembers,
  addGroupMembers, updateGroup, leaveGroup, createGroupInvite, getInvite, joinViaInvite,
  getMyDMs,
} from '../controllers/conversationsController'

const router = Router()
router.use(requireAuth)

router.get('/dms',                     getMyDMs)

router.post('/groups',                 createGroup)
router.get('/groups',                  getMyConversations)
router.patch('/groups/:groupId',        updateGroup)
router.get('/groups/:groupId/messages',  getGroupMessages)
router.post('/groups/:groupId/messages', sendGroupMessage)
router.get('/groups/:groupId/members',   getGroupMembers)
router.post('/groups/:groupId/members', addGroupMembers)
router.post('/groups/:groupId/leave',   leaveGroup)
router.post('/groups/:groupId/invites', createGroupInvite)

// Invite code lookup + join — code is in the path, not tied to a known group
router.get('/invites/:code',  getInvite)
router.post('/invites/:code', joinViaInvite)

export default router
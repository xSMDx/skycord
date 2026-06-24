import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  searchUsers, sendFriendRequest, acceptFriendRequest,
  getFriends, getPendingRequests, updateProfile,
  changeUsername, changeEmail, changePassword
} from '../controllers/usersController'

const router = Router()

// All routes require auth
router.use(requireAuth)

router.get('/search',                    searchUsers)
router.get('/friends',                   getFriends)
router.get('/friends/pending',           getPendingRequests)
router.post('/friends/request',          sendFriendRequest)
router.patch('/friends/accept/:requestId', acceptFriendRequest)
router.patch('/me',                      updateProfile)
router.patch('/me/username',             changeUsername)
router.patch('/me/email',                changeEmail)
router.patch('/me/password',             changePassword)

export default router
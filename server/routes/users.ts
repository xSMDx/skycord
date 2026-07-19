import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  searchUsers, sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  removeFriend, getFriends, getPendingRequests, updateProfile,
  changeUsername, changeEmail, changePassword,
  getConvPrefs, setConvPref
} from '../controllers/usersController'

const router = Router()

// All routes require auth
router.use(requireAuth)

router.get('/search',                    searchUsers)
router.get('/friends',                   getFriends)
router.get('/friends/pending',           getPendingRequests)
router.post('/friends/request',          sendFriendRequest)
router.patch('/friends/accept/:requestId',  acceptFriendRequest)
router.patch('/friends/decline/:requestId', declineFriendRequest)
router.delete('/friends/:userId',           removeFriend)
router.patch('/me',                      updateProfile)
router.patch('/me/username',             changeUsername)
router.patch('/me/email',                changeEmail)
router.patch('/me/password',             changePassword)
// Per-conversation pin/mute. One route for both — they're the same write.
router.get('/me/conversations',           getConvPrefs)
router.patch('/me/conversations/:convId', setConvPref)

export default router
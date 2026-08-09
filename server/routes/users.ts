import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { searchLimit, uploadLimit, writeLimit } from '../middleware/rateLimit'
import {
  searchUsers, sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  removeFriend, getFriends, getPendingRequests, updateProfile,
  changeUsername, changeEmail, changePassword,
  getConvPrefs, setConvPref, getUserProfile
} from '../controllers/usersController'

const router = Router()

// All routes require auth
router.use(requireAuth)

router.get('/search',        searchLimit, searchUsers)
router.get('/friends',                   getFriends)
router.get('/friends/pending',           getPendingRequests)
router.post('/friends/request',   writeLimit, sendFriendRequest)
router.patch('/friends/accept/:requestId',  acceptFriendRequest)
router.patch('/friends/decline/:requestId', declineFriendRequest)
router.delete('/friends/:userId',           removeFriend)
// Credential changes get the same treatment as login — they're the routes worth
// brute-forcing, and changePassword verifies the current password.
router.patch('/me',           uploadLimit, updateProfile)
router.patch('/me/username',  writeLimit,  changeUsername)
router.patch('/me/email',     writeLimit,  changeEmail)
router.patch('/me/password',  writeLimit,  changePassword)
// Per-conversation pin/mute. One route for both — they're the same write.
router.get('/me/conversations',           getConvPrefs)
router.patch('/me/conversations/:convId', setConvPref)
// LAST: '/me/...' above would otherwise be swallowed by ':userId'.
router.get('/:userId/profile',            getUserProfile)

export default router
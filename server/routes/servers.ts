import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { uploadLimit, writeLimit } from '../middleware/rateLimit'
import {
  createServer, getMyServers, getServer, updateServer, deleteServer,
  getServerMembers, removeMember,
} from '../controllers/serversController'
import {
  createChannel, updateChannel, deleteChannel, getChannelMessages, sendChannelMessage,
} from '../controllers/channelsController'
import { createInvite, listInvites, revokeInvite } from '../controllers/invitesController'

const router = Router()
router.use(requireAuth)

router.post('/',                       writeLimit,  createServer)
router.get('/',                        getMyServers)
router.get('/:sid',                    getServer)
router.patch('/:sid',                  uploadLimit, updateServer)
router.delete('/:sid',                 deleteServer)
router.get('/:sid/members',            getServerMembers)
router.delete('/:sid/members/:uid',    removeMember)

// Channel writes create/rename records, same class as the server/friend writes
// above — DELETE stays unlimited to match deleteServer/removeMember/removeFriend.
router.post('/:sid/channels',          writeLimit,  createChannel)
router.patch('/:sid/channels/:cid',    writeLimit,  updateChannel)
router.delete('/:sid/channels/:cid',   deleteChannel)

router.get('/:sid/channels/:cid/messages',              getChannelMessages)
router.post('/:sid/channels/:cid/messages', writeLimit, sendChannelMessage)

// Minting an invite is a create, same class as above — writeLimit. Listing is
// a plain scoped read. Revoking follows the DELETE-stays-unlimited convention.
router.post('/:sid/invites',           writeLimit,  createInvite)
router.get('/:sid/invites',            listInvites)
router.delete('/:sid/invites/:code',   revokeInvite)

export default router

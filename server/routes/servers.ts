import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { uploadLimit, writeLimit } from '../middleware/rateLimit'
import {
  createServer, getMyServers, getServer, updateServer, deleteServer,
  getDiscoverServers, joinPublicServer,
  getServerMembers, removeMember,
} from '../controllers/serversController'
import {
  createChannel, updateChannel, deleteChannel, getChannelMessages, sendChannelMessage,
} from '../controllers/channelsController'
import {
  createCategory, updateCategory, deleteCategory,
} from '../controllers/categoriesController'
import { createInvite, listInvites, revokeInvite } from '../controllers/invitesController'
import {
  listRoles, createRole, updateRole, deleteRole, setMemberRoles,
} from '../controllers/rolesController'
import {
  listVoiceServers, createVoiceServer, updateVoiceServer, deleteVoiceServer,
} from '../controllers/voiceServersController'

const router = Router()
router.use(requireAuth)

router.post('/',                       writeLimit,  createServer)
router.get('/',                        getMyServers)

// BEFORE '/:sid'. Express matches in declaration order, so a literal path
// registered after a parameterised one at the same depth is unreachable —
// '/discover' would arrive as sid='discover' and 404 as an invalid ObjectId.
router.get('/discover',                getDiscoverServers)
router.post('/:sid/join',              writeLimit,  joinPublicServer)

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

// Same class of write as the channel routes above, and the same convention:
// create/rename are writeLimit'd, DELETE stays unlimited. There is no
// GET /:sid/categories — getServer already returns them alongside channels,
// and a second endpoint would be a second source of truth for the sidebar.
router.post('/:sid/categories',        writeLimit,  createCategory)
router.patch('/:sid/categories/:cid',  writeLimit,  updateCategory)
router.delete('/:sid/categories/:cid',              deleteCategory)

// Roles. Unlike the routes above these are not owner-gated — the controller
// authorises on ManageRoles plus role position, which is the first thing in
// this codebase to use the permission model rather than an ownership check.
router.get('/:sid/roles',                           listRoles)
router.post('/:sid/roles',            writeLimit,   createRole)
router.patch('/:sid/roles/:rid',      writeLimit,   updateRole)
router.delete('/:sid/roles/:rid',                   deleteRole)
// PUT, not PATCH: the body is the member's complete role set, so sending it
// twice lands the same state. A PATCH would imply a delta and invite races
// between two moderators editing the same member.
router.put('/:sid/members/:uid/roles', writeLimit,  setMemberRoles)

router.get('/:sid/channels/:cid/messages',              getChannelMessages)
router.post('/:sid/channels/:cid/messages', writeLimit, sendChannelMessage)

// Minting an invite is a create, same class as above — writeLimit. Listing is
// a plain scoped read. Revoking follows the DELETE-stays-unlimited convention.
// Voice servers a server owner registers. List is member-readable (the channel
// dialog and call UI both name a server); the rest are owner-only, enforced in
// the controller. No secret is ever in a response.
router.get('/:sid/voice-servers',              listVoiceServers)
router.post('/:sid/voice-servers',        writeLimit, createVoiceServer)
router.patch('/:sid/voice-servers/:vid',  writeLimit, updateVoiceServer)
router.delete('/:sid/voice-servers/:vid',             deleteVoiceServer)

router.post('/:sid/invites',           writeLimit,  createInvite)
router.get('/:sid/invites',            listInvites)
router.delete('/:sid/invites/:code',   revokeInvite)

export default router

import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  createServer, getMyServers, getServer, updateServer, deleteServer,
  getServerMembers, removeMember,
} from '../controllers/serversController'

const router = Router()
router.use(requireAuth)

router.post('/',                       createServer)
router.get('/',                        getMyServers)
router.get('/:sid',                    getServer)
router.patch('/:sid',                  updateServer)
router.delete('/:sid',                 deleteServer)
router.get('/:sid/members',            getServerMembers)
router.delete('/:sid/members/:uid',    removeMember)

export default router

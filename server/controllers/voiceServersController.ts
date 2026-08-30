/**
 * A server owner's own LiveKit servers.
 *
 * Owner-only throughout, and the secret is write-only: it goes in encrypted and
 * never comes back out, not even to the person who typed it. A `secretHint`
 * (last four characters) is stored so the settings list can show WHICH secret
 * without showing it — the same reason a password field shows dots and a card
 * shows four digits.
 */
import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { VoiceServer, MAX_VOICE_SERVERS } from '../models/VoiceServer'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner } from './serversController'
import { seal, hint } from '../utils/secretBox'

/** Never includes apiSecret. The field is `select: false` as a second line of
 *  defence, but the shape is the first. */
const shape = (v: any) => ({
  id:         v._id.toString(),
  name:       v.name,
  url:        v.url,
  apiKey:     v.apiKey,
  secretHint: v.secretHint ?? '••••',
  isDefault:  !!v.isDefault,
})

/**
 * A signalling URL the browser can actually reach.
 *
 * `ws://` is allowed only for loopback: a page served over HTTPS cannot open a
 * plaintext websocket to anywhere else, so accepting `ws://example.com` here
 * would store a value that silently fails in every browser. Localhost is the
 * exception because that is how you test with a LiveKit in Docker.
 */
const validUrl = (raw: string): string | null => {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol === 'wss:') return u.toString().replace(/\/$/, '')
  if (u.protocol === 'ws:') {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)
    return local ? u.toString().replace(/\/$/, '') : null
  }
  return null
}

export const listVoiceServers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    // Readable by any member, not just the owner: the channel settings dialog
    // and the call UI both need to name a server, and a member who cannot read
    // the list would see an id. No secret is in this shape.
    const rows = await VoiceServer.find({ server: server._id }).sort({ createdAt: 1 }).lean()
    res.json({ voiceServers: rows.map(shape) })
  } catch (err) { next(err) }
}

export const createVoiceServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const name      = String(req.body?.name ?? '').trim()
    const apiKey    = String(req.body?.apiKey ?? '').trim()
    const apiSecret = String(req.body?.apiSecret ?? '')
    const url       = validUrl(String(req.body?.url ?? '').trim())

    if (!name || name.length > 40) { res.status(400).json({ message: 'Give the server a name' }); return }
    if (!url)       { res.status(400).json({ message: 'URL must be wss://… (ws:// only for localhost)' }); return }
    if (!apiKey)    { res.status(400).json({ message: 'API key is required' }); return }
    if (!apiSecret) { res.status(400).json({ message: 'API secret is required' }); return }

    const count = await VoiceServer.countDocuments({ server: server._id })
    if (count >= MAX_VOICE_SERVERS) {
      res.status(400).json({ message: `That is the limit of ${MAX_VOICE_SERVERS} voice servers` }); return
    }

    // The first one registered becomes the default, because a list of one with
    // nothing marked is a list that changes nothing.
    const isDefault = count === 0 || !!req.body?.isDefault
    if (isDefault) await VoiceServer.updateMany({ server: server._id }, { isDefault: false })

    const created = await VoiceServer.create({
      server: server._id, name, url, apiKey,
      apiSecret: seal(apiSecret), secretHint: hint(apiSecret), isDefault,
    })
    res.status(201).json({ voiceServer: shape(created) })
  } catch (err: any) {
    // The unique index on (server, name), case-insensitive.
    if (err?.code === 11000) { res.status(400).json({ message: 'You already have a voice server with that name' }); return }
    next(err)
  }
}

export const updateVoiceServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const { vid } = req.params
    if (!Types.ObjectId.isValid(vid)) { res.status(404).json({ message: 'Voice server not found' }); return }
    const row = await VoiceServer.findOne({ _id: vid, server: server._id })
    if (!row) { res.status(404).json({ message: 'Voice server not found' }); return }

    if (req.body?.name !== undefined) {
      const n = String(req.body.name).trim()
      if (!n || n.length > 40) { res.status(400).json({ message: 'Give the server a name' }); return }
      row.name = n
    }
    if (req.body?.url !== undefined) {
      const u = validUrl(String(req.body.url).trim())
      if (!u) { res.status(400).json({ message: 'URL must be wss://… (ws:// only for localhost)' }); return }
      row.url = u
    }
    if (req.body?.apiKey !== undefined) {
      const k = String(req.body.apiKey).trim()
      if (!k) { res.status(400).json({ message: 'API key is required' }); return }
      row.apiKey = k
    }
    // Absent means "leave it alone" — the client cannot read the secret back,
    // so it cannot echo it, and an edit that only renames must not wipe it.
    if (req.body?.apiSecret) {
      const s = String(req.body.apiSecret)
      row.apiSecret = seal(s)
      row.secretHint = hint(s)
    }
    if (req.body?.isDefault === true) {
      await VoiceServer.updateMany({ server: server._id, _id: { $ne: row._id } }, { isDefault: false })
      row.isDefault = true
    }

    await row.save()
    res.json({ voiceServer: shape(row) })
  } catch (err: any) {
    if (err?.code === 11000) { res.status(400).json({ message: 'You already have a voice server with that name' }); return }
    next(err)
  }
}

export const deleteVoiceServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const { vid } = req.params
    if (!Types.ObjectId.isValid(vid)) { res.status(404).json({ message: 'Voice server not found' }); return }
    const row = await VoiceServer.findOneAndDelete({ _id: vid, server: server._id })
    if (!row) { res.status(404).json({ message: 'Voice server not found' }); return }

    // Channels pointing here are cleared rather than left dangling. Resolution
    // tolerates a dead id anyway, but a settings dialog showing a server that
    // no longer exists is a bug report waiting to happen.
    await Channel.updateMany({ server: server._id, voiceServer: row._id }, { voiceServer: null })

    // Losing the default promotes the oldest survivor, so a server never ends
    // up with entries but no default — which would silently fall back to the
    // instance while the owner is looking at a list of their own servers.
    if (row.isDefault) {
      const next = await VoiceServer.findOne({ server: server._id }).sort({ createdAt: 1 })
      if (next) { next.isDefault = true; await next.save() }
    }

    res.json({ ok: true })
  } catch (err) { next(err) }
}

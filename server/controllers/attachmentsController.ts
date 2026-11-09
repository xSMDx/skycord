/**
 * Chat attachments, before any message names them: upload, serve, discard.
 *
 * Upload buffers the whole file (at most ATTACH_MAX_BYTES, 25 MB by default)
 * because three things need all of it before it is stored: the size cap,
 * which is counted from the bytes rather than trusted from a header; the
 * type sniff; and the virus scan. Serving is public — an `<img>` cannot carry
 * the sign-in token — and safe because the key is 128 random bits and the
 * headers below keep anything but an image or a video from rendering.
 */
import { randomBytes } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { config } from '../config/env'
import { Attachment } from '../models/Attachment'
import { sniff, cleanFileName, contentDisposition } from '../utils/attachmentSniff'
import { clamConfigFromEnv, scanBuffer } from '../utils/clamav'
import { attachmentStore, toWire } from '../utils/attachmentStore'

const megabytes = (n: number) => Math.round(n / (1024 * 1024))
const tooBig = (res: Response) =>
  res.status(413).json({ message: `That file is over the ${megabytes(config.attachments.maxBytes)} MB limit.` })

const nameFrom = (header: string | undefined): string => {
  const raw = header ?? ''
  try { return cleanFileName(decodeURIComponent(raw)) } catch { return cleanFileName(raw) }
}

/**
 * The body, counted as it arrives. Past the cap it stops keeping bytes but
 * keeps reading: answering mid-upload and closing the socket makes a browser
 * report a network error instead of the 413 it was sent.
 */
const readCapped = (req: Request, max: number): Promise<Buffer | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let over = false
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > max) { over = true; chunks.length = 0; return }
      if (!over) chunks.push(c)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })

export const uploadAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const max = config.attachments.maxBytes
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > max) {
      req.resume()
      tooBig(res)
      return
    }
    const buf = await readCapped(req, max)
    if (!buf) { tooBig(res); return }
    if (buf.length === 0) { res.status(400).json({ message: 'That file is empty.' }); return }

    const found = sniff(buf)
    const name = nameFrom(req.header('x-filename'))

    const clam = clamConfigFromEnv(process.env)
    if (clam) {
      const verdict = await scanBuffer(buf, clam)
      if (verdict.state === 'infected') {
        res.status(422).json({ message: 'The virus scanner flagged this file, so it wasn’t uploaded.' })
        return
      }
      if (verdict.state === 'error') {
        console.error('[attachments] scanner unavailable:', verdict.detail)
        res.status(503).json({ message: 'Can’t check files for viruses right now. Try again in a minute.' })
        return
      }
    }

    const ownerId = req.user!.sub
    const store = await attachmentStore.put(buf, { ownerId, mime: found.mime })
    try {
      const doc = await Attachment.create({
        key: randomBytes(16).toString('base64url'),
        ownerId, name, size: buf.length,
        mime: found.mime, kind: found.kind, width: found.width, height: found.height,
        store,
      })
      res.status(201).json({ attachment: toWire(doc) })
    } catch (err) {
      await attachmentStore.remove(store)
      throw err
    }
  } catch (err) { next(err) }
}

export const serveAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const doc = await Attachment.findOne({ key: String(req.params.key) }).lean()
    if (!doc) { res.status(404).json({ message: 'That file is not here anymore.' }); return }

    const total = doc.size
    res.set({
      'content-type':            doc.mime,
      'content-disposition':     contentDisposition(doc.kind, doc.name),
      'x-content-type-options':  'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control':           'private, max-age=31536000, immutable',
      'accept-ranges':           'bytes',
    })

    // Range is what lets a <video> seek. Same handling as streamTrack.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1
      if (!Number.isFinite(start) || start >= total || end < start) {
        res.status(416).set('content-range', `bytes */${total}`).end()
        return
      }
      res.status(206).set({
        'content-range':  `bytes ${start}-${end}/${total}`,
        'content-length': String(end - start + 1),
      })
      attachmentStore.open(doc.store, { start, end }).on('error', next).pipe(res)
      return
    }

    res.status(200).set('content-length', String(total))
    attachmentStore.open(doc.store).on('error', next).pipe(res)
  } catch (err) { next(err) }
}

/** The composer's ×, for a file uploaded but not sent. A sent file goes when
 *  its message does. Anyone else's key, or a sent one, answers 404 alike. */
export const deleteAttachment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const doc = await Attachment.findOneAndDelete({
      key: String(req.params.key), ownerId: req.user!.sub, messageId: null,
    })
    if (!doc) { res.status(404).json({ message: 'No such file.' }); return }
    await attachmentStore.remove(doc.store)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

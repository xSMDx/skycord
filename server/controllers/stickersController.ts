import { Request, Response, NextFunction } from 'express'
import { validateImageUrl } from '../utils/imageUrl'
import { Sticker } from '../models/Sticker'

// 1MB cap on the raw base64 string (~750KB actual image data after the ~33%
// base64 inflation) — generous enough for a small sticker image, small enough
// that a handful of stickers won't meaningfully threaten Mongo's 16MB document
// ceiling on anything else in the collection.
const MAX_IMAGE_DATA_LENGTH = 1024 * 1024

// ── Create a sticker (text or image) ─────────────────────────────────────────
export const createSticker = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const creatorId = req.user!.sub
    const { name, type, text, image } = req.body

    if (!name?.trim()) { res.status(400).json({ message: 'Name is required' }); return }
    if (type !== 'text' && type !== 'image') {
      res.status(400).json({ message: "Type must be 'text' or 'image'" }); return
    }

    if (type === 'text') {
      if (!text?.content?.trim()) {
        res.status(400).json({ message: 'Text content is required for a text sticker' }); return
      }
    } else {
      if (!image?.data) {
        res.status(400).json({ message: 'Image data is required for an image sticker' }); return
      }
      // Was a length check plus `startsWith('data:image/')`, which admits
      // svg+xml. SVG is inert inside <img>, which is where a sticker will
      // render — but it carries script, and nothing here would flag it the day
      // one is rendered through <object> or inline instead.
      const r = validateImageUrl(image.data, MAX_IMAGE_DATA_LENGTH)
      if (!r.ok) {
        const status = r.reason === 'That image is too large' ? 413 : 400
        res.status(status).json({ message: r.reason }); return
      }
    }

    const sticker = await Sticker.create({
      creatorId,
      name: name.trim().slice(0, 32),
      type,
      ...(type === 'text'
        ? { text: {
            content:    text.content.trim().slice(0, 12),
            color:      text.color || '#ffffff',
            background: text.background || '#5865f2',
            fontWeight: text.fontWeight === 'normal' ? 'normal' : 'bold',
          } }
        : { image: { data: image.data } }),
    })

    res.status(201).json({ sticker })
  } catch (err) { next(err) }
}

// ── List stickers: mine + ones I've starred ──────────────────────────────────
export const getStickers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub

    const [mine, starred] = await Promise.all([
      Sticker.find({ creatorId: userId }).sort({ createdAt: -1 }).lean(),
      Sticker.find({ starredBy: userId }).sort({ createdAt: -1 }).lean(),
    ])

    res.json({ mine, starred })
  } catch (err) { next(err) }
}

// ── Toggle star on a sticker ──────────────────────────────────────────────────
export const toggleStarSticker = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId    = req.user!.sub
    const { stickerId } = req.params

    const sticker = await Sticker.findById(stickerId)
    if (!sticker) { res.status(404).json({ message: 'Sticker not found' }); return }

    const idx = sticker.starredBy.findIndex(id => id.toString() === userId)
    const nowStarred = idx === -1
    if (nowStarred) sticker.starredBy.push(userId as any)
    else            sticker.starredBy.splice(idx, 1)

    await sticker.save()
    res.json({ starred: nowStarred })
  } catch (err) { next(err) }
}

// ── Delete a sticker (creator only) ───────────────────────────────────────────
export const deleteSticker = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { stickerId } = req.params

    const sticker = await Sticker.findById(stickerId)
    if (!sticker) { res.status(404).json({ message: 'Sticker not found' }); return }
    if (sticker.creatorId.toString() !== userId) {
      res.status(403).json({ message: 'Only the creator can delete this sticker' }); return
    }

    await sticker.deleteOne()
    res.json({ message: 'Deleted' })
  } catch (err) { next(err) }
}
import { Request, Response, NextFunction } from 'express'
import { Theme, generateThemeSlug } from '../models/Theme'
import { User } from '../models/User'

// Allowed theme fields — mirrors the client's useAppearance THEME_FIELDS so we
// only ever store known appearance keys, never arbitrary client payload.
const THEME_FIELDS = [
  'theme', 'accent', 'density', 'msgSize', 'groupSpacing', 'fontUi', 'fontMono',
  'showSendButton', 'custom', 'scheme', 'contrast', 'emojiPack',
  'underlineLinks', 'displayNameStyles', 'msgLayout', 'zoom',
]

const sanitize = (obj: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (obj && typeof obj === 'object') {
    for (const k of THEME_FIELDS) if (k in obj) out[k] = obj[k]
  }
  return out
}

// ── Create a shareable theme link ─────────────────────────────────────────────
export const createTheme = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const name = (String(req.body?.name ?? '').slice(0, 60).trim()) || 'Shared Theme'
    const data = sanitize(req.body?.data)
    if (!Object.keys(data).length) { res.status(400).json({ message: 'No theme data provided' }); return }

    const user = await User.findById(userId).select('username displayName').lean()
    const authorName = user?.displayName || user?.username || 'Someone'

    // Generate a slug, retrying on the (astronomically unlikely) collision.
    let slug = generateThemeSlug()
    for (let i = 0; i < 5; i++) {
      if (!(await Theme.exists({ slug }))) break
      slug = generateThemeSlug()
    }

    const theme = await Theme.create({ slug, name, author: userId, authorName, data })
    res.status(201).json({ slug: theme.slug })
  } catch (err) { next(err) }
}

// ── Look up a theme (for the preview banner / in-chat card) ───────────────────
export const getTheme = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params
    const theme = await Theme.findOne({ slug }).lean()
    if (!theme) { res.status(404).json({ message: 'This theme link is invalid' }); return }
    res.json({ slug: theme.slug, name: theme.name, authorName: theme.authorName, data: theme.data })
  } catch (err) { next(err) }
}

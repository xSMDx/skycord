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

/*
 * What each field may hold: what the settings screen itself makes. The app
 * writes these values onto the page as CSS, so a colour is #rrggbb, a number
 * sits in its slider's range, a name is a short plain word, a switch is a
 * boolean, and `custom` holds only the editor's own tokens. A field that is
 * anything else is dropped on its own. The app checks again before applying
 * anything (useAppearance's sanitizeTheme); this keeps what is stored and
 * served clean too, on create and on every read.
 */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i
const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9 -]{0,31}$/
const CUSTOM_KEYS = new Set(['--bg-chat', '--bg-panel', '--bg-floor', '--text-1'])
const isColour = (v: unknown) => typeof v === 'string' && HEX_COLOUR.test(v)
const isName = (v: unknown) => typeof v === 'string' && PLAIN_NAME.test(v)
const isBool = (v: unknown) => typeof v === 'boolean'
const numberIn = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const FIELD_OK: Record<string, (v: unknown) => boolean> = {
  theme: isName, accent: v => v === 'auto' || isColour(v), density: isName,
  msgSize: numberIn(10, 30), groupSpacing: numberIn(0, 48), fontUi: isName, fontMono: isName,
  showSendButton: isBool, scheme: isName, contrast: numberIn(-1, 1), emojiPack: isName,
  underlineLinks: isBool, displayNameStyles: isBool, msgLayout: isName, zoom: numberIn(50, 200),
}
const customColours = (v: unknown): Record<string, string> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, string> = {}
  for (const [k, c] of Object.entries(v)) if (CUSTOM_KEYS.has(k) && isColour(c)) out[k] = c as string
  return out
}

const sanitize = (obj: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (!obj || typeof obj !== 'object') return out
  for (const k of THEME_FIELDS) {
    if (!(k in obj)) continue
    if (k === 'custom') {
      const c = customColours(obj.custom)
      if (c) out.custom = c
    } else if (FIELD_OK[k]?.(obj[k])) {
      out[k] = obj[k]
    }
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
    // Cleaned on the way out as well: a theme saved before the rule above
    // existed is served under it all the same.
    res.json({ slug: theme.slug, name: theme.name, authorName: theme.authorName, data: sanitize(theme.data) })
  } catch (err) { next(err) }
}

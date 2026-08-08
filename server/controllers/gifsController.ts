import { Request, Response, NextFunction } from 'express'

/**
 * GIF search/trending, proxied through our own API.
 *
 * The key is deliberately NOT in the client. KLIPY puts it in the URL path
 * (`/api/v1/{KEY}/gifs/...`), so a browser-side call would ship it in the
 * bundle for anyone to lift and burn the quota with — which is exactly what
 * the previous Giphy integration did.
 *
 * The response is also normalised here, so the client never learns the
 * provider's shape and swapping providers again touches only this file.
 */

const BASE = 'https://api.klipy.com/api/v1'
const TIMEOUT_MS = 8000
const RATING = 'pg-13'

export interface Gif {
  id:      string
  title:   string
  preview: string   // grid thumbnail
  full:    string   // what actually gets sent
  width:   number
  height:  number
}

/** KLIPY renditions: hd | md | sm | xs, each with gif/webp variants.
 *  sm (~220px) is the grid size; xs is 83px and too small to read. */
const pick = (file: any, size: string) => file?.[size]?.gif ?? file?.[size]?.webp ?? null

const normalise = (item: any): Gif | null => {
  const f = item?.file
  const small = pick(f, 'sm') ?? pick(f, 'md') ?? pick(f, 'xs')
  const large = pick(f, 'hd') ?? pick(f, 'md') ?? small
  if (!small?.url || !large?.url) return null
  return {
    id:      String(item.id ?? item.slug ?? large.url),
    title:   String(item.title ?? ''),
    preview: small.url,
    full:    large.url,
    width:   Number(small.width) || 0,
    height:  Number(small.height) || 0,
  }
}

const callKlipy = async (path: string, params: Record<string, string>) => {
  const key = process.env.KLIPY_API_KEY
  if (!key) throw Object.assign(new Error('GIFs are not configured'), { status: 503 })

  const qs = new URLSearchParams({ rating: RATING, ...params }).toString()
  // A hung upstream must not hold our request open indefinitely.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/${key}/gifs/${path}?${qs}`, { signal: ctrl.signal })
    if (!res.ok) throw Object.assign(new Error('GIF provider error'), { status: 502 })
    const body: any = await res.json()
    const items: any[] = body?.data?.data ?? []
    return items.map(normalise).filter((g): g is Gif => g !== null)
  } finally { clearTimeout(timer) }
}

// Never leak the upstream error verbatim — it can carry the key back in a URL.
const fail = (res: Response, err: any) => {
  const status = err?.status === 503 ? 503 : 502
  res.status(status).json({
    message: status === 503 ? 'GIFs are not configured' : 'Couldn’t reach the GIF service',
  })
}

export const searchGifs = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (!q) { res.json({ gifs: [] }); return }
    const page = Math.max(1, Number(req.query.page) || 1)
    res.json({ gifs: await callKlipy('search', { q, page: String(page), per_page: '24' }) })
  } catch (err) { fail(res, err) }
}

export const trendingGifs = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    res.json({ gifs: await callKlipy('trending', { page: String(page), per_page: '24' }) })
  } catch (err) { fail(res, err) }
}

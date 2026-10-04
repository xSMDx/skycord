/**
 * An avatar as a 64 px round PNG data URL, for a notification.
 *
 * Drawn here, in the page, because avatars are JPEG data URLs, animated SVG
 * data URLs (the default avatar) or links to GIF hosts — and a Windows toast
 * takes only an image it can decode, never a web address. So the shell is
 * handed one small PNG and never fetches anything itself. A host that refuses
 * CORS taints the canvas; that avatar is simply left out.
 */
const cache = new Map<string, string | null>()
const CACHE_MAX = 100

export const roundIcon = (src: string, size = 64): Promise<string | null> => {
  if (cache.has(src)) return Promise.resolve(cache.get(src) ?? null)
  return new Promise(resolve => {
    let settled = false
    const done = (v: string | null) => {
      if (settled) return
      settled = true
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(src, v)
      resolve(v)
    }
    if (typeof Image === 'undefined' || typeof document === 'undefined') return done(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = size; c.height = size
        const g = c.getContext('2d')
        if (!g) return done(null)
        g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.closePath(); g.clip()
        g.drawImage(img, 0, 0, size, size)
        done(c.toDataURL('image/png'))
      } catch { done(null) }
    }
    img.onerror = () => done(null)
    setTimeout(() => done(null), 3000)
    img.src = src
  })
}

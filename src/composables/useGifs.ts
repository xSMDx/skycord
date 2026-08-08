/**
 * useGifs — shared GIF search/trending for the emoji picker and the
 * avatar/icon GIF pickers.
 *
 * Talks to OUR `/gifs` endpoints, never a provider directly. The provider key
 * lives on the server: KLIPY puts it in the URL path, so any browser-side call
 * would ship it in the bundle. The server also normalises the payload, so
 * nothing here knows which provider is behind it.
 */
import { ref } from 'vue'
import { useAuth } from './useAuth'

export interface Gif {
  id:      string
  title:   string
  preview: string
  full:    string
  width:   number
  height:  number
}

// Kept as functions so the call sites read the same as before the swap.
export const gifPreviewUrl = (g: Gif | any): string => g?.preview ?? ''
export const gifFullUrl    = (g: Gif | any): string => g?.full ?? g?.preview ?? ''

export const useGifs = () => {
  const { accessToken } = useAuth()

  const gifs    = ref<Gif[]>([])
  const loading = ref(false)
  const error   = ref(false)

  // Typing in the search box fires per keystroke; only the newest response may
  // write to `gifs`, or a slow earlier request can land last and overwrite the
  // results for what the user actually typed.
  let seq = 0

  const fetchGifs = async (query: string) => {
    const mine = ++seq
    loading.value = true
    error.value   = false
    try {
      const q = query.trim()
      const path = q ? `/gifs/search?q=${encodeURIComponent(q)}` : '/gifs/trending'
      const res = await fetch(path, {
        headers: accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {},
        credentials: 'include',
      })
      if (!res.ok) throw new Error('gif fetch failed')
      const data = await res.json()
      if (mine !== seq) return
      gifs.value = data.gifs ?? []
    } catch {
      if (mine !== seq) return
      error.value = true
      gifs.value  = []
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  return { gifs, loading, error, fetchGifs }
}

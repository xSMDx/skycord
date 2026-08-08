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
import { useApi, type ApiGif } from './useApi'

export type Gif = ApiGif

// Kept as functions so the call sites read the same as before the swap.
export const gifPreviewUrl = (g: Gif | any): string => g?.preview ?? ''
export const gifFullUrl    = (g: Gif | any): string => g?.full ?? g?.preview ?? ''

export const useGifs = () => {
  const api = useApi()

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
      const data = q ? await api.searchGifs(q) : await api.trendingGifs()
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

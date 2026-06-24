/**
 * useGiphy — shared Giphy GIF search/trending.
 * Centralizes the API key + fetch shape so the emoji picker and the group-icon
 * GIF picker don't each hardcode their own copy.
 */
import { ref } from 'vue'

const GIPHY_KEY = '4SYEO18OGvNzXQJQb17ZHzqUHyv6AGtA'

// Giphy's images object holds many renditions — fixed_width for grids (small,
// fast), original for full quality.
export const gifPreviewUrl = (gif: any): string =>
  gif?.images?.fixed_width?.url ?? gif?.images?.original?.url ?? ''
export const gifFullUrl = (gif: any): string =>
  gif?.images?.original?.url ?? gif?.images?.fixed_width?.url ?? ''

export const useGiphy = () => {
  const gifs    = ref<any[]>([])
  const loading = ref(false)
  const error   = ref(false)

  const fetchGifs = async (query: string) => {
    loading.value = true
    error.value   = false
    try {
      const endpoint = query.trim()
        ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query)}&api_key=${GIPHY_KEY}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`
      const res = await fetch(endpoint)
      if (!res.ok) throw new Error('Giphy error')
      const data = await res.json()
      gifs.value = data.data ?? []
    } catch {
      error.value = true
      gifs.value  = []
    } finally {
      loading.value = false
    }
  }

  return { gifs, loading, error, fetchGifs }
}

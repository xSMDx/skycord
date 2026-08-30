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

/** Where the "no key" state sends an admin. One constant, because both the
 *  composer's picker and the emoji picker's GIF tab link to it and a stale
 *  copy in one of them is a dead end nobody notices. */
export const GIF_SETUP_DOC =
  'https://github.com/xSMDx/sykord/blob/main/docs/self-hosting/installing.md#gifs--klipy'

// Kept as functions so the call sites read the same as before the swap.
export const gifPreviewUrl = (g: Gif | any): string => g?.preview ?? ''
export const gifFullUrl    = (g: Gif | any): string => g?.full ?? g?.preview ?? ''

export const useGifs = () => {
  const api = useApi()

  const gifs    = ref<Gif[]>([])
  const loading = ref(false)
  const error   = ref(false)
  /**
   * The instance has no GIF provider key, as opposed to a request that failed.
   *
   * Separate from `error` because the two need different words: a failure is
   * worth retrying, a missing key never is. On a self-hosted instance this is
   * the normal state until someone sets KLIPY_API_KEY, and telling that person
   * to "try again" sends them in a circle.
   */
  const notConfigured = ref(false)

  // Typing in the search box fires per keystroke; only the newest response may
  // write to `gifs`, or a slow earlier request can land last and overwrite the
  // results for what the user actually typed.
  let seq = 0

  const fetchGifs = async (query: string) => {
    const mine = ++seq
    loading.value = true
    error.value   = false
    notConfigured.value = false
    try {
      const q = query.trim()
      const data = q ? await api.searchGifs(q) : await api.trendingGifs()
      if (mine !== seq) return
      gifs.value = data.gifs ?? []
    } catch (e: any) {
      if (mine !== seq) return
      // 503 is gifsController saying KLIPY_API_KEY is unset — a permanent
      // condition, not a blip. Anything else is a genuine failure. This is
      // why useApi's `failure()` attaches the status: without it both look
      // identical here and the UI has to guess.
      notConfigured.value = e?.status === 503
      error.value         = e?.status !== 503
      gifs.value          = []
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  return { gifs, loading, error, notConfigured, fetchGifs }
}

import { ref } from 'vue'
import { useApi, type ApiMessage, type SearchScope } from './useApi'
import { isEmpty, toSearchParams, type SearchQuery, type SearchSort } from './searchQuery'

export interface SearchHit { message: ApiMessage; channelId?: string }

/**
 * The one search in progress. Module-level, like the other stores: the header
 * field, the results panel and the phone screen are three views of it.
 *
 * This is also the seam E2EE needs. When DMs are end-to-end encrypted the
 * server can no longer read them, and a DM search will have to run on the
 * device instead — behind `run()`, without the views noticing.
 */
const scope   = ref<SearchScope | null>(null)
const query   = ref<SearchQuery>({ chips: [], text: '' })
const sort    = ref<SearchSort>('newest')
const results = ref<SearchHit[]>([])
const total   = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error   = ref('')
const open    = ref(false)
let page = 1
/** Bumped per request, so a slower answer to a replaced search is dropped. */
let seq = 0

export const useSearch = () => {
  const api = useApi()

  const fetchPage = async (n: number, append: boolean) => {
    if (!scope.value || isEmpty(query.value)) return
    const mine = ++seq
    loading.value = true
    error.value = ''
    try {
      const res = await api.searchMessagesApi(scope.value, toSearchParams(query.value, sort.value, n))
      if (mine !== seq) return
      const hits = res.results.map(m => ({ message: m, channelId: m.channelId }))
      results.value = append ? [...results.value, ...hits] : hits
      total.value = res.total
      hasMore.value = res.hasMore
      page = n
      open.value = true
    } catch (e: any) {
      if (mine === seq) error.value = e?.message || 'Search failed'
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  const run = () => fetchPage(1, false)
  const loadMore = () => (hasMore.value && !loading.value ? fetchPage(page + 1, true) : Promise.resolve())
  const setSort = (s: SearchSort) => { sort.value = s; return run() }

  /** Close the panel and forget the answer; the typed search stays. */
  const close = () => {
    seq++
    open.value = false
    results.value = []
    total.value = 0
    hasMore.value = false
    loading.value = false
    error.value = ''
  }

  /** A different server or conversation: its answers mean nothing here. */
  const setScope = (s: SearchScope | null) => {
    const same = s && scope.value && s.kind === scope.value.kind && s.id === scope.value.id
    if (same) return
    scope.value = s
    query.value = { chips: [], text: '' }
    close()
  }

  return { scope, query, sort, results, total, hasMore, loading, error, open, setScope, run, loadMore, setSort, close }
}

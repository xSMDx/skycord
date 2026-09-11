import { describe, it, expect, beforeEach, vi } from 'vitest'

const api = vi.hoisted(() => ({ searchMessagesApi: vi.fn() }))
vi.mock('../useApi', () => ({ useApi: () => api }))

const { useSearch } = await import('../useSearch')

const page = (contents: string[], extra = {}) => ({
  results: contents.map((content, i) => ({ _id: `m${i}`, content, conversationId: 'c1', channelId: 'c1' })),
  total: contents.length, hasMore: false, ...extra,
})

describe('useSearch', () => {
  const s = useSearch()
  beforeEach(() => {
    api.searchMessagesApi.mockReset()
    s.close()
    s.setScope({ kind: 'server', id: 's1' })
    s.query.value = { chips: [], text: 'plan' }
  })

  it('runs against the scope and opens the results', async () => {
    api.searchMessagesApi.mockResolvedValue(page(['a plan']))
    await s.run()
    expect(api.searchMessagesApi).toHaveBeenCalledWith({ kind: 'server', id: 's1' }, expect.any(URLSearchParams))
    expect(api.searchMessagesApi.mock.calls[0][1].get('q')).toBe('plan')
    expect(s.results.value.map(r => r.message.content)).toEqual(['a plan'])
    expect(s.open.value).toBe(true)
  })

  it('does nothing for an empty search', async () => {
    s.query.value = { chips: [], text: '' }
    await s.run()
    expect(api.searchMessagesApi).not.toHaveBeenCalled()
  })

  it('appends the next page', async () => {
    api.searchMessagesApi.mockResolvedValueOnce(page(['one'], { hasMore: true }))
    api.searchMessagesApi.mockResolvedValueOnce(page(['two']))
    await s.run()
    await s.loadMore()
    expect(api.searchMessagesApi.mock.calls[1][1].get('page')).toBe('2')
    expect(s.results.value.map(r => r.message.content)).toEqual(['one', 'two'])
  })

  it('ignores an answer to a search that has since been replaced', async () => {
    let release!: (v: unknown) => void
    api.searchMessagesApi.mockImplementationOnce(() => new Promise(r => { release = r }))
    api.searchMessagesApi.mockResolvedValueOnce(page(['newer']))
    const first = s.run()
    s.query.value = { chips: [], text: 'other' }
    await s.run()
    release(page(['stale']))
    await first
    expect(s.results.value.map(r => r.message.content)).toEqual(['newer'])
  })

  it('shows the server’s own error text', async () => {
    api.searchMessagesApi.mockRejectedValue(new Error('Too many searches — wait a moment'))
    await s.run()
    expect(s.error.value).toBe('Too many searches — wait a moment')
  })

  it('reruns when the sort changes, and forgets results when the scope changes', async () => {
    api.searchMessagesApi.mockResolvedValue(page(['a']))
    await s.run()
    await s.setSort('relevant')
    expect(api.searchMessagesApi.mock.calls[1][1].get('sort')).toBe('relevant')
    s.setScope({ kind: 'dm', id: 'u2' })
    expect(s.results.value).toEqual([])
    expect(s.open.value).toBe(false)
  })
})

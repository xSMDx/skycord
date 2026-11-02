import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuth, type PublicUser } from '../useAuth'
import { library, deleteTrack, removeFromPlaylist, type LibTrack, type LibPlaylist } from '../useMusicLibrary'

/**
 * Deleting a song, and taking one out of a playlist, as the bulk run calls
 * them: each says how it was refused — the status and the rate headers, not
 * only a sentence — so the run can tell the app-wide limit (429, wait and go
 * again) from a song that will not go.
 */

const track = (id: string): LibTrack => ({
  id, title: id, artist: '', album: '', durationSec: 180, bytes: 1000, mimeType: 'audio/ogg',
  source: 'upload', scan: 'clean', cover: null,
} as unknown as LibTrack)

const playlist = (ids: string[]): LibPlaylist => ({
  id: 'p1', name: 'Mix', count: ids.length, tracks: ids.map(track),
} as unknown as LibPlaylist)

const { user, accessToken } = useAuth()
const realFetch = globalThis.fetch

beforeEach(() => {
  user.value = { id: 'u1', username: 'u1' } as PublicUser
  accessToken.value = 't1'
  library.tracks = [track('a'), track('b')]
  library.usage = { tracks: 2, bytes: 2000 }
  library.open = null
  library.error = ''
})
afterEach(() => {
  user.value = null
  accessToken.value = null
  globalThis.fetch = realFetch
})

const limited = () => new Response(JSON.stringify({ message: 'Too many requests' }), {
  status: 429, headers: { 'Retry-After': '7', 'RateLimit-Reset': '7' },
})

describe('deleteTrack', () => {
  it('null once it is gone, and the library lets go of it', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
    expect(await deleteTrack('a')).toBeNull()
    expect(library.tracks.map(t => t.id)).toEqual(['b'])
  })

  it('a 429 comes back with its status and its rate headers, and the song stays', async () => {
    globalThis.fetch = vi.fn(async () => limited()) as typeof fetch
    const failed = await deleteTrack('a', { quiet: true })
    expect(failed).toMatchObject({ ok: false, status: 429, message: 'Too many requests' })
    expect(failed?.headers['retry-after']).toBe('7')
    expect(failed?.headers['ratelimit-reset']).toBe('7')
    expect(library.tracks.map(t => t.id)).toEqual(['a', 'b'])
    expect(library.error).toBe('')
  })

  it('a dead connection comes back as status 0', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    expect(await deleteTrack('a')).toMatchObject({ status: 0, message: 'Failed to fetch' })
    expect(library.error).toBe('Failed to fetch')
  })
})

describe('removeFromPlaylist', () => {
  it('reloads the open playlist after one removal, by default', async () => {
    library.open = playlist(['a', 'b'])
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ playlist: { id: 'p1' } }), { status: 200 })
      return new Response(JSON.stringify({ playlist: playlist(['b']) }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    expect(await removeFromPlaylist('p1', 0)).toBeNull()
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/music/playlists/p1/tracks/0', '/music/playlists/p1'])
    expect(library.open?.tracks?.map(t => t.id)).toEqual(['b'])
  })

  it('with reload: false, removes and reads nothing back — a bulk run reloads once at its end', async () => {
    library.open = playlist(['a', 'b', 'c'])
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ playlist: { id: 'p1' } }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    expect(await removeFromPlaylist('p1', 2, { quiet: true, reload: false })).toBeNull()
    expect(await removeFromPlaylist('p1', 0, { quiet: true, reload: false })).toBeNull()
    expect(fetchMock.mock.calls.map(c => (c as unknown[])[0])).toEqual(['/music/playlists/p1/tracks/2', '/music/playlists/p1/tracks/0'])
  })

  it('a 429 comes back with its status and its rate headers', async () => {
    library.open = playlist(['a'])
    globalThis.fetch = vi.fn(async () => limited()) as typeof fetch
    const failed = await removeFromPlaylist('p1', 0, { quiet: true, reload: false })
    expect(failed).toMatchObject({ status: 429, message: 'Too many requests' })
    expect(failed?.headers['retry-after']).toBe('7')
  })
})

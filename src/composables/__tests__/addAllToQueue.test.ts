import { describe, it, expect, vi } from 'vitest'

vi.mock('../useSocket', () => ({ getSocket: () => ({ emit: vi.fn() }) }))

import { addAllToQueue, clearQueue, queue } from '../useMusicPlayer'
import player from '../useMusicPlayer.ts?raw'
import type { LibTrack } from '../useMusicLibrary'

const song = (id: string): LibTrack =>
  ({ id, title: id, artist: '', durationSec: 60, cover: null }) as unknown as LibTrack

describe('addAllToQueue', () => {
  it('puts every song at the end of your queue, in the order given', () => {
    clearQueue()
    addAllToQueue([song('a')])
    addAllToQueue([song('b'), song('c'), song('d')])
    expect(queue.manual.map(t => t.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('with nothing to add, changes nothing', () => {
    clearQueue()
    const before = queue.manual
    addAllToQueue([])
    expect(queue.manual).toBe(before)
  })

  it('enqueues them all, then saves and prefetches once rather than once a song', () => {
    const body = /export const addAllToQueue = [^\n]*\n([\s\S]*?)\n\}/.exec(player)?.[1] ?? ''
    expect(body).toMatch(/for \(const t of tracks\) s = Q\.enqueue\(s, t, 'last'\)/)
    expect(body.match(/changed\(\)/g)).toHaveLength(1)
    expect(body.indexOf('changed()')).toBeGreaterThan(body.indexOf('apply(s)'))
  })
})

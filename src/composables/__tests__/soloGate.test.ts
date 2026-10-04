import { describe, it, expect, beforeEach, vi } from 'vitest'

const emit = vi.fn()
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit }) }))

import { music, onMusicState, listenToMusic, setMusicTarget } from '../useMusic'
import { okToPlaySolo, playFrom, next, queue } from '../useMusicPlayer'
import type { LibTrack } from '../useMusicLibrary'
import { leavePrompt, answerLeave } from '../leavePrompt'

const one = { channels: [{ id: 'a', name: 'Chill', now: null, queue: [], queued: 0, listeners: [] }] }

beforeEach(() => {
  answerLeave(false)
  setMusicTarget({ conversationId: 'c1', kind: 'channel' })
  onMusicState(one)
  listenToMusic(null)
  emit.mockClear()
})

describe('playing just for you while in a channel', () => {
  it('needs no question when you are not in one', async () => {
    await expect(okToPlaySolo('Foxtrot')).resolves.toBe(true)
    expect(leavePrompt.open).toBe(false)
  })

  it('asks, and staying keeps you in', async () => {
    listenToMusic('a')
    emit.mockClear()
    const p = okToPlaySolo('Foxtrot')
    expect(leavePrompt).toMatchObject({ open: true, channel: 'Chill', what: 'Foxtrot' })
    answerLeave(false)
    await expect(p).resolves.toBe(false)
    expect(music.listeningTo).toBe('a')
    // Staying says nothing to the server.
    expect(emit).not.toHaveBeenCalled()
  })

  it('leaving takes you out, and tells the server, before anything plays', async () => {
    listenToMusic('a')
    emit.mockClear()
    const p = okToPlaySolo('Foxtrot')
    answerLeave(true)
    await expect(p).resolves.toBe(true)
    expect(music.listeningTo).toBeNull()
    expect(emit).toHaveBeenCalledWith('music:listen', expect.objectContaining({ channelId: null }))
  })
})

describe('the real ways in go through the question', () => {
  const song = { id: 't1', title: 'Foxtrot', artist: 'Long Band', durationSec: 180, cover: null } as unknown as LibTrack

  it('a click on a song asks, and staying leaves your queue untouched', async () => {
    listenToMusic('a')
    const before = queue.current
    const p = playFrom([song], 0, { key: 'library', label: 'Your library' })
    expect(leavePrompt).toMatchObject({ open: true, what: 'Foxtrot' })
    answerLeave(false)
    await p
    expect(queue.current).toBe(before)
    expect(music.listeningTo).toBe('a')
  })

  it('next asks too', async () => {
    listenToMusic('a')
    const p = next()
    expect(leavePrompt.open).toBe(true)
    answerLeave(false)
    await p
    expect(music.listeningTo).toBe('a')
  })
})

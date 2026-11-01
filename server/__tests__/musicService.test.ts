/// <reference types="node" />
/**
 * The API's side of the line to the music service: what each answer to a
 * pause or resume means, and how the "can it pause" question is kept fresh.
 *
 * fetch is stubbed rather than pointed at a server, so the clock can be
 * faked: the interesting behaviour here happens a minute later.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { config } from '../config/env'
import {
  musicPause, musicResume, musicCanPause, refreshMusicCapabilities,
  forgetMusicCapabilities, onMusicCapabilitiesChange,
} from '../utils/musicService'

const saved = { url: config.music.url, secret: config.music.secret }
let answers: Record<string, { status: number; body?: unknown } | 'unreachable'>

beforeEach(() => {
  Object.assign(config.music, { url: 'http://music.test', secret: 'a-secret' })
  forgetMusicCapabilities()
  answers = {}
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const a = answers[new URL(input).pathname] ?? { status: 200, body: { ok: true } }
    if (a === 'unreachable') throw new Error('connect ECONNREFUSED')
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { 'content-type': 'application/json' } })
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  onMusicCapabilitiesChange(() => {})
  forgetMusicCapabilities()
  Object.assign(config.music, saved)
})

describe('pause and resume answers', () => {
  it('a pause is done only on a 200; a 409 (nothing to hold yet, a song still starting) is "not yet"', async () => {
    answers['/pause'] = { status: 409 }
    expect(await musicPause('voice:1', 'c')).toBe('not-yet')
    answers['/pause'] = { status: 500 }
    expect(await musicPause('voice:1', 'c')).toBe('failed')
    answers['/pause'] = { status: 200 }
    expect(await musicPause('voice:1', 'c')).toBe('paused')
  })

  it('a 404 on resume (the service was rolled back mid-pause) means "start it again", and no more Pause', async () => {
    // An older service has no /resume, and lost the song in its restart
    // anyway. Calling that a failure would leave the song unresumable.
    answers['/capabilities'] = { status: 200, body: { pause: true } }
    expect(await refreshMusicCapabilities()).toBe(true)
    answers['/resume'] = { status: 404 }
    expect(await musicResume('voice:1', 'c')).toBe('not-held')
    expect(musicCanPause()).toBe(false)
  })

  it('a 409 on resume is "not held"; anything else is a failure', async () => {
    answers['/resume'] = { status: 409 }
    expect(await musicResume('voice:1', 'c')).toBe('not-held')
    answers['/resume'] = { status: 500 }
    expect(await musicResume('voice:1', 'c')).toBe('failed')
    answers['/resume'] = 'unreachable'
    expect(await musicResume('voice:1', 'c')).toBe('failed')
  })
})

describe('keeping "can it pause" fresh', () => {
  it('a No is asked again on its own a minute later, and the rooms are told when it flips', async () => {
    // The usual No: the server was updated before the service. Updating the
    // service must make Pause appear without anyone needing to touch a room.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const flips = vi.fn()
    onMusicCapabilitiesChange(flips)
    answers['/capabilities'] = { status: 404 }
    expect(await refreshMusicCapabilities()).toBe(false)
    expect(flips).not.toHaveBeenCalled()

    answers['/capabilities'] = { status: 200, body: { pause: true } }
    await vi.advanceTimersByTimeAsync(59_000)
    expect(flips).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(flips).toHaveBeenCalledTimes(1)
    expect(musicCanPause()).toBe(true)
  })

  it('an unreachable service is asked again sooner, and nothing is re-told while it stays down', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const flips = vi.fn()
    onMusicCapabilitiesChange(flips)
    answers['/capabilities'] = 'unreachable'
    expect(await refreshMusicCapabilities()).toBe(false)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(flips).not.toHaveBeenCalled()             // still down, still no

    answers['/capabilities'] = { status: 200, body: { pause: true } }
    await vi.advanceTimersByTimeAsync(16_000)
    expect(flips).toHaveBeenCalledTimes(1)
    expect(musicCanPause()).toBe(true)
  })

  it('a Yes is not polled: it is re-checked when a state is next built', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    answers['/capabilities'] = { status: 200, body: { pause: true } }
    await refreshMusicCapabilities()
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createUploadQueue, nextAction, retryAfterMs, looksLikeAudio, judge, announcement, snapshot,
  RETRY_FALLBACK_MS, NOT_REACHED, HELD_SAYS,
  type Attempt, type UploadItem,
} from '../uploadScheduler'

/**
 * Several songs going up one after another, under a server that takes 20 a
 * minute.
 *
 * The decisions — what to start next, how long a 429 says to wait — are pure
 * functions and are tested as such. The queue that acts on them owns the
 * timers, so it runs here under fake timers against fake servers: one the
 * test answers by hand, and one that counts uploads per window the way
 * express-rate-limit does and answers 429 past the limit.
 */

const LIMIT_SAYS = 'Too many uploads — wait a moment'

const files = (n: number, prefix = 'song'): File[] =>
  Array.from({ length: n }, (_, i) =>
    new File(['x'], `${prefix}-${String(i + 1).padStart(2, '0')}.mp3`, { type: 'audio/mpeg' }))

const ok = (value: string): Attempt<string> => ({ ok: true, value })
const refused = (status: number, message: string, headers: Record<string, string> = {}): Attempt<string> =>
  ({ ok: false, status, headers, message })

/** A server the test answers by hand, one call at a time. */
const byHand = () => {
  const calls: {
    name: string
    file: File
    progress: (fraction: number) => void
    signal: AbortSignal
    answer: (a: Attempt<string>) => void
  }[] = []
  const send = (file: File, progress: (fraction: number) => void, signal: AbortSignal) =>
    new Promise<Attempt<string>>((resolve) => {
      calls.push({ name: file.name, file, progress, signal, answer: resolve })
      // What the real XHR does when it is aborted: it answers, with nothing.
      signal.addEventListener('abort', () => resolve(refused(0, 'stopped')))
    })
  return { send, calls }
}

/**
 * A server that takes `max` uploads per window, counted from the first one,
 * and answers 429 past that — every request counts, the refused ones too, as
 * express-rate-limit's memory store counts them. Each accepted upload takes
 * `takesMs`.
 */
const limitedServer = ({ max = 20, windowMs = 60_000, takesMs = 400, headers = true } = {}) => {
  let windowEnds = -Infinity
  let count = 0
  let inFlight = 0
  let most = 0
  const log: { name: string; at: number; status: number }[] = []
  const send = (file: File, progress: (fraction: number) => void) =>
    new Promise<Attempt<string>>((resolve) => {
      const now = Date.now()
      if (now >= windowEnds) { windowEnds = now + windowMs; count = 0 }
      count++
      if (count > max) {
        log.push({ name: file.name, at: now, status: 429 })
        const reset = String(Math.ceil((windowEnds - now) / 1000))
        resolve(refused(429, LIMIT_SAYS, headers ? { 'Retry-After': reset, 'RateLimit-Reset': reset } : {}))
        return
      }
      inFlight++
      most = Math.max(most, inFlight)
      setTimeout(() => progress(0.5), takesMs / 2)
      setTimeout(() => {
        inFlight--
        log.push({ name: file.name, at: Date.now(), status: 201 })
        resolve(ok(file.name))
      }, takesMs)
    })
  return { send, log, most: () => most, windowEnds: () => windowEnds }
}

type Send = (file: File, progress: (fraction: number) => void, signal: AbortSignal) => Promise<Attempt<string>>

const queueWith = (send: Send, more: { refuse?: (f: File) => string | null; lingerMs?: number } = {}) => {
  const items: UploadItem[] = []
  const batch = { total: 0, done: 0, held: false }
  const uploaded: string[] = []
  const q = createUploadQueue<string>({ items, batch, send, uploaded: v => { uploaded.push(v) }, ...more })
  const named = (name: string) => items.find(i => i.name === name)
  return { ...q, items, batch, uploaded, named }
}

/** Let every promise that is ready settle, without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('the queue', () => {
  it('files upload one after another', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()

    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3'])
    expect(q.items.map(i => i.state)).toEqual(['uploading', 'waiting', 'waiting'])

    server.calls[0].answer(ok('song-01.mp3'))
    await settle()
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-02.mp3'])
    expect(q.named('song-01.mp3')?.state).toBe('done')

    server.calls[1].answer(ok('song-02.mp3'))
    await settle()
    server.calls[2].answer(ok('song-03.mp3'))
    await settle()

    expect(q.uploaded).toEqual(['song-01.mp3', 'song-02.mp3', 'song-03.mp3'])
    expect(server.calls).toHaveLength(3)
    expect(q.batch).toEqual({ total: 3, done: 3, held: false })
  })

  it('a failure moves on to the next', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()
    server.calls[0].answer(ok('song-01.mp3'))
    await settle()
    server.calls[1].answer(refused(413, 'That file is too large for this server. Whoever runs it can raise its upload limit.'))
    await settle()

    expect(q.named('song-02.mp3')).toMatchObject({
      state: 'failed',
      error: 'That file is too large for this server. Whoever runs it can raise its upload limit.',
    })
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-02.mp3', 'song-03.mp3'])

    server.calls[2].answer(ok('song-03.mp3'))
    await settle()
    expect(q.uploaded).toEqual(['song-01.mp3', 'song-03.mp3'])
    expect(q.batch).toEqual({ total: 3, done: 2, held: false })
  })

  it('a network error holds the batch and keeps the file', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()
    server.calls[0].progress(0.6)
    server.calls[0].answer(refused(0, ''))
    await settle()

    // Not failed, and the rest not thrown after it: an offline moment is the
    // connection's, not the file's. The file goes back to the head of the line.
    expect(q.named('song-01.mp3')).toMatchObject({ state: 'waiting', pct: 0, error: NOT_REACHED })
    expect(q.items.map(i => i.state)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(q.batch).toEqual({ total: 3, done: 0, held: true })

    // Held: nothing more goes out by itself, however long it is left.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(server.calls).toHaveLength(1)
    expect(q.items).toHaveLength(3)
  })

  it('Retry sends the same file again', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].answer(refused(0, ''))
    await settle()

    q.resume()
    await settle()
    expect(q.batch.held).toBe(false)
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-01.mp3'])
    expect(server.calls[1].file).toBe(server.calls[0].file)
    expect(q.named('song-01.mp3')?.state).toBe('uploading')
    expect(q.named('song-01.mp3')?.error).toBeUndefined()

    server.calls[1].answer(ok('song-01.mp3'))
    await settle()
    expect(q.uploaded).toEqual(['song-01.mp3'])
    expect(server.calls.at(-1)?.name).toBe('song-02.mp3')
  })

  it('a retry that cannot reach the server either holds again', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].answer(refused(0, ''))
    await settle()
    q.resume()
    await settle()
    server.calls[1].answer(refused(0, ''))
    await settle()
    expect(q.batch.held).toBe(true)
    expect(q.named('song-01.mp3')).toMatchObject({ state: 'waiting', error: NOT_REACHED })
    expect(server.calls).toHaveLength(2)
  })

  it('files added while held join the batch and wait for Retry', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(1))
    await settle()
    server.calls[0].answer(refused(0, ''))
    await settle()
    q.enqueue(files(1, 'late'))
    await settle()
    expect(server.calls).toHaveLength(1)
    expect(q.batch).toEqual({ total: 2, done: 0, held: true })
  })

  it('the file held can still be dropped; with nothing left to send the hold lets go', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(1))
    await settle()
    server.calls[0].answer(refused(0, ''))
    await settle()
    expect(q.batch.held).toBe(true)
    expect(q.drop(q.named('song-01.mp3')!.id)).toBe(true)
    expect(q.items).toEqual([])
    expect(q.batch.held).toBe(false)
  })

  it('dropping the file going up does not hold the queue', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()
    server.calls[0].progress(0.4)

    q.drop(q.named('song-01.mp3')!.id)
    await settle()
    // The stopped try answers status 0, as XHR does. That is not the network.
    expect(server.calls[0].signal.aborted).toBe(true)
    expect(q.batch.held).toBe(false)
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-02.mp3'])
    expect(q.named('song-02.mp3')?.state).toBe('uploading')
    expect(q.named('song-02.mp3')?.error).toBeUndefined()
  })

  it('clear while held forgets the hold', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].answer(refused(0, ''))
    await settle()
    expect(q.batch.held).toBe(true)

    q.clear()
    expect(q.items).toEqual([])
    expect(q.batch).toEqual({ total: 0, done: 0, held: false })

    // The next batch goes at once, not held by the last one's lost connection.
    q.enqueue(files(1, 'next'))
    await settle()
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'next-01.mp3'])
  })

  it('a 429 waits Retry-After then retries the same file', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].answer(refused(429, LIMIT_SAYS, { 'Retry-After': '30' }))
    await settle()

    // Not failed: waiting for the limit, and saying until when.
    expect(q.named('song-01.mp3')).toMatchObject({ state: 'limited', retryAt: Date.now() + 30_000 })
    expect(q.named('song-01.mp3')?.error).toBeUndefined()
    expect(q.named('song-02.mp3')?.state).toBe('waiting')

    await vi.advanceTimersByTimeAsync(29_999)
    expect(server.calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-01.mp3'])
    expect(q.named('song-01.mp3')?.state).toBe('uploading')
    expect(q.named('song-01.mp3')?.retryAt).toBeUndefined()

    server.calls[1].answer(ok('song-01.mp3'))
    await settle()
    expect(q.uploaded).toEqual(['song-01.mp3'])
    expect(server.calls.at(-1)?.name).toBe('song-02.mp3')
  })

  it('RateLimit-Reset is honoured', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(1))
    await settle()
    server.calls[0].answer(refused(429, LIMIT_SAYS, { 'RateLimit-Reset': '12' }))
    await settle()

    await vi.advanceTimersByTimeAsync(11_999)
    expect(server.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.calls).toHaveLength(2)
  })

  it('no header → 60 s', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(1))
    await settle()
    server.calls[0].answer(refused(429, LIMIT_SAYS))
    await settle()

    expect(q.named('song-01.mp3')).toMatchObject({ state: 'limited', retryAt: Date.now() + 60_000 })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(server.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.calls).toHaveLength(2)
  })

  it('a dropped waiting file is skipped', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()

    expect(q.drop(q.named('song-02.mp3')!.id)).toBe(true)
    expect(q.items.map(i => i.name)).toEqual(['song-01.mp3', 'song-03.mp3'])

    server.calls[0].answer(ok('song-01.mp3'))
    await settle()
    server.calls[1].answer(ok('song-03.mp3'))
    await settle()

    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-03.mp3'])
    expect(q.batch).toEqual({ total: 2, done: 2, held: false })
  })

  it('dropping the file going up stops it and moves on', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].progress(0.4)

    expect(q.drop(q.named('song-01.mp3')!.id)).toBe(true)
    await settle()

    expect(server.calls[0].signal.aborted).toBe(true)
    expect(q.items.map(i => i.name)).toEqual(['song-02.mp3'])
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-02.mp3'])
    expect(q.uploaded).toEqual([])
  })

  it('a file already checking and converting cannot be dropped — the server has it', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(1))
    await settle()
    server.calls[0].progress(1)

    const it1 = q.named('song-01.mp3')!
    expect(it1.state).toBe('converting')
    expect(q.drop(it1.id)).toBe(false)
    expect(server.calls[0].signal.aborted).toBe(false)
    expect(q.items).toHaveLength(1)
  })

  it('a song that went up just as it was dropped still reaches the library', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(1))
    await settle()
    server.calls[0].answer(ok('song-01.mp3'))
    q.drop(q.named('song-01.mp3')!.id)
    await settle()
    expect(q.uploaded).toEqual(['song-01.mp3'])
  })

  it('dropping the file waiting out the limit hands the wait to the next', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].answer(refused(429, LIMIT_SAYS, { 'Retry-After': '30' }))
    await settle()
    const until = Date.now() + 30_000

    q.drop(q.named('song-01.mp3')!.id)
    await settle()
    // The limit is the server's, not the file's: the next one waits it out.
    expect(q.named('song-02.mp3')).toMatchObject({ state: 'limited', retryAt: until })
    expect(server.calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(server.calls.map(c => c.name)).toEqual(['song-01.mp3', 'song-02.mp3'])
  })

  it('only the file at the head of the queue says it is waiting for the limit', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()
    server.calls[0].answer(refused(429, LIMIT_SAYS, { 'Retry-After': '30' }))
    await settle()
    expect(q.items.map(i => i.state)).toEqual(['limited', 'waiting', 'waiting'])
  })

  it('clear stops everything and ignores the answer still on its way (signing out)', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(3))
    await settle()

    q.clear()
    expect(q.items).toEqual([])
    expect(q.batch).toEqual({ total: 0, done: 0, held: false })
    expect(server.calls[0].signal.aborted).toBe(true)

    // Even a success that lands now must not reach the next person's library.
    server.calls[0].answer(ok('song-01.mp3'))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(q.uploaded).toEqual([])
    expect(server.calls).toHaveLength(1)
  })

  it('clear while waiting out the limit sends nothing when the wait ends', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    server.calls[0].answer(refused(429, LIMIT_SAYS, { 'Retry-After': '30' }))
    await settle()
    q.clear()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(server.calls).toHaveLength(1)
  })

  it('a file the server is known to refuse fails at once, without being sent', async () => {
    const server = byHand()
    const q = queueWith(server.send, { refuse: f => f.name === 'song-01.mp3' ? 'That file is too big — 25MB at most.' : null })
    q.enqueue(files(2))
    await settle()

    expect(q.named('song-01.mp3')).toMatchObject({ state: 'failed', error: 'That file is too big — 25MB at most.' })
    expect(server.calls.map(c => c.name)).toEqual(['song-02.mp3'])
  })

  it('shows its progress: bytes up to 95 %, then checking and converting, then done', async () => {
    const server = byHand()
    const q = queueWith(server.send, { lingerMs: 3000 })
    q.enqueue(files(1))
    await settle()
    const row = q.named('song-01.mp3')!

    server.calls[0].progress(0.5)
    expect(row).toMatchObject({ state: 'uploading', pct: 48 })
    server.calls[0].progress(0.999)
    expect(row.pct).toBeLessThanOrEqual(95)
    server.calls[0].progress(1)
    expect(row).toMatchObject({ state: 'converting', pct: 95 })

    server.calls[0].answer(ok('song-01.mp3'))
    await settle()
    expect(row).toMatchObject({ state: 'done', pct: 100 })

    // Finished rows clear themselves after a moment.
    await vi.advanceTimersByTimeAsync(2999)
    expect(q.items).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(q.items).toHaveLength(0)
  })

  it('a failed row stays until it is dismissed', async () => {
    const server = byHand()
    const q = queueWith(server.send, { lingerMs: 3000 })
    q.enqueue(files(1))
    await settle()
    server.calls[0].answer(refused(415, 'That is not a song.'))
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(q.items.map(i => i.state)).toEqual(['failed'])
    expect(q.drop(q.items[0].id)).toBe(true)
    expect(q.items).toEqual([])
  })

  it('counts a new batch from zero once the last one is over', async () => {
    const server = byHand()
    const q = queueWith(server.send)
    q.enqueue(files(2))
    await settle()
    // More files while the first batch is going join it.
    q.enqueue(files(1, 'late'))
    expect(q.batch).toEqual({ total: 3, done: 0, held: false })
    for (let i = 0; i < 3; i++) { server.calls[i].answer(ok(server.calls[i].name)); await settle() }
    expect(q.batch).toEqual({ total: 3, done: 3, held: false })

    q.enqueue(files(2, 'next'))
    expect(q.batch).toEqual({ total: 2, done: 0, held: false })
  })

  it('25 files under 20/min finish', async () => {
    const server = limitedServer()
    const q = queueWith(server.send)
    const all = files(25)
    q.enqueue(all)
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    // Every file, exactly once, in the order chosen.
    expect(q.uploaded).toEqual(all.map(f => f.name))
    expect(server.most()).toBe(1)
    // It asked once past the limit, then waited the window out instead of
    // asking again and again.
    const turnedAway = server.log.filter(r => r.status === 429)
    expect(turnedAway).toHaveLength(1)
    const after = server.log.filter(r => r.at > turnedAway[0].at)
    expect(after.every(r => r.at >= turnedAway[0].at + 50_000)).toBe(true)
    expect(q.items.filter(i => i.state !== 'done')).toEqual([])
    expect(q.batch).toEqual({ total: 25, done: 25, held: false })
  })

  it('25 files under 20/min finish when the 429 carries no headers at all', async () => {
    const server = limitedServer({ headers: false })
    const q = queueWith(server.send)
    q.enqueue(files(25))
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(q.uploaded).toHaveLength(25)
    expect(server.log.filter(r => r.status === 429)).toHaveLength(1)
  })

  it('25 files with a 413 among them: that one fails, the other 24 go up', async () => {
    const server = limitedServer()
    const send: Send = (file, progress) =>
      file.name === 'song-07.mp3'
        ? Promise.resolve(refused(413, 'That file is too large for this server. Whoever runs it can raise its upload limit.'))
        : server.send(file, progress)
    const q = queueWith(send)
    q.enqueue(files(25))
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(q.uploaded).toHaveLength(24)
    expect(q.uploaded).not.toContain('song-07.mp3')
    expect(q.items.map(i => i.state)).toEqual(['failed'])
    expect(q.batch).toEqual({ total: 25, done: 24, held: false })
  })
})

describe('nextAction', () => {
  const row = (id: string, state: UploadItem['state']): UploadItem => ({ id, name: id, state, pct: 0 })

  it('waits while one is going up or converting', () => {
    expect(nextAction([row('a', 'uploading'), row('b', 'waiting')], 0, 0)).toEqual({ kind: 'busy' })
    expect(nextAction([row('a', 'converting'), row('b', 'waiting')], 0, 0)).toEqual({ kind: 'busy' })
  })

  it('starts the first one still waiting, past those finished or failed', () => {
    expect(nextAction([row('a', 'done'), row('b', 'failed'), row('c', 'waiting'), row('d', 'waiting')], 0, 0))
      .toEqual({ kind: 'start', id: 'c' })
  })

  it('holds the head of the queue while the limit lasts', () => {
    expect(nextAction([row('a', 'limited'), row('b', 'waiting')], 5000, 1000))
      .toEqual({ kind: 'wait', id: 'a', until: 5000 })
    expect(nextAction([row('a', 'limited'), row('b', 'waiting')], 5000, 5000))
      .toEqual({ kind: 'start', id: 'a' })
  })

  it('has nothing to do when nothing is left', () => {
    expect(nextAction([row('a', 'done'), row('b', 'failed')], 0, 0)).toEqual({ kind: 'idle' })
    expect(nextAction([], 0, 0)).toEqual({ kind: 'idle' })
  })

  it('starts nothing while held, not even once the limit has lifted', () => {
    expect(nextAction([row('a', 'waiting'), row('b', 'waiting')], 0, 0, true)).toEqual({ kind: 'held' })
    expect(nextAction([row('a', 'limited')], 5000, 1000, true)).toEqual({ kind: 'held' })
    // With nothing left to send there is nothing to hold.
    expect(nextAction([row('a', 'failed')], 0, 0, true)).toEqual({ kind: 'idle' })
  })
})

describe('judge', () => {
  const lost: Attempt<string> = { ok: false, status: 0, headers: {}, message: '' }

  it('holds on a try that never reached the server', () => {
    expect(judge(lost, 0)).toEqual({ kind: 'held' })
  })

  it('does not hold on a try that was stopped on purpose', () => {
    expect(judge(lost, 0, { stopped: true })).toEqual({ kind: 'failed', error: NOT_REACHED })
  })

  it('still fails a file the server refused, and waits out a 429', () => {
    expect(judge(refused(415, 'That is not a song.'), 0)).toEqual({ kind: 'failed', error: 'That is not a song.' })
    expect(judge(refused(429, LIMIT_SAYS, { 'Retry-After': '5' }), 0)).toEqual({ kind: 'retry', at: 5000 })
  })
})

describe('announcement', () => {
  const row = (id: string, state: UploadItem['state'], more: Partial<UploadItem> = {}): UploadItem =>
    ({ id, name: `${id}.mp3`, state, pct: 0, ...more })
  const said = (before: UploadItem[], after: UploadItem[], b0 = { total: 1, done: 0, held: false }, b1 = b0) =>
    announcement(snapshot(before, b0), after, b1)

  it('says nothing when nothing worth saying changed', () => {
    expect(said([row('a', 'waiting')], [row('a', 'waiting')])).toBe('')
    expect(said([row('a', 'waiting')], [row('a', 'uploading', { pct: 40 })])).toBe('')
  })

  it('says when the limit is being waited out', () => {
    expect(said([row('a', 'uploading')], [row('a', 'limited')])).toBe('Waiting for the upload limit…')
  })

  it('names a file that went up, with how far the batch has got', () => {
    expect(said([row('a', 'converting')], [row('a', 'done')], { total: 1, done: 0, held: false }, { total: 1, done: 1, held: false }))
      .toBe('a.mp3 added to your library.')
    expect(said(
      [row('a', 'converting'), row('b', 'waiting')], [row('a', 'done'), row('b', 'uploading')],
      { total: 8, done: 2, held: false }, { total: 8, done: 3, held: false },
    )).toBe('a.mp3 added to your library. 3 of 8 uploaded.')
  })

  it('names a file that failed, and why', () => {
    expect(said([row('a', 'uploading')], [row('a', 'failed', { error: 'That is not a song.' })]))
      .toBe('a.mp3 failed: That is not a song.')
  })

  it('says when the server could not be reached', () => {
    expect(said(
      [row('a', 'uploading')], [row('a', 'waiting', { error: NOT_REACHED })],
      { total: 1, done: 0, held: false }, { total: 1, done: 0, held: true },
    )).toBe(`${HELD_SAYS}.`)
  })

  it('a file refused before it was sent is new, and said as failed', () => {
    expect(said([], [row('a', 'failed', { error: 'That file is too big — 25MB at most.' })]))
      .toBe('a.mp3 failed: That file is too big — 25MB at most.')
  })
})

describe('retryAfterMs', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')

  it('reads Retry-After in seconds', () => {
    expect(retryAfterMs({ 'Retry-After': '30' }, now)).toBe(30_000)
    expect(retryAfterMs({ 'retry-after': '7' }, now)).toBe(7_000)
  })

  it('reads Retry-After as an HTTP date', () => {
    expect(retryAfterMs({ 'Retry-After': new Date(now + 45_000).toUTCString() }, now)).toBe(45_000)
  })

  it('reads RateLimit-Reset as seconds from now', () => {
    expect(retryAfterMs({ 'RateLimit-Reset': '42' }, now)).toBe(42_000)
    expect(retryAfterMs({ 'ratelimit-reset': '42' }, now)).toBe(42_000)
  })

  it('reads a RateLimit-Reset that is a moment rather than a delay', () => {
    // Some servers send the epoch second the window ends. No window is fifty
    // years long, so a number that size is a time, not a count of seconds.
    expect(retryAfterMs({ 'RateLimit-Reset': String(now / 1000 + 20) }, now)).toBe(20_000)
  })

  it('prefers Retry-After when both are there', () => {
    expect(retryAfterMs({ 'Retry-After': '10', 'RateLimit-Reset': '50' }, now)).toBe(10_000)
  })

  it('no header → 60 s', () => {
    expect(retryAfterMs({}, now)).toBe(60_000)
    expect(RETRY_FALLBACK_MS).toBe(60_000)
    expect(retryAfterMs({ 'Retry-After': undefined, 'RateLimit-Reset': undefined }, now)).toBe(60_000)
  })

  it('falls back to 60 s on a header it cannot read', () => {
    expect(retryAfterMs({ 'Retry-After': 'soon' }, now)).toBe(60_000)
    expect(retryAfterMs({ 'RateLimit-Reset': '-5' }, now)).toBe(60_000)
  })

  it('never asks again at once, and never waits for ever', () => {
    expect(retryAfterMs({ 'Retry-After': '0' }, now)).toBe(1000)
    expect(retryAfterMs({ 'Retry-After': new Date(now - 60_000).toUTCString() }, now)).toBe(1000)
    expect(retryAfterMs({ 'Retry-After': '86400' }, now)).toBe(15 * 60_000)
  })
})

describe('looksLikeAudio', () => {
  it('takes audio by type or by the extensions the picker offers', () => {
    expect(looksLikeAudio({ name: 'a.mp3', type: 'audio/mpeg' })).toBe(true)
    expect(looksLikeAudio({ name: 'b.flac', type: '' })).toBe(true)
    expect(looksLikeAudio({ name: 'C.OPUS', type: '' })).toBe(true)
    expect(looksLikeAudio({ name: 'voice', type: 'audio/ogg' })).toBe(true)
    expect(looksLikeAudio({ name: 'track.m4a', type: 'video/mp4' })).toBe(true)
  })

  it('leaves out what is not', () => {
    expect(looksLikeAudio({ name: 'cover.jpg', type: 'image/jpeg' })).toBe(false)
    expect(looksLikeAudio({ name: 'notes.txt', type: 'text/plain' })).toBe(false)
    expect(looksLikeAudio({ name: 'Album', type: '' })).toBe(false)
  })
})

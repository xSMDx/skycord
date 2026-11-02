/**
 * Several songs going up, one after another, under a server that takes 20 a
 * minute.
 *
 * Two layers. The decisions are pure functions of the queue and the clock:
 * which file goes next (nextAction), what one try's answer means (judge), and
 * how long a 429 says to wait (retryAfterMs). The queue below acts on them
 * and owns the only side effects — a timer, an AbortController per try, and
 * the list it keeps up to date — with the sending itself handed in, so it
 * runs under fake timers against a fake server exactly as it runs against
 * XHR. It knows nothing of Vue: give it a reactive array and the rows render.
 *
 * A lost connection holds the batch rather than failing it: the file that
 * could not get through goes back to the head of the line, nothing more goes
 * out, and Retry — or the browser saying it is online again — carries on.
 * Failing it would fail every file after it too, in the second the network
 * was gone, and throw away the files with them.
 *
 * One at a time, on purpose. The server would take a few in parallel, but the
 * limit is per member, so parallel uploads only reach it sooner; and one bar
 * moving at a time reads as progress where five crawling together read as a
 * stall.
 */

export type UploadState = 'waiting' | 'uploading' | 'converting' | 'done' | 'failed' | 'limited'

export type UploadItem = {
  id: string
  name: string
  state: UploadState
  /** 0–100. Held at 95 while the server checks and converts: the bytes being
   *  sent is not the work being done. */
  pct: number
  error?: string
  /** While limited: when the next try goes out, in ms since the epoch. */
  retryAt?: number
}

/** Response headers by name, in whatever case they came. */
export type RateHeaders = Record<string, string | undefined>

/** What one try came back with. status 0 means it never reached the server. */
export type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; headers: RateHeaders; message: string }

export const RETRY_FALLBACK_MS = 60_000
/** A 429 that said "now" would be asked again in a hot loop. */
const MIN_WAIT_MS = 1000
/** No limit of ours runs longer; a header that says a day is a mistake. */
const MAX_WAIT_MS = 15 * 60_000
/** How long a finished row stays to say so before it clears itself. */
export const DONE_LINGER_MS = 3000
export const NOT_REACHED = 'That upload did not reach the server.'
/** The one line the list shows while the batch is held. */
export const HELD_SAYS = 'Couldn’t reach the server'

const clampWait = (ms: number): number => Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.round(ms)))
const seconds = (s: string): number | null => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null)

/**
 * How long a 429 asks us to wait, in ms.
 *
 * Retry-After first: it is the one answer HTTP defines, as seconds or as an
 * HTTP date. Then RateLimit-Reset, which express-rate-limit sends as seconds
 * left in the window (draft 6) — though some servers send the epoch second the
 * window ends, and no window is fifty years long, so a number that size is
 * read as a moment. Neither readable: a minute, the length of our window.
 */
export const retryAfterMs = (headers: RateHeaders, now: number): number => {
  const h: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (v != null && v.trim()) h[k.toLowerCase()] = v.trim()

  const after = h['retry-after']
  if (after !== undefined) {
    const s = seconds(after)
    if (s !== null) return clampWait(s * 1000)
    const at = Date.parse(after)
    if (!Number.isNaN(at)) return clampWait(at - now)
  }
  const reset = h['ratelimit-reset']
  if (reset !== undefined) {
    const s = seconds(reset)
    if (s !== null) return clampWait(s > 1e9 ? s * 1000 - now : s * 1000)
  }
  return RETRY_FALLBACK_MS
}

export type Verdict =
  | { kind: 'done' }
  /** The limit: the same file again once it lifts. */
  | { kind: 'retry'; at: number }
  | { kind: 'failed'; error: string }
  /** The connection: the same file again, but only once someone says go. */
  | { kind: 'held' }

/**
 * What one try's answer means for that file. A 429 is the server's limit, not
 * the file's fault: wait, then the same file again. Anything else that is not
 * a success — a 413, a file that is not audio, a full library — fails that
 * file alone, in the server's words, and the queue moves on.
 *
 * A try that never reached the server is not the file's fault either, nor
 * something a wait of known length will fix: it holds the batch. Unless it
 * was stopped on purpose — a dropped file, a sign-out — which also answers
 * status 0, and must not hold up what comes after it.
 */
export const judge = <T>(a: Attempt<T>, now: number, how: { stopped?: boolean } = {}): Verdict => {
  if (a.ok) return { kind: 'done' }
  if (a.status === 429) return { kind: 'retry', at: now + retryAfterMs(a.headers, now) }
  if (a.status === 0) return how.stopped ? { kind: 'failed', error: NOT_REACHED } : { kind: 'held' }
  return { kind: 'failed', error: a.message || 'That file could not be added.' }
}

export type Next =
  | { kind: 'busy' }
  | { kind: 'idle' }
  | { kind: 'held' }
  | { kind: 'wait'; id: string; until: number }
  | { kind: 'start'; id: string }

const inFlight = (s: UploadState): boolean => s === 'uploading' || s === 'converting'
const pending = (s: UploadState): boolean => s === 'waiting' || s === 'limited'

/** The next thing to do, given the rows, when the limit lifts, the time, and
 *  whether a lost connection is holding the batch. */
export const nextAction = (items: readonly UploadItem[], gateUntil: number, now: number, held = false): Next => {
  if (items.some(i => inFlight(i.state))) return { kind: 'busy' }
  const head = items.find(i => pending(i.state))
  if (!head) return { kind: 'idle' }
  if (held) return { kind: 'held' }
  if (now < gateUntil) return { kind: 'wait', id: head.id, until: gateUntil }
  return { kind: 'start', id: head.id }
}

// ── what can go up ──────────────────────────────────────────────────────────

/** The file picker's filter. Shared, so a drop takes what the picker offers. */
export const AUDIO_ACCEPT = 'audio/*,.mp3,.flac,.ogg,.opus,.wav,.m4a,.aac'
const AUDIO_EXT = /\.(mp3|flac|ogg|opus|wav|m4a|aac)$/i

/** Audio by its type, or by a name the picker would offer — Windows often
 *  gives .flac and .opus no type at all, and .m4a arrives as video/mp4. */
export const looksLikeAudio = (f: { name: string; type: string }): boolean =>
  f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)

// ── the queue ───────────────────────────────────────────────────────────────

export type QueueOptions<T> = {
  /** The rows. Pass a reactive array and they render as they change. */
  items: UploadItem[]
  /** Files done of files in this batch, for "3 of 8 uploaded". A batch starts
   *  when files are added to a queue with nothing left to send. `held`: a try
   *  could not reach the server, and nothing goes out until resume(). */
  batch: UploadBatch
  /** One try. `progress` takes the fraction of bytes sent; 1 means all of
   *  them, and the server is now checking and converting. */
  send: (file: File, progress: (fraction: number) => void, signal: AbortSignal) => Promise<Attempt<T>>
  /** A file went up. Called even if its row was dropped as the answer came:
   *  the song is in the library either way. */
  uploaded: (value: T) => void
  /** A reason to fail a file before sending it, or null to send it. */
  refuse?: (file: File) => string | null
  lingerMs?: number
}

export type UploadBatch = { total: number; done: number; held: boolean }

export type UploadQueue = {
  enqueue: (files: File[]) => void
  /** Drop a row. A file still waiting is skipped; one going up is stopped. One
   *  the server is already checking and converting cannot be called back, so
   *  it stays and this answers false. */
  drop: (id: string) => boolean
  /** Stop everything and forget it all — signing out. An answer still on its
   *  way is ignored, even a success. */
  clear: () => void
  /** Carry on after a lost connection: the held file goes again first. */
  resume: () => void
}

export const createUploadQueue = <T>(o: QueueOptions<T>): UploadQueue => {
  const { items, batch } = o
  const lingerMs = o.lingerMs ?? DONE_LINGER_MS
  const files = new Map<string, File>()
  const stops = new Map<string, AbortController>()
  const lingering = new Map<string, ReturnType<typeof setTimeout>>()
  let gateUntil = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Bumped by clear(), so a try from before it cannot touch what comes after. */
  let era = 0
  let seq = 0

  const find = (id: string): UploadItem | undefined => items.find(i => i.id === id)
  const remove = (id: string): void => {
    const at = items.findIndex(i => i.id === id)
    if (at >= 0) items.splice(at, 1)
    files.delete(id)
    const t = lingering.get(id)
    if (t) { clearTimeout(t); lingering.delete(id) }
  }

  const pump = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    const now = Date.now()
    const next = nextAction(items, gateUntil, now, batch.held)
    // Nothing left to send: nothing to hold, and no line asking for a Retry.
    if (next.kind === 'idle') batch.held = false
    // Only the file at the head is waiting for the limit; the rest are just
    // waiting. A drop or a retry can move the head, so this is re-said each time.
    for (const it of items) {
      const head = next.kind === 'wait' && it.id === next.id
      if (it.state === 'limited' && !head) { it.state = 'waiting'; delete it.retryAt }
    }
    if (next.kind === 'wait') {
      const it = find(next.id)
      if (it) { it.state = 'limited'; it.retryAt = next.until }
      timer = setTimeout(pump, next.until - now)
    } else if (next.kind === 'start') {
      void run(next.id)
    }
  }

  const run = async (id: string): Promise<void> => {
    const it = find(id)
    const file = files.get(id)
    if (!it || !file) { remove(id); pump(); return }
    it.state = 'uploading'
    it.pct = 0
    delete it.retryAt
    delete it.error
    const stop = new AbortController()
    stops.set(id, stop)
    const mine = era

    const progress = (fraction: number): void => {
      const row = find(id)
      if (!row || mine !== era || row.state !== 'uploading') return
      if (fraction >= 1) { row.state = 'converting'; row.pct = 95 }
      else row.pct = Math.min(95, Math.round(Math.max(0, fraction) * 95))
    }

    let answer: Attempt<T>
    try {
      answer = await o.send(file, progress, stop.signal)
    } catch {
      answer = { ok: false, status: 0, headers: {}, message: '' }
    }
    stops.delete(id)
    if (mine !== era) return

    if (answer.ok) o.uploaded(answer.value)
    const row = find(id)
    const v = judge(answer, Date.now(), { stopped: stop.signal.aborted || !row })
    // The limit is the server's, not the file's: it holds for whatever goes
    // next, even if this row was dropped as the 429 came back.
    if (v.kind === 'retry') gateUntil = v.at
    if (row) {
      if (v.kind === 'done') {
        row.state = 'done'
        row.pct = 100
        files.delete(id)
        batch.done++
        lingering.set(id, setTimeout(() => { lingering.delete(id); if (find(id)?.state === 'done') remove(id) }, lingerMs))
      } else if (v.kind === 'retry') {
        // Back in line at the head; pump() marks it limited until gateUntil.
        row.state = 'waiting'
        row.pct = 0
      } else if (v.kind === 'held') {
        // Back at the head with its File kept, saying why it has not gone.
        row.state = 'waiting'
        row.pct = 0
        row.error = NOT_REACHED
        batch.held = true
      } else {
        row.state = 'failed'
        row.error = v.error
        files.delete(id)
      }
    }
    pump()
  }

  const enqueue = (list: File[]): void => {
    if (!list.length) return
    if (!items.some(i => pending(i.state) || inFlight(i.state))) { batch.total = 0; batch.done = 0 }
    for (const file of list) {
      const id = `up-${++seq}`
      const refused = o.refuse?.(file) ?? null
      if (refused) items.push({ id, name: file.name, state: 'failed', pct: 0, error: refused })
      else { items.push({ id, name: file.name, state: 'waiting', pct: 0 }); files.set(id, file) }
      batch.total++
    }
    pump()
  }

  const drop = (id: string): boolean => {
    const it = find(id)
    if (!it) return false
    if (it.state === 'converting') return false
    // A file that will now never go up leaves the count; a finished or failed
    // one already had its turn and stays counted.
    if (pending(it.state) || it.state === 'uploading') batch.total = Math.max(batch.done, batch.total - 1)
    const stop = stops.get(id)
    remove(id)
    stop?.abort()
    pump()
    return true
  }

  const clear = (): void => {
    era++
    if (timer) { clearTimeout(timer); timer = null }
    for (const t of lingering.values()) clearTimeout(t)
    lingering.clear()
    const inFlightNow = [...stops.values()]
    stops.clear()
    files.clear()
    items.splice(0, items.length)
    batch.total = 0
    batch.done = 0
    batch.held = false
    gateUntil = 0
    for (const s of inFlightNow) s.abort()
  }

  const resume = (): void => {
    batch.held = false
    pump()
  }

  return { enqueue, drop, clear, resume }
}

// ── what to say aloud ───────────────────────────────────────────────────────

/** What a list of rows looked like, to tell what has changed since. */
export type Snapshot = { states: ReadonlyMap<string, UploadState>; held: boolean }

export const snapshot = (items: readonly UploadItem[], batch: UploadBatch): Snapshot =>
  ({ states: new Map(items.map(i => [i.id, i.state])), held: batch.held })

const sentence = (s: string): string => (/[.…!?]$/.test(s) ? s : `${s}.`)

/**
 * What a screen reader should hear about the change from `before` to now, or
 * '' for nothing. Only what someone not looking would want to know: the limit
 * being waited out, a file in, a file refused and why, the connection lost,
 * and — with a file in — how far the batch has got. Progress is not said;
 * the bar carries it, and twenty per cent steps read aloud are noise.
 */
export const announcement = (before: Snapshot, items: readonly UploadItem[], batch: UploadBatch): string => {
  const lines: string[] = []
  let landed = false
  for (const it of items) {
    if (before.states.get(it.id) === it.state) continue
    if (it.state === 'limited') lines.push('Waiting for the upload limit…')
    else if (it.state === 'done') { lines.push(`${it.name} added to your library`); landed = true }
    else if (it.state === 'failed') lines.push(it.error ? `${it.name} failed: ${it.error}` : `${it.name} failed`)
  }
  if (batch.held && !before.held) lines.push(HELD_SAYS)
  if (landed && batch.total > 1) lines.push(`${batch.done} of ${batch.total} uploaded`)
  return [...new Set(lines)].map(sentence).join(' ')
}

/** How soon after one line another joins it rather than replacing it. */
export const FOLLOW_ON_MS = 1000

/**
 * The live region's lines after a new one, said `now`, the last at `lastAt`.
 * Replacing the words a moment after they were set loses them: a reader is
 * still on the first when the second lands. So a line within FOLLOW_ON_MS of
 * the last is added after it, and only a line after a pause starts afresh.
 */
export const followOn = <L>(lines: readonly L[], line: L, now: number, lastAt: number): L[] =>
  now - lastAt < FOLLOW_ON_MS ? [...lines, line] : [line]

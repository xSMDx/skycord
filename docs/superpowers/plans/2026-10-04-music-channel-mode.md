# Music Channel Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While you are tuned into a music channel, the music room behaves like a shared session: clicking a song adds it to the channel, nothing takes you out of the channel without asking, anyone can move the song to any point or play any queued song now, and the virus-check marks line up.

**Architecture:** The server's per-channel state gains stable queue entry ids, `seek` and `playNow`. The music service learns to start a track at an offset (`-ss` after `-i`, so a pipe works). The client gets one gate — `okToPlaySolo` in the player — that every solo-play entry point passes through; it asks via a shared `leavePrompt` and leaves the channel on yes. The modal reads "am I tuned in" once and switches row clicks, the row menu, the bar and a banner into channel mode.

**Tech Stack:** Vue 3 + TS (client), Express + Socket.IO + Mongoose (API), Node http + ffmpeg + @livekit/rtc-node (music service), Vitest, Playwright probes.

## What was found (evidence, 2026-10-04)

- **Clicking a song while tuned in silently leaves the channel.** Reproduced in a real call: before click `cardOn: true`; after clicking a library row `cardOn: false, bar: "Only you"`, solo audio playing. Cause: `playFrom → act → takeAudio('preview')` yields the channel, whose yielder is `listenToMusic(null)` (`src/composables/useMusic.ts`, `onYield('channel', …)`). No prompt anywhere.
- **Seeking a solo song works.** Measured on the element with a 180s track: click at 75% → `t: 138.1`; drag to 25% → `t: 44.2`; arrows → `+1s` each; `seekable: [[0,180]]`. The stored WebM has cues.
- **Seeking a shared song is impossible.** The live bar is a `<span>`, and the service can only start a track from 0 (`music/src/decode.ts` `ffmpegArgs()` takes no offset; `/play` and `/play-track` take no position).
- **Jumping to a song in the shared queue is impossible.** Only `music:skip` exists; queue entries have no id to address.
- **Shields misalign.** `ShieldAlert` follows `.mm-names` inline in `.mm-cell`, so it sits wherever each title ends.
- The recurring console 401 is `POST /auth/refresh` on the sign-in page before any session exists. Expected; not a bug.

## Global Constraints

- Never put the Iran host address in docs, changelog, README, landing or commit messages.
- Stage files by name; never `git add -A` (other sessions' untracked files live in this tree). Never bare `git stash`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally; push only when the owner says so.
- Design system tests are enforced: no hardcoded colours, durations from `--dur-*` tokens (named exceptions only), an accent background declares `--text-on-accent` in the same rule, only existing tokens, 40px touch targets under 768px, selection is a ring not a fill.
- ffmpeg argv must never contain member input. The only variable entry allowed is a start offset that is a whole number of seconds by construction.
- Shared actions (seek, play now, skip) are open to anyone in the call, matching skip today. They are rate limited by the existing `musicRate`.
- Server tests need: `MONGO_URI TEST_MONGO_URI JWT_ACCESS_SECRET JWT_REFRESH_SECRET LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET` (values in `.github/workflows/ci.yml`).

## File map

| File | Change |
|---|---|
| `server/sockets/musicState.ts` | `entryId` on `Track`, `id` on `MusicEntryView`, `seek()`, `playNow()` |
| `server/__tests__/musicState.test.ts` | tests for the above |
| `music/src/decode.ts` | `MAX_START_SEC`, `startOffset()`, `ffmpegArgs(startSec)`, `DecodeOptions.startSec` |
| `music/src/publisher.ts` | `play(room, channelId, body, startSec = 0)` |
| `music/src/server.ts` | `/play` and `/play-track` accept and validate `startSec` |
| `music/__tests__/decode.test.ts`, `music/__tests__/server.test.ts` | offset tests, incl. a real ffmpeg decode |
| `server/utils/musicService.ts` | `musicPlay`/`musicPlayTrack` take `startSec` |
| `server/sockets/chatSocket.ts` | `startSource(…, startSec)`, `music:seek`, `music:play-now` |
| `server/__tests__/musicSockets.test.ts` | socket tests for seek and play-now |
| `src/composables/leavePrompt.ts` (new) | the one question: leave this channel? |
| `src/composables/useMusic.ts` | `id` on entries, `seekMusic`, `playNowMusic` |
| `src/composables/useMusicPlayer.ts` | `okToPlaySolo` gate on every solo-play entry point |
| `src/composables/__tests__/leavePrompt.test.ts` (new), `musicClient.test.ts` | tests |
| `src/components/modals/ConfirmModal.vue` | optional `cancelLabel` |
| `src/views/ChatApp.vue` | mount the leave prompt |
| `src/components/music/MusicModal.vue` | channel mode: banner, row click → channel, row menu, seekable live bar, "Leave channel", shield column |
| `src/components/music/MusicCallRail.vue` | play-now on queue rows, show the whole queue |
| `src/components/music/MiniPlayer.vue` | leave tooltip says "Leave channel" |

---

### Task 1: Server state — entry ids, seek, play now

**Files:**
- Modify: `server/sockets/musicState.ts`
- Test: `server/__tests__/musicState.test.ts`

**Interfaces:**
- Produces: `Track.entryId: string`; `MusicEntryView.id: string`; `MusicRooms.seek(room, channelId, sec: unknown): Check & { now?: Track; sec?: number }`; `MusicRooms.playNow(room, channelId, entryId: string): Check & { now?: Track }`; exported `MAX_SEEK_SEC = 21600`.

- [ ] **Step 1: Write the failing tests** — append to `server/__tests__/musicState.test.ts` (it already has a `rooms` factory with an injected clock; reuse it the way the "what a listener is told" block does):

```ts
describe('moving through a shared song', () => {
  const lib = (title: string, durationSec = 200) => ({
    kind: 'library' as const, trackId: 'a'.repeat(24), title, artist: 'X', durationSec, cover: null,
  })

  it('gives every queued entry a stable id', () => {
    const { m } = clockRooms()
    const { id } = m.create('r', 'C', lib('One'), 'u1')
    m.queue('r', id!, lib('Two'), 'u1'); m.queue('r', id!, lib('Three'), 'u2')
    const q = m.view('r').channels[0].queue
    expect(q.map(e => e.id)).toHaveLength(2)
    expect(new Set(q.map(e => e.id)).size).toBe(2)
    // Stable: the same entry keeps its id across views.
    expect(m.view('r').channels[0].queue[0].id).toBe(q[0].id)
  })

  it('seek moves the clock for everyone', () => {
    const { m, tick } = clockRooms()
    const { id } = m.create('r', 'C', lib('One'), 'u1')
    tick(10_000)
    const r = m.seek('r', id!, 120)
    expect(r.ok).toBe(true)
    expect(r.sec).toBe(120)
    expect(m.view('r').channels[0].now?.elapsedMs).toBe(120_000)
  })

  it('seek clamps to the last second of a known length', () => {
    const { m } = clockRooms()
    const { id } = m.create('r', 'C', lib('One', 200), 'u1')
    expect(m.seek('r', id!, 999).sec).toBe(199)
  })

  it('seek floors to whole seconds', () => {
    const { m } = clockRooms()
    const { id } = m.create('r', 'C', lib('One'), 'u1')
    expect(m.seek('r', id!, 42.9).sec).toBe(42)
  })

  it('seek refuses nonsense and an idle channel', () => {
    const { m } = clockRooms()
    const { id } = m.create('r', 'C', lib('One'), 'u1')
    for (const bad of [-1, Number.NaN, Infinity, '30', null, undefined]) {
      expect(m.seek('r', id!, bad).ok).toBe(false)
    }
    m.skip('r', id!)                       // queue empty → nothing playing
    expect(m.seek('r', id!, 10).ok).toBe(false)
    expect(m.seek('r', 'nope', 10).ok).toBe(false)
  })

  it('play now takes that entry out and keeps the rest in order', () => {
    const { m, tick } = clockRooms()
    const { id } = m.create('r', 'C', lib('One'), 'u1')
    for (const t of ['Two', 'Three', 'Four']) m.queue('r', id!, lib(t), 'u1')
    const three = m.view('r').channels[0].queue[1].id
    tick(50_000)
    const r = m.playNow('r', id!, three)
    expect(r.ok).toBe(true)
    const v = m.view('r').channels[0]
    expect(v.now?.title).toBe('Three')
    expect(v.now?.elapsedMs).toBe(0)
    expect(v.queue.map(e => e.title)).toEqual(['Two', 'Four'])
  })

  it('play now refuses an entry that is gone', () => {
    const { m } = clockRooms()
    const { id } = m.create('r', 'C', lib('One'), 'u1')
    expect(m.playNow('r', id!, 'not-an-entry').ok).toBe(false)
  })
})
```

If the file has no `clockRooms` helper, add it at the top of this block:

```ts
const clockRooms = () => {
  let t = 1_000_000
  const m = new MusicRooms({ ...DEFAULT_TEST_CAPS }, () => {}, () => t)
  return { m, tick: (ms: number) => { t += ms } }
}
```
(use whatever caps object the file already builds its rooms with in place of `DEFAULT_TEST_CAPS`).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run server/__tests__/musicState.test.ts`
Expected: FAIL — `m.seek is not a function`, `id` undefined.

- [ ] **Step 3: Implement** in `server/sockets/musicState.ts`:

```ts
export type Track = Source & {
  /** Addresses this entry for "play now", and survives the queue shifting under a click. */
  entryId: string
  addedBy: string
  addedAt: number
}

export interface MusicEntryView {
  id: string
  kind: 'link' | 'library'
  title: string | null
  artist: string | null
  durationSec: number | null
  addedBy: string
}

/** No real song is six hours long; past this a position is a typo or an attack. */
export const MAX_SEEK_SEC = 6 * 60 * 60

const entry = (t: Track): MusicEntryView => ({
  id: t.entryId,
  kind: t.kind,
  title: t.kind === 'library' ? t.title : null,
  artist: t.kind === 'library' ? (t.artist || null) : null,
  durationSec: t.kind === 'library' ? t.durationSec : null,
  addedBy: t.addedBy,
})
```

In `create`: `const track: Track = { ...source, entryId: randomUUID(), addedBy: by, addedAt: this.now() }`.
In `queue`: `channel.queue.push({ ...source, entryId: randomUUID(), addedBy: by, addedAt: this.now() })`.

New methods after `skip`:

```ts
  /** Move the playing song to `sec` for everyone. Answers with the position actually used. */
  seek(room: string, channelId: string, sec: unknown): Check & { now?: Track; sec?: number } {
    const channel = this.get(room, channelId)
    if (!channel) return no('That music channel is gone.')
    if (!channel.now) return no('Nothing is playing there.')
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0 || sec > MAX_SEEK_SEC) {
      return no('That is not a point in the song.')
    }
    const d = channel.now.kind === 'library' ? channel.now.durationSec : null
    const at = Math.floor(d ? Math.min(sec, Math.max(0, d - 1)) : sec)
    channel.startedAt = this.now() - at * 1000
    return { ok: true, now: channel.now, sec: at }
  }

  /** Play one queued entry now. What was playing ends; the rest keep their order. */
  playNow(room: string, channelId: string, entryId: string): Check & { now?: Track } {
    const channel = this.get(room, channelId)
    if (!channel) return no('That music channel is gone.')
    const i = channel.queue.findIndex(t => t.entryId === entryId)
    if (i < 0) return no('That song is not in the queue any more.')
    const [t] = channel.queue.splice(i, 1)
    channel.now = t
    channel.startedAt = this.now()
    return { ok: true, now: t }
  }
```

- [ ] **Step 4: Run and pass**

Run: `npx vitest run server/__tests__/musicState.test.ts` → all pass. Also `npx tsc --noEmit -p tsconfig.server.json` → clean (fix any test fixture that builds a `Track` by hand by adding `entryId`).

- [ ] **Step 5: Commit**

```bash
git add server/sockets/musicState.ts server/__tests__/musicState.test.ts
git commit -m "Music state: queue entry ids, seek and play-now for a shared channel"
```

---

### Task 2: Music service — start a track at an offset

**Files:**
- Modify: `music/src/decode.ts`, `music/src/publisher.ts`, `music/src/server.ts`
- Test: `music/__tests__/decode.test.ts`, `music/__tests__/server.test.ts`

**Interfaces:**
- Produces: `MAX_START_SEC = 21600`; `startOffset(v: unknown): number` (a valid whole second in `1..MAX_START_SEC`, else 0); `ffmpegArgs(startSec = 0): string[]`; `DecodeOptions.startSec?: number`; `MusicPublisher.play(room, channelId, body, startSec = 0)`; HTTP `/play` `{room, channelId, url, startSec?}` and `/play-track` `{room, channelId, trackId, startSec?}` → 400 when `startSec` is present and not a whole number in range.

- [ ] **Step 1: Failing tests** — `music/__tests__/decode.test.ts`, new describe:

```ts
describe('starting part-way in', () => {
  it('adds no offset at the start', () => {
    expect(ffmpegArgs()).not.toContain('-ss')
    expect(ffmpegArgs(0)).toEqual(ffmpegArgs())
  })

  it('puts the offset after the input, so a pipe can be sought by decoding', () => {
    const a = ffmpegArgs(83)
    expect(a[a.indexOf('-ss') + 1]).toBe('83')
    expect(a.indexOf('-ss')).toBeGreaterThan(a.indexOf('-i'))
  })

  it('never lets anything but a whole number of seconds into argv', () => {
    for (const bad of [12.5, -3, MAX_START_SEC + 1, '5; rm -rf /', NaN, null, {}]) {
      expect(ffmpegArgs(bad as never)).not.toContain('-ss')
    }
    expect(startOffset(MAX_START_SEC)).toBe(MAX_START_SEC)
  })
})
```

plus a real decode (ffmpeg is installed in CI's image build and locally; the file's existing `decode()` tests already need it):

```ts
/** A WAV of `sec` seconds of silence, built in memory: no fixture file, no ffmpeg to make it. */
const wav = (sec: number): Buffer => {
  const rate = 48_000, ch = 2, data = rate * ch * 2 * sec
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(data, 40)
  return b
}

it('really starts late: 3s from 2s in is 1s of frames', async () => {
  const d = decode(Readable.from([wav(3)]), { startSec: 2 })
  let n = 0
  for await (const _ of frames(d.pcm)) n++
  await d.done
  // 50 frames per second; allow one frame either side for codec edges.
  expect(n).toBeGreaterThanOrEqual(49)
  expect(n).toBeLessThanOrEqual(51)
}, 20_000)
```

`music/__tests__/server.test.ts`: make the stub record the offset — change the stub's play to

```ts
  play: async (room: string, id: string, _body: unknown, startSec = 0) => {
    calls.push(`play ${room}/${id}${startSec ? ` @${startSec}` : ''}`); return 'ended' as const
  },
```

and add:

```ts
describe('starting at an offset', () => {
  it('refuses a startSec that is not a whole number of seconds', async () => {
    for (const startSec of [1.5, -1, 'ten', 999_999]) {
      const r = await post('/play-track', { room: 'r', channelId: 'c', trackId: 'a'.repeat(24), startSec }, SECRET)
      expect(r.status).toBe(400)
    }
  })

  it('accepts a whole number', async () => {
    const r = await post('/play', { room: 'r', channelId: 'c', url: 'https://x/a.mp3', startSec: 30 }, SECRET)
    expect(r.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run music/__tests__/decode.test.ts music/__tests__/server.test.ts` → FAIL (`startOffset` not exported; 400s answered 200).

- [ ] **Step 3: Implement**

`music/src/decode.ts`:

```ts
/** The furthest in a track may start. No song is six hours long. */
export const MAX_START_SEC = 6 * 60 * 60

/**
 * A start offset fit for argv, or 0.
 *
 * The one variable entry ffmpeg ever gets, and it is safe by construction:
 * only an integer in range survives, and String() of an integer is digits.
 */
export const startOffset = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_START_SEC ? v : 0

export const ffmpegArgs = (startSec: number = 0): string[] => {
  const at = startOffset(startSec)
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', 'pipe:0',       // the fetched body, never a URL or a path
    // After -i, not before: a pipe cannot be sought, so ffmpeg decodes and
    // discards up to here. Opus decodes far faster than real time, so even
    // the end of a long song is reached in about a second.
    ...(at ? ['-ss', String(at)] : []),
    '-vn',                // an mp3 can carry cover art; we want none of it
    '-f', 's16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS),
    'pipe:1',
  ]
}
```

Update the comment above `ffmpegArgs` ("Nothing here is interpolated…") to say the start offset is the single exception and why it is safe. Add `startSec?: number` to `DecodeOptions` and call `ffmpegArgs(opts.startSec)` in `decode()`.

`music/src/publisher.ts`: `async play(roomName, channelId, body, startSec = 0)` and pass `startSec` into `decode(body, { ffmpegPath…, onStderr…, startSec })`.

`music/src/server.ts`: import `startOffset` from `./decode.js`; add

```ts
/** startSec from a request: absent is 0; present must be a whole number in range. */
const readStart = (v: unknown): number | null =>
  v === undefined || v === 0 ? 0 : (startOffset(v) || null)
```

`start(room, channelId, url, startSec)` and `startTrack(room, channelId, trackId, startSec)` pass it to `pub.play(…, startSec)` and, when non-zero, `log(\`${room}/${channelId}: starting at ${startSec}s\`)`. In both routes, after the required-fields check:

```ts
          const startSec = readStart((b as { startSec?: unknown }).startSec)
          if (startSec === null) return fail(res, 400, 'startSec must be a whole number of seconds')
```

- [ ] **Step 4: Run and pass** — the two files, then `npx tsc --noEmit -p tsconfig.music.json` and `npm --prefix music run build` (the dev service runs `music/dist`).

- [ ] **Step 5: Commit**

```bash
git add music/src/decode.ts music/src/publisher.ts music/src/server.ts music/__tests__/decode.test.ts music/__tests__/server.test.ts
git commit -m "Music service: start a track part-way in"
```

---

### Task 3: API wiring — seek and play-now over the socket

**Files:**
- Modify: `server/utils/musicService.ts`, `server/sockets/chatSocket.ts`
- Test: `server/__tests__/musicSockets.test.ts`

**Interfaces:**
- Consumes: Task 1 `seek`, `playNow`; Task 2 `startSec` on the service routes.
- Produces: socket events `music:seek {conversationId, kind, channelId, sec}` and `music:play-now {conversationId, kind, channelId, entryId}`; both answer with a `music:state` broadcast, or `music:error` to the asker.

- [ ] **Step 1: Failing socket tests** (in the existing `library tracks` style, using `inCall`, `musicStateWhere`, `giveTrack`):

```ts
describe('moving through a shared song', () => {
  it('seek moves everyone, and says so', async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id); const sb = await inCall(b, voice.id)
    const id = await giveTrack(a, 'Long One')        // durationSec 270
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: id })
    const v = await musicStateWhere(sb, x => x.channels.length === 1)
    sb.emit('music:seek', { conversationId: voice.id, kind: 'channel', channelId: v.channels[0].id, sec: 120 })
    const after = await musicStateWhere(sa, x => (x.channels[0]?.now as { elapsedMs?: number })?.elapsedMs! >= 119_000)
    expect((after.channels[0].now as { elapsedMs: number }).elapsedMs).toBeLessThan(125_000)
  })

  it('refuses a seek that is not a number', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const id = await giveTrack(a)
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: id })
    const v = await musicStateWhere(sa, x => x.channels.length === 1)
    sa.emit('music:seek', { conversationId: voice.id, kind: 'channel', channelId: v.channels[0].id, sec: 'soon' })
    const err = await nextEvent(sa, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/point in the song/i)
  })

  it('play now plays that entry for everyone and keeps the rest', async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id); const sb = await inCall(b, voice.id)
    const [one, two, three] = [await giveTrack(a, 'One'), await giveTrack(a, 'Two'), await giveTrack(a, 'Three')]
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    const v = await musicStateWhere(sa, x => x.channels.length === 1)
    const ch = v.channels[0].id
    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: two })
    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: three })
    const q = await musicStateWhere(sb, x => (x.channels[0] as { queue?: unknown[] }).queue?.length === 2)
    const third = (q.channels[0] as unknown as { queue: { id: string }[] }).queue[1].id
    sb.emit('music:play-now', { conversationId: voice.id, kind: 'channel', channelId: ch, entryId: third })
    const after = await musicStateWhere(sa, x => (x.channels[0].now as { title?: string })?.title === 'Three')
    expect((after.channels[0] as unknown as { queue: { title: string }[] }).queue.map(e => e.title)).toEqual(['Two'])
  })
})
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run server/__tests__/musicSockets.test.ts` (with the CI env vars) → the three new tests time out (no handler).

- [ ] **Step 3: Implement**

`server/utils/musicService.ts`:

```ts
/** Start (or replace) what is playing on a channel, optionally part-way in. */
export const musicPlay = (room: string, channelId: string, url: string, startSec = 0): Promise<boolean> =>
  post('/play', { room, channelId, url, ...(startSec ? { startSec } : {}) })

export const musicPlayTrack = (room: string, channelId: string, trackId: string, startSec = 0): Promise<boolean> =>
  post('/play-track', { room, channelId, trackId, ...(startSec ? { startSec } : {}) })
```

`server/sockets/chatSocket.ts` — `startSource(room, channelId, now, startSec = 0)` passing `startSec` to both calls. Next to `music:skip`:

```ts
    // Anyone in the call may move the song, as anyone may skip it: a shared
    // channel has one position, and it belongs to the room.
    socket.on('music:seek', (data: { conversationId: string; kind: string; channelId: string; sec: unknown }) => {
      const gate = musicGate(data); if (!gate) return
      if (!musicRate.take(userId).ok) return musicRefuse('You are doing that too fast. Give it a moment.')
      const channelId = String(data?.channelId ?? '')
      const r = musicRooms.seek(gate.room, channelId, data?.sec)
      if (!r.ok) return musicRefuse(r.reason)
      broadcastMusic(gate.room)
      startSource(gate.room, channelId, r.now!, r.sec)
    })

    socket.on('music:play-now', (data: { conversationId: string; kind: string; channelId: string; entryId: string }) => {
      const gate = musicGate(data); if (!gate) return
      if (!musicRate.take(userId).ok) return musicRefuse('You are doing that too fast. Give it a moment.')
      const channelId = String(data?.channelId ?? '')
      const r = musicRooms.playNow(gate.room, channelId, String(data?.entryId ?? ''))
      if (!r.ok) return musicRefuse(r.reason)
      broadcastMusic(gate.room)
      startSource(gate.room, channelId, r.now!)
    })
```

Restarting a channel's playback on the service makes the old `play()` return `'replaced'`, which already suppresses its end report — so a seek never advances the queue.

- [ ] **Step 4: Run and pass** — the socket file, then the full server suite.

- [ ] **Step 5: Commit**

```bash
git add server/utils/musicService.ts server/sockets/chatSocket.ts server/__tests__/musicSockets.test.ts
git commit -m "Music: seek and play-now for everyone in a channel"
```

---

### Task 4: Client — the leave question and the solo gate

**Files:**
- Create: `src/composables/leavePrompt.ts`, `src/composables/__tests__/leavePrompt.test.ts`
- Modify: `src/composables/useMusic.ts`, `src/composables/useMusicPlayer.ts`, `src/composables/__tests__/musicClient.test.ts`

**Interfaces:**
- Produces: `leavePrompt: { open: boolean; channel: string; what: string }`; `askToLeave(channel: string, what: string): Promise<boolean>`; `answerLeave(yes: boolean): void`; `okToPlaySolo(what: string): Promise<boolean>` (exported from `useMusicPlayer`); `seekMusic(channelId: string, sec: number): void`; `playNowMusic(channelId: string, entryId: string): void`; `MusicEntryView.id: string`.

- [ ] **Step 1: Failing tests** — `src/composables/__tests__/leavePrompt.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { leavePrompt, askToLeave, answerLeave } from '../leavePrompt'

beforeEach(() => answerLeave(false))

describe('the leave question', () => {
  it('opens with the channel and what you were about to play', () => {
    void askToLeave('Chill', 'Foxtrot')
    expect(leavePrompt).toMatchObject({ open: true, channel: 'Chill', what: 'Foxtrot' })
  })

  it('answers yes and closes', async () => {
    const p = askToLeave('Chill', 'Foxtrot')
    answerLeave(true)
    await expect(p).resolves.toBe(true)
    expect(leavePrompt.open).toBe(false)
  })

  it('a second question answers the first one no', async () => {
    const first = askToLeave('Chill', 'A')
    const second = askToLeave('Chill', 'B')
    await expect(first).resolves.toBe(false)
    answerLeave(true)
    await expect(second).resolves.toBe(true)
  })

  it('answering twice is harmless', async () => {
    const p = askToLeave('Chill', 'A')
    answerLeave(true); answerLeave(false)
    await expect(p).resolves.toBe(true)
  })
})
```

In `musicClient.test.ts`, add:

```ts
describe('moving a shared song', () => {
  it('seek sends whole seconds', () => {
    seekMusic('a', 83.7)
    expect(emit).toHaveBeenCalledWith('music:seek', expect.objectContaining({ channelId: 'a', sec: 83 }))
  })
  it('play now sends the entry id', () => {
    playNowMusic('a', 'e1')
    expect(emit).toHaveBeenCalledWith('music:play-now', expect.objectContaining({ channelId: 'a', entryId: 'e1' }))
  })
})
```

(import `seekMusic, playNowMusic` at the top; give the `view()` fixture's queue entries an `id` where any exist.)

And a gate test, new file `src/composables/__tests__/soloGate.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit: vi.fn() }) }))
import { music, onMusicState, listenToMusic, setMusicTarget } from '../useMusic'
import { okToPlaySolo } from '../useMusicPlayer'
import { leavePrompt, answerLeave } from '../leavePrompt'

const one = { channels: [{ id: 'a', name: 'Chill', now: null, queue: [], queued: 0, listeners: [] }] }

beforeEach(() => {
  answerLeave(false)
  setMusicTarget({ conversationId: 'c1', kind: 'channel' })
  onMusicState(one); listenToMusic(null)
})

describe('playing just for you while in a channel', () => {
  it('needs no question when you are not in one', async () => {
    await expect(okToPlaySolo('Foxtrot')).resolves.toBe(true)
    expect(leavePrompt.open).toBe(false)
  })

  it('asks, and staying keeps you in', async () => {
    listenToMusic('a')
    const p = okToPlaySolo('Foxtrot')
    expect(leavePrompt).toMatchObject({ open: true, channel: 'Chill', what: 'Foxtrot' })
    answerLeave(false)
    await expect(p).resolves.toBe(false)
    expect(music.listeningTo).toBe('a')
  })

  it('leaving takes you out before anything plays', async () => {
    listenToMusic('a')
    const p = okToPlaySolo('Foxtrot')
    answerLeave(true)
    await expect(p).resolves.toBe(true)
    expect(music.listeningTo).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/composables/__tests__/leavePrompt.test.ts src/composables/__tests__/soloGate.test.ts src/composables/__tests__/musicClient.test.ts` → FAIL (modules/exports missing).

- [ ] **Step 3: Implement**

`src/composables/leavePrompt.ts`:

```ts
/**
 * The one question the music room asks: leave this channel?
 *
 * Playing something just for you while tuned into a channel takes you out
 * of it — one ear, one thing. That used to happen silently: click a song in
 * your library and the room's music vanished with no word about why. Now
 * every path that would do it stops here first.
 *
 * State, not a component, because the question can come from anywhere — a
 * row, the header, the queue drawer, a media key — and is drawn once, by
 * the shell.
 */
import { reactive } from 'vue'

export const leavePrompt = reactive({ open: false, channel: '', what: '' })

let pending: ((yes: boolean) => void) | null = null

export const askToLeave = (channel: string, what: string): Promise<boolean> => {
  // A second question while one is open answers the first one "no": two
  // dialogs stacked for one decision is never what anybody meant.
  pending?.(false)
  leavePrompt.channel = channel
  leavePrompt.what = what
  leavePrompt.open = true
  return new Promise(resolve => { pending = resolve })
}

export const answerLeave = (yes: boolean): void => {
  leavePrompt.open = false
  const r = pending
  pending = null
  r?.(yes)
}
```

`src/composables/useMusic.ts`: add `id: string` to `MusicEntryView`; add

```ts
/** Move the channel's song for everyone. Whole seconds: the server floors anyway. */
export const seekMusic = (channelId: string, sec: number): void =>
  send('music:seek', { channelId, sec: Math.floor(sec) })

/** Play one queued song now, for everyone. */
export const playNowMusic = (channelId: string, entryId: string): void =>
  send('music:play-now', { channelId, entryId })
```

`src/composables/useMusicPlayer.ts`: import `musicChannel, listenToMusic` from `./useMusic` and `askToLeave` from `./leavePrompt`, then:

```ts
/**
 * Before anything plays just for you: if you are in a channel, ask.
 *
 * Yes leaves the channel here, before the song is asked for, so the leave
 * cue lands first and nothing below has to know channels exist. No leaves
 * everything as it was — including the queue, which is why this runs
 * before a step is computed rather than inside act().
 */
export const okToPlaySolo = async (what: string): Promise<boolean> => {
  const ch = musicChannel.value
  if (!ch) return true
  if (!(await askToLeave(ch.name, what))) return false
  if (musicChannel.value?.id === ch.id) listenToMusic(null)
  return true
}
```

Gate every entry point that can start playback:

```ts
export const playFrom = async (tracks: LibTrack[], index: number, context: Q.QueueContext): Promise<void> => {
  const same = /* unchanged */
  if (same && !player.paused) return toggle()          // pausing never needs asking
  if (!(await okToPlaySolo(tracks[index]?.title ?? 'this song'))) return
  if (same) return toggle()
  return act(Q.start(queue, tracks, context, index, rng))
}

export const toggle = async (): Promise<void> => {
  if (!queue.current) return
  if (el?.src && !player.paused) { el.pause(); return }
  if (!(await okToPlaySolo(queue.current.title))) return
  if (!el?.src) { await act({ state: queue, track: queue.current, action: 'play' }); return }
  await safePlay()
}

export const next = async (): Promise<void> => {
  if (!(await okToPlaySolo('your own queue'))) return
  return act(Q.next(queue, 'skip', rng))
}
export const previous = async (): Promise<void> => {
  if (!(await okToPlaySolo('your own queue'))) return
  return act(Q.previous(queue, el?.currentTime ?? player.at))
}
export const jumpTo = async (target: Q.QueueTarget): Promise<void> => {
  if (!(await okToPlaySolo('your own queue'))) return
  return act(Q.jump(queue, target))
}
```

The `'ended'` auto-advance calls `act(Q.next(…))` directly and is not gated: it only fires while your own song is playing, which means you are not in a channel.

- [ ] **Step 4: Run and pass** — the three files, then `npx vitest run src/` and `npx vue-tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/composables/leavePrompt.ts src/composables/__tests__/leavePrompt.test.ts src/composables/__tests__/soloGate.test.ts src/composables/useMusic.ts src/composables/useMusicPlayer.ts src/composables/__tests__/musicClient.test.ts
git commit -m "Music: ask before playing just for you takes you out of a channel"
```

---

### Task 5: The leave dialog on screen

**Files:**
- Modify: `src/components/modals/ConfirmModal.vue`, `src/views/ChatApp.vue`

**Interfaces:**
- Consumes: Task 4 `leavePrompt`, `answerLeave`.
- Produces: `ConfirmModal` prop `cancelLabel?: string` (default `'Cancel'`).

- [ ] **Step 1: ConfirmModal** — add `cancelLabel?: string` to props with default `'Cancel'`, render `{{ cancelLabel }}` in the cancel button.

- [ ] **Step 2: ChatApp** — import `{ leavePrompt, answerLeave }` from `@/composables/leavePrompt`; after the existing `<ConfirmModal v-if="confirmState" …>` block (so it draws above the music room, which mounts earlier):

```vue
    <!-- Asked by the music room before playing something just for you would
         take you out of the channel you are tuned into. -->
    <ConfirmModal
      v-if="leavePrompt.open"
      :title="`Leave ${leavePrompt.channel}?`"
      :message="`You're listening to ${leavePrompt.channel} with the call. Playing “${leavePrompt.what}” just for you takes you out of it — the music keeps going for everyone else.`"
      confirm-label="Leave and play"
      cancel-label="Stay"
      @confirm="answerLeave(true)"
      @close="answerLeave(false)"
    />
```

- [ ] **Step 3: Verify** — `npx vue-tsc --noEmit`; `npx vitest run src/components/modals` (ConfirmModal tests still pass).

- [ ] **Step 4: Commit**

```bash
git add src/components/modals/ConfirmModal.vue src/views/ChatApp.vue
git commit -m "Music: the leave-channel warning"
```

---

### Task 6: The music room in channel mode

**Files:**
- Modify: `src/components/music/MusicModal.vue`

**Interfaces:**
- Consumes: `okToPlaySolo` (Task 4), `queueMusic`, `seekMusic`, `listenToMusic`, `live` (the existing `musicChannel` computed in this file).

- [ ] **Step 1: Banner + notice.** Inside `.mm-main`, above the header, when `live`:

```vue
        <!-- What changed and how to get out, said once at the top while it
             is true. Doubles as the live region for "added". -->
        <div v-if="live" class="mm-band" role="status" aria-live="polite">
          <span class="mm-banddot" aria-hidden="true" />
          <span class="mm-bandtext mm-ellip">
            {{ notice || `Listening with ${live.name} — click a song to add it to the channel's queue` }}
          </span>
          <button class="mm-bandleave" @click="listenToMusic(null)">
            <LogOut :size="13" :stroke-width="2.5" /> Leave channel
          </button>
        </div>
```

Script:

```ts
const notice = ref('')
let noticeT: ReturnType<typeof setTimeout> | null = null
const say = (m: string): void => {
  notice.value = m
  if (noticeT) clearTimeout(noticeT)
  noticeT = setTimeout(() => { notice.value = '' }, 3000)
}

/** In a channel, a song goes to the channel. You stay where you are. */
const addToChannel = (t: LibTrack): void => {
  if (!live.value) return
  queueMusic(live.value.id, { trackId: t.id })
  say(`Added “${t.title}” to ${live.value.name}`)
}
```

Styles (tokens only): `.mm-band` flex row, `padding: 8px 10px 8px 12px; margin: 12px 16px 0; border-radius: var(--edge-md); background: rgba(var(--accent-rgb), .12); color: var(--accent-text)`; `.mm-banddot` reuses the breathing dot (`mm-breathe`); `.mm-bandleave` a pill like `.mm-pill` with `margin-left: auto`; under 768px it is 40px tall.

- [ ] **Step 2: Row click and the number button.**

```ts
const playRow = (i: number): Promise<void> => {
  const t = shownTracks.value[i]
  if (live.value && t) { addToChannel(t); return Promise.resolve() }
  return playFrom(shownTracks.value, i, viewContext.value)
}
```

Number button: `:aria-label="live ? \`Add ${t.title} to ${live.name}\` : \`Play ${t.title}\`"`; icon `ListPlus` when `live`, otherwise the current Play/Pause/Loader logic.

- [ ] **Step 3: Row menu in channel mode.** At the top of `rowMenu`, when `live`:

```ts
  if (live.value) {
    const ch = live.value
    const others = music.channels.filter(c => c.id !== ch.id)
    const items: MenuItem[] = [
      { label: `Add to ${ch.name}`, icon: Radio, onSelect: () => addToChannel(t) },
      ...(others.length ? [{ label: 'Add to another channel', submenu: others.map(c => ({ label: c.name, onSelect: () => shareToChannel(c.id, t.id) })) }] : []),
      { label: 'Play just for me', icon: Play, onSelect: () => { void playFrom(shownTracks.value, i, viewContext.value) } },
      { label: 'Add to your own queue', icon: ListEnd, onSelect: () => addToQueue(t) },
    ]
    /* then the same playlist + remove/delete tail as below */
  }
```

Refactor the existing tail (Add to playlist, Remove/Delete) into `const tail = (t, i): MenuItem[]` used by both branches. "Play just for me" goes through `playFrom`, so the gate asks.

- [ ] **Step 4: A live bar you can move.** Replace the `.mm-livebar` span with a range that commits on release, so dragging does not restart the song on every pixel:

```vue
          <input
            class="mm-seek" type="range" min="0" step="1"
            :max="live.now?.durationSec || 1" :value="liveDrag ?? liveAt"
            :disabled="!live.now?.durationSec"
            :aria-label="`Move the song — for everyone in ${live.name}`"
            v-tip="'Moves the song for everyone listening'"
            @input="liveDrag = Number(($event.target as HTMLInputElement).value)"
            @change="commitLiveSeek"
          />
```

```ts
/** Where the thumb is while you drag; null when you are not dragging. */
const liveDrag = ref<number | null>(null)
const commitLiveSeek = (e: Event): void => {
  const v = Number((e.target as HTMLInputElement).value)
  liveDrag.value = null
  if (live.value) seekMusic(live.value.id, v)
}
```

The time on the left shows `clock(liveDrag ?? liveAt)`. A link with no known length keeps the bar disabled (there is no end to measure against). Remove the now-unused `.mm-livebar`/`.mm-livefill` styles and their duration-test exception.

Rename the bar's Leave pill text to "Leave channel".

- [ ] **Step 5: Shields in a column.** `.mm-names { flex: 1; }` so the title block takes the cell and the shield sits at its right edge on every row.

- [ ] **Step 6: Verify** — `npx vue-tsc --noEmit`; `npx vitest run src/styles src/components` (design tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/music/MusicModal.vue src/styles/__tests__/durationTokens.test.ts
git commit -m "Music room: channel mode, a movable shared bar, aligned scan marks"
```

---

### Task 7: The rail — play any queued song now

**Files:**
- Modify: `src/components/music/MusicCallRail.vue`, `src/components/music/MiniPlayer.vue`

- [ ] **Step 1: Rail.** Each up-next row gets a play button (visible on hover/focus with a fine pointer, always under 768px):

```vue
              <li v-for="e in shownQueue(c)" :key="e.id" class="cr-nextrow">
                <button
                  class="cr-playnow" :aria-label="`Play ${titleOf(e)} now, for everyone`"
                  v-tip="'Play now — for everyone listening'"
                  @click="playNowMusic(c.id, e.id)"
                >
                  <Play :size="11" :stroke-width="2.5" />
                </button>
                <span class="cr-nexttitle">{{ titleOf(e) }}</span>
                <span class="cr-nextby">{{ addedBy(e.addedBy) }}</span>
              </li>
```

```ts
/** Channels whose whole queue is shown. */
const expanded = ref(new Set<string>())
const shownQueue = (c: MusicChannelView) => expanded.value.has(c.id) ? c.queue : c.queue.slice(0, SHOWN_NEXT)
const toggleQueue = (id: string): void => {
  const s = new Set(expanded.value); s.has(id) ? s.delete(id) : s.add(id); expanded.value = s
}
```

"and N more" becomes `<button class="cr-nextmore" @click="toggleQueue(c.id)">` reading `and N more` / `Show less`. Keys move from index to `e.id`.

- [ ] **Step 2: MiniPlayer.** Leave button: `aria-label="Leave ${live.name}"`, tip `'Leave channel'`.

- [ ] **Step 3: Verify** — `npx vue-tsc --noEmit`; `npx vitest run src/styles src/components`.

- [ ] **Step 4: Commit**

```bash
git add src/components/music/MusicCallRail.vue src/components/music/MiniPlayer.vue
git commit -m "Music rail: play any queued song now, see the whole queue"
```

---

### Task 8: Prove it in a real call

- [ ] **Step 1:** Rebuild the service (`npm --prefix music run build`) and restart its dev process; nodemon restarts the API on its own.
- [ ] **Step 2:** Two-account probe (`scratchpad/channel-mode-probe.mjs`), each a PASS/FAIL line:
  1. A starts a channel; tuned in.
  2. A clicks a library row → still tuned in; channel queue gains that song; banner says "Added …".
  3. A right-clicks → "Play just for me" → dialog "Leave ‹channel›?" → **Stay** → still tuned, nothing solo playing.
  4. A clicks the header Play → dialog → **Leave and play** → untuned, solo audio playing, bar says "Only you".
  5. A tunes back in; banner's **Leave channel** → untuned, no dialog.
  6. Seek: A drags the live bar to ~60% of a 180s song → A's and B's times both jump to within ±3s of the target; the service log shows `starting at Ns`.
  7. Play now: B clicks play on the 2nd up-next row → both see that song now; the remaining queue keeps its order.
  8. Shields: every `.mm-unscanned` has the same `x` (±1px).
  9. No page errors on either account.
- [ ] **Step 3:** Full suite with CI env vars → all pass; `npx vue-tsc --noEmit`; `npx tsc --noEmit -p tsconfig.server.json`; `npx tsc --noEmit -p tsconfig.music.json`.
- [ ] **Step 4:** Screenshots of the banner, the dialog over the room, and the rail; look at them before reporting.

import { describe, it, expect, vi } from 'vitest'
import {
  runMusicCommand, resolveCommand, parseTime, findTrack, suggestTracks, MUSIC_COMMANDS,
  type CommandWorld,
} from '../musicCommands'
import type { MusicChannelView } from '../useMusic'
import type { LibTrack } from '../useMusicLibrary'

const track = (id: string, title: string, artist = 'Band', durationSec = 200) =>
  ({ id, title, artist, album: '', durationSec, bytes: 1, cover: null, source: 'upload', scan: 'clean', createdAt: '' }) as LibTrack

const LIB = [
  track('t1', 'Blue Monday', 'New Order'),
  track('t2', 'Bluebird', 'Wings'),
  track('t3', 'Khaar', 'Kourosh Yaghmaei', 409),
  track('t4', 'True Blue', 'Madonna'),
]

const channel = (over: Partial<MusicChannelView> = {}): MusicChannelView => ({
  id: 'c1', name: 'Chill', queue: [], queued: 0, listeners: ['u1'], previous: false,
  now: {
    id: 'e0', kind: 'library', title: 'Khaar', artist: 'Kourosh', durationSec: 409,
    addedBy: 'u2', url: null, cover: null, elapsedMs: 0,
  },
  ...over,
})

/** A world where every effect is a spy and nothing is playing anywhere. */
const world = (over: Partial<Omit<CommandWorld, 'act' | 'solo'>> & {
  solo?: Partial<CommandWorld['solo']>
  elapsedSec?: number
} = {}): CommandWorld & { act: Record<keyof CommandWorld['act'], ReturnType<typeof vi.fn>> } => {
  const act = {
    queue: vi.fn(), create: vi.fn(), listen: vi.fn(), skip: vi.fn(), previous: vi.fn(),
    close: vi.fn(), seek: vi.fn(), setChannelVolume: vi.fn(),
    playSolo: vi.fn(async () => {}), soloNext: vi.fn(async () => {}), soloPrevious: vi.fn(async () => {}),
    soloToggle: vi.fn(async () => {}), soloPause: vi.fn(), soloStop: vi.fn(), soloSeek: vi.fn(),
    soloVolume: vi.fn(), soloShuffle: vi.fn(), soloRepeat: vi.fn(),
  }
  const { solo, elapsedSec, ...rest } = over
  return {
    inCall: false, available: true, channels: [], tuned: null,
    elapsed: () => elapsedSec ?? 0,
    nameOf: (id: string) => (id === 'u1' ? 'you' : id === 'u2' ? 'Ana' : 'someone'),
    me: { name: 'SMD' },
    library: async () => LIB,
    solo: { current: null, paused: true, at: 0, duration: 0, upNext: () => [], shuffle: false, repeat: 'off', ...solo },
    ...rest,
    act,
  } as never
}

const run = (cmd: string, arg: string, w: CommandWorld) => runMusicCommand(cmd, arg, w)

// ── parsing ─────────────────────────────────────────────────────────────────

describe('names', () => {
  it('knows every listed command and its aliases', () => {
    for (const c of MUSIC_COMMANDS) {
      expect(resolveCommand(c.name)).toBe(c.name)
      for (const a of c.aliases) expect(resolveCommand(a)).toBe(c.name)
    }
    expect(resolveCommand('PLAY')).toBe('play')
    expect(resolveCommand('back')).toBe('prev')
    expect(resolveCommand('nope')).toBeNull()
  })
})

describe('parseTime', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    expect(parseTime('90')).toBe(90)
    expect(parseTime('1:30')).toBe(90)
    expect(parseTime(' 0:05 ')).toBe(5)
    expect(parseTime('1:02:03')).toBe(3723)
  })
  it('refuses anything else', () => {
    for (const bad of ['', 'soon', '1:3', '1:60', '-5', '1.5', '1:2:3']) expect(parseTime(bad)).toBeNull()
  })
})

describe('findTrack', () => {
  it('prefers an exact title, then a title start, then contains, then artist', () => {
    expect(findTrack('bluebird', LIB)?.id).toBe('t2')
    // Exact beats an earlier title that merely starts the same way.
    expect(findTrack('blue', [...LIB, track('t5', 'Blue', 'Joni')])?.id).toBe('t5')
    expect(findTrack('blue', LIB)?.id).toBe('t1')                // starts-with, first in library order
    expect(findTrack('monday', LIB)?.id).toBe('t1')              // contains
    expect(findTrack('madonna', LIB)?.id).toBe('t4')             // artist
    expect(findTrack('zzz', LIB)).toBeNull()
    expect(findTrack('  ', LIB)).toBeNull()
  })
  it('takes an exact id first — what picking a suggestion sends', () => {
    // Two songs can share a title; a picked suggestion must play the one picked.
    const twins = [track('a1', 'Blue', 'Joni'), track('a2', 'Blue', 'Eiffel 65')]
    expect(findTrack('a2', twins)?.artist).toBe('Eiffel 65')
  })

  it('suggests in the same order', () => {
    expect(suggestTracks('blue', LIB).map(t => t.id)).toEqual(['t1', 't2', 't4'])
    expect(suggestTracks('', LIB, 2).map(t => t.id)).toEqual(['t1', 't2'])
  })
})

// ── the rules ───────────────────────────────────────────────────────────────

describe('when music is off for the server', () => {
  it('every command says so and does nothing', async () => {
    for (const c of MUSIC_COMMANDS) {
      const w = world({ available: false })
      expect(await run(c.name, 'blue', w)).toMatch(/isn’t switched on/)
      for (const fn of Object.values(w.act)) expect(fn).not.toHaveBeenCalled()
    }
  })
})

describe('/play', () => {
  it('tuned in: adds the song to the channel you hear, and you stay', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('play', 'blue', w)).toBe('Added “Blue Monday” to Chill.')
    expect(w.act.queue).toHaveBeenCalledWith('c1', { trackId: 't1' })
    expect(w.act.listen).not.toHaveBeenCalled()
  })

  it('tuned into a quiet channel: says it is playing, not queued', async () => {
    const c = channel({ now: null })
    expect(await run('play', 'khaar', world({ inCall: true, channels: [c], tuned: c }))).toBe('Playing “Khaar” in Chill.')
  })

  it('a link goes on the channel as a link', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('p', 'https://x.test/a.mp3', w)).toBe('Added that link to Chill.')
    expect(w.act.queue).toHaveBeenCalledWith('c1', { url: 'https://x.test/a.mp3' })
  })

  it('in a call with one channel, not tuned: adds and tunes you in', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c] })
    expect(await run('play', 'blue', w)).toBe('Added “Blue Monday” to Chill — you’re listening.')
    expect(w.act.queue).toHaveBeenCalledWith('c1', { trackId: 't1' })
    expect(w.act.listen).toHaveBeenCalledWith('c1')
  })

  it('in a call with no music: starts a channel named for you', async () => {
    const w = world({ inCall: true })
    expect(await run('play', 'khaar', w)).toBe('Started SMD\'s music with “Khaar” — you’re listening.')
    expect(w.act.create).toHaveBeenCalledWith("SMD's music", { trackId: 't3' })
  })

  it('in a call with several channels: asks which, and does nothing', async () => {
    const w = world({ inCall: true, channels: [channel(), channel({ id: 'c2', name: 'Loud' })] })
    expect(await run('play', 'blue', w)).toMatch(/2 music channels: Chill, Loud\. Pick one with \/join/)
    expect(w.act.queue).not.toHaveBeenCalled()
    expect(w.act.create).not.toHaveBeenCalled()
  })

  it('no call: plays it just for you, from your library', async () => {
    const w = world()
    expect(await run('play', 'true blue', w)).toBe('Playing “True Blue” just for you.')
    expect(w.act.playSolo).toHaveBeenCalledWith(LIB, 3)
  })

  it('no call and a link: explains there is nowhere to play it', async () => {
    const w = world()
    expect(await run('play', 'https://x.test/a.mp3', w)).toMatch(/Links play in a call/)
    expect(w.act.playSolo).not.toHaveBeenCalled()
  })

  it('a song you do not have', async () => {
    const w = world({ inCall: true })
    expect(await run('play', 'zzz', w)).toBe('Nothing in your library matches “zzz”.')
    expect(w.act.create).not.toHaveBeenCalled()
  })

  it('with nothing after it resumes your own paused song', async () => {
    const w = world({ solo: { current: LIB[2], paused: true } })
    expect(await run('play', '', w)).toBe('Playing “Khaar”.')
    expect(w.act.soloToggle).toHaveBeenCalled()
  })

  it('with nothing after it while tuned in, asks what', async () => {
    const c = channel()
    expect(await run('play', '', world({ inCall: true, channels: [c], tuned: c }))).toMatch(/Say what to play.*Chill/)
  })
})

describe('/skip and /next', () => {
  it('tuned in: skips for everyone', async () => {
    for (const cmd of ['skip', 'next', 's']) {
      const c = channel()
      const w = world({ inCall: true, channels: [c], tuned: c })
      expect(await run(cmd, '', w)).toBe('Skipped “Khaar” for everyone in Chill.')
      expect(w.act.skip).toHaveBeenCalledWith('c1')
      expect(w.act.soloNext).not.toHaveBeenCalled()
    }
  })

  it('your own music: next in your queue', async () => {
    const w = world({ solo: { current: LIB[0], paused: false } })
    expect(await run('next', '', w)).toBe('Skipped “Blue Monday”.')
    expect(w.act.soloNext).toHaveBeenCalled()
    expect(w.act.skip).not.toHaveBeenCalled()
  })

  it('nothing for you, but music in the call: points at it', async () => {
    const w = world({ inCall: true, channels: [channel()] })
    expect(await run('skip', '', w)).toBe('Nothing is playing for you. /join to listen to Chill.')
    expect(w.act.skip).not.toHaveBeenCalled()
  })

  it('a tuned channel with nothing on', async () => {
    const c = channel({ now: null })
    expect(await run('skip', '', world({ inCall: true, channels: [c], tuned: c }))).toBe('Nothing is playing in Chill.')
  })
})

describe('/prev', () => {
  it('tuned in, early in the song: back one for everyone', async () => {
    const c = channel({ previous: true })
    const w = world({ inCall: true, channels: [c], tuned: c, elapsedSec: 1 })
    expect(await run('prev', '', w)).toBe('Back one song for everyone in Chill.')
    expect(w.act.previous).toHaveBeenCalledWith('c1')
  })

  it('tuned in, past three seconds: back to the start for everyone', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c, elapsedSec: 40 })
    expect(await run('back', '', w)).toBe('Back to the start of “Khaar” for everyone.')
    expect(w.act.previous).toHaveBeenCalledWith('c1')
  })

  it('tuned in with nothing before: says so and sends nothing', async () => {
    const c = channel({ previous: false })
    const w = world({ inCall: true, channels: [c], tuned: c, elapsedSec: 1 })
    expect(await run('previous', '', w)).toBe('Nothing played before this in Chill.')
    expect(w.act.previous).not.toHaveBeenCalled()
  })

  it('your own music', async () => {
    const early = world({ solo: { current: LIB[0], at: 1 } })
    expect(await run('prev', '', early)).toBe('Back one song.')
    const late = world({ solo: { current: LIB[0], at: 30 } })
    expect(await run('prev', '', late)).toBe('Back to the start of “Blue Monday”.')
    expect(late.act.soloPrevious).toHaveBeenCalled()
  })
})

describe('/stop', () => {
  it('tuned in: stops the channel for everyone', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('stop', '', w)).toBe('Stopped Chill for everyone.')
    expect(w.act.close).toHaveBeenCalledWith('c1')
  })
  it('your own music', async () => {
    const w = world({ solo: { current: LIB[0], paused: false } })
    expect(await run('stop', '', w)).toBe('Stopped.')
    expect(w.act.soloStop).toHaveBeenCalled()
  })
  it('nothing at all', async () => {
    expect(await run('stop', '', world())).toBe('Nothing is playing. /play <song> to start.')
  })
})

describe('/pause and /resume', () => {
  it('cannot pause a shared song', async () => {
    const c = channel()
    for (const cmd of ['pause', 'resume']) {
      const w = world({ inCall: true, channels: [c], tuned: c })
      expect(await run(cmd, '', w)).toMatch(/can’t be paused.*\/leave/)
      expect(w.act.soloPause).not.toHaveBeenCalled()
    }
  })
  it('pauses and resumes your own', async () => {
    const playing = world({ solo: { current: LIB[0], paused: false } })
    expect(await run('pause', '', playing)).toBe('Paused “Blue Monday”.')
    expect(playing.act.soloPause).toHaveBeenCalled()
    const paused = world({ solo: { current: LIB[0], paused: true } })
    expect(await run('resume', '', paused)).toBe('Playing “Blue Monday”.')
    expect(paused.act.soloToggle).toHaveBeenCalled()
  })
  it('says when there is nothing to do', async () => {
    expect(await run('pause', '', world({ solo: { current: LIB[0], paused: true } }))).toMatch(/already paused/)
    expect(await run('resume', '', world({ solo: { current: LIB[0], paused: false } }))).toMatch(/already playing/)
  })
})

describe('/seek', () => {
  it('tuned in: moves the song for everyone', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('seek', '1:30', w)).toBe('Moved “Khaar” to 1:30 for everyone.')
    expect(w.act.seek).toHaveBeenCalledWith('c1', 90)
  })
  it('refuses past the end, and nonsense', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('seek', '7:00', w)).toBe('“Khaar” is only 6:49 long.')
    expect(await run('seek', 'later', w)).toMatch(/Say where/)
    expect(w.act.seek).not.toHaveBeenCalled()
  })
  it('your own music', async () => {
    const w = world({ solo: { current: LIB[0], duration: 200 } })
    expect(await run('seek', '45', w)).toBe('Moved “Blue Monday” to 0:45.')
    expect(w.act.soloSeek).toHaveBeenCalledWith(45)
  })
})

describe('/np and /queue', () => {
  it('tuned in: the song, the time and who added it', async () => {
    const c = channel()
    expect(await run('np', '', world({ inCall: true, channels: [c], tuned: c, elapsedSec: 18 })))
      .toBe('Chill: “Khaar” by Kourosh — 0:18 / 6:49, added by Ana.')
  })
  it('your own music, paused', async () => {
    expect(await run('nowplaying', '', world({ solo: { current: LIB[0], at: 5, duration: 200, paused: true } })))
      .toBe('“Blue Monday” by New Order — 0:05 / 3:20, paused.')
  })
  it('the channel queue, with who added each', async () => {
    const c = channel({
      queue: [
        { id: 'e1', kind: 'library', title: 'Bluebird', artist: null, durationSec: 200, addedBy: 'u1' },
        { id: 'e2', kind: 'link', title: null, artist: null, durationSec: null, addedBy: 'u2' },
      ],
    })
    expect(await run('q', '', world({ inCall: true, channels: [c], tuned: c })))
      .toBe('Up next in Chill:\n1. Bluebird — you\n2. A linked track — Ana')
  })
  it('an empty channel queue', async () => {
    const c = channel()
    expect(await run('queue', '', world({ inCall: true, channels: [c], tuned: c }))).toMatch(/Nothing queued in Chill/)
  })
  it('your own queue, capped at ten', async () => {
    const many = Array.from({ length: 12 }, (_, i) => track(`m${i}`, `Song ${i}`, ''))
    const out = await run('queue', '', world({ solo: { current: LIB[0], upNext: () => many } }))
    expect(out.split('\n')).toHaveLength(12)                // heading + 10 + "and 2 more"
    expect(out).toMatch(/…and 2 more$/)
  })
})

describe('/join and /leave', () => {
  it('needs a call', async () => {
    expect(await run('join', '', world())).toMatch(/Join a voice channel first/)
  })
  it('joins the only channel, or one by name', async () => {
    const only = world({ inCall: true, channels: [channel()] })
    expect(await run('join', '', only)).toBe('Listening to Chill — “Khaar”.')
    expect(only.act.listen).toHaveBeenCalledWith('c1')
    const two = world({ inCall: true, channels: [channel(), channel({ id: 'c2', name: 'Loud Room', now: null })] })
    expect(await run('join', 'loud', two)).toBe('Listening to Loud Room.')
    expect(two.act.listen).toHaveBeenCalledWith('c2')
  })
  it('asks which when there are several, and names them', async () => {
    const w = world({ inCall: true, channels: [channel(), channel({ id: 'c2', name: 'Loud' })] })
    expect(await run('join', '', w)).toBe('This call has 2 music channels: Chill, Loud. /join <name>.')
    expect(await run('join', 'jazz', w)).toBe('No music channel called “jazz”. This call has: Chill, Loud.')
    expect(w.act.listen).not.toHaveBeenCalled()
  })
  it('already there', async () => {
    const c = channel()
    expect(await run('join', '', world({ inCall: true, channels: [c], tuned: c }))).toMatch(/already listening/)
  })
  it('leave', async () => {
    const c = channel()
    const w = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('leave', '', w)).toBe('Left Chill. It keeps playing for everyone else.')
    expect(w.act.listen).toHaveBeenCalledWith(null)
    expect(await run('leave', '', world())).toBe('You’re not in a music channel.')
  })
})

describe('/volume, /shuffle, /loop', () => {
  it('volume goes to whatever you hear', async () => {
    const c = channel()
    const tuned = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('vol', '40', tuned)).toBe('Chill at 40% for you.')
    expect(tuned.act.setChannelVolume).toHaveBeenCalledWith(0.4)
    const solo = world()
    expect(await run('volume', '75%', solo)).toBe('Volume 75%.')
    expect(solo.act.soloVolume).toHaveBeenCalledWith(0.75)
    expect(await run('volume', '150', solo)).toMatch(/0 to 100/)
    expect(await run('volume', 'loud', solo)).toMatch(/0 to 100/)
  })
  it('shuffle and loop are for your own queue', async () => {
    const c = channel()
    const tuned = world({ inCall: true, channels: [c], tuned: c })
    expect(await run('shuffle', '', tuned)).toMatch(/for your own queue/)
    expect(tuned.act.soloShuffle).not.toHaveBeenCalled()
    expect(await run('shuffle', '', world({ solo: { shuffle: false } }))).toBe('Shuffle is on.')
    expect(await run('loop', '', world({ solo: { repeat: 'off' } }))).toBe('Repeating the list.')
    expect(await run('repeat', '', world({ solo: { repeat: 'all' } }))).toBe('Repeating this song.')
    expect(await run('loop', '', world({ solo: { repeat: 'one' } }))).toBe('Repeat is off.')
  })
})

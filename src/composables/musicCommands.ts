/**
 * Music, typed into any chat box: /play, /skip, /prev, /stop and the rest.
 *
 * One rule decides what a command acts on: what you are hearing. Tuned into
 * a music channel, it is that channel, for everyone in it. Otherwise it is
 * your own player. /play is the one that adds rather than controls — it puts
 * a song on the channel you hear, or on the call's music, or plays it just
 * for you when there is no call.
 *
 * Every effect comes in through CommandWorld, so this file holds the rules
 * and nothing else, and the tests can check every one of them without a
 * socket, an audio element or a browser. The answer is a sentence for the
 * person who typed it — a private note in the composer, never a message
 * posted to the channel.
 */
import type { MusicChannelView } from './useMusic'
import { clock, type LibTrack } from './useMusicLibrary'

type Source = { trackId: string } | { url: string }

export interface CommandWorld {
  inCall: boolean
  /** Whether this instance runs music at all. */
  available: boolean
  channels: MusicChannelView[]
  /** The channel you are tuned into, or null. */
  tuned: MusicChannelView | null
  /** Seconds into a channel's song, now. */
  elapsed: (c: MusicChannelView) => number | null
  /** A user id as a name; "you" for your own. */
  nameOf: (id: string) => string
  me: { name: string }
  /** Your whole library. Loaded on first use. */
  library: () => Promise<LibTrack[]>
  solo: {
    current: LibTrack | null
    paused: boolean
    at: number
    duration: number
    upNext: () => LibTrack[]
    shuffle: boolean
    repeat: 'off' | 'all' | 'one'
  }
  act: {
    queue: (channelId: string, src: Source) => void
    create: (name: string, src: Source) => void
    listen: (channelId: string | null) => void
    skip: (channelId: string) => void
    previous: (channelId: string) => void
    close: (channelId: string) => void
    seek: (channelId: string, sec: number) => void
    setChannelVolume: (v: number) => void
    playSolo: (tracks: LibTrack[], index: number) => Promise<void>
    soloNext: () => Promise<void>
    soloPrevious: () => Promise<void>
    soloToggle: () => Promise<void>
    soloPause: () => void
    soloStop: () => void
    soloSeek: (sec: number) => void
    soloVolume: (v: number) => void
    soloShuffle: () => void
    soloRepeat: () => void
  }
}

/** What the "/" list shows. Aliases work when typed but are not listed. */
export const MUSIC_COMMANDS: { name: string; aliases: string[]; usage: string; description: string }[] = [
  { name: 'play',    aliases: ['p'],                  usage: '/play <song or link>', description: 'Play a song, or add it to the call’s music' },
  { name: 'skip',    aliases: ['s'],                  usage: '/skip',                description: 'Skip to the next song' },
  { name: 'next',    aliases: [],                     usage: '/next',                description: 'Skip to the next song' },
  { name: 'prev',    aliases: ['previous', 'back'],   usage: '/prev',                description: 'Go back a song, or to the start of this one' },
  { name: 'stop',    aliases: [],                     usage: '/stop',                description: 'Stop the music (a shared channel stops for everyone)' },
  { name: 'pause',   aliases: [],                     usage: '/pause',               description: 'Pause your music' },
  { name: 'resume',  aliases: [],                     usage: '/resume',              description: 'Carry on with your music' },
  { name: 'np',      aliases: ['nowplaying'],         usage: '/np',                  description: 'What is playing, and where it is' },
  { name: 'queue',   aliases: ['q'],                  usage: '/queue',               description: 'What plays next' },
  { name: 'seek',    aliases: [],                     usage: '/seek <1:30>',         description: 'Move to a point in the song' },
  { name: 'join',    aliases: [],                     usage: '/join [channel]',      description: 'Listen to the call’s music' },
  { name: 'leave',   aliases: [],                     usage: '/leave',               description: 'Stop listening to the call’s music' },
  { name: 'volume',  aliases: ['vol'],                usage: '/volume <0-100>',      description: 'Set how loud the music is' },
  { name: 'shuffle', aliases: [],                     usage: '/shuffle',             description: 'Shuffle your own queue' },
  { name: 'loop',    aliases: ['repeat'],             usage: '/loop',                description: 'Repeat your list, a song, or nothing' },
]

/** A typed command, or one of its aliases, as the command it means. */
export const resolveCommand = (typed: string): string | null => {
  const t = typed.toLowerCase()
  const c = MUSIC_COMMANDS.find(m => m.name === t || m.aliases.includes(t))
  return c ? c.name : null
}

/** "1:30" → 90, "90" → 90, "1:02:03" → 3723. Null for anything else. */
export const parseTime = (s: string): number | null => {
  const t = s.trim()
  if (/^\d+$/.test(t)) return Number(t)
  let m = /^(\d+):([0-5]\d)$/.exec(t)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(t)
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return null
}

/**
 * The library song a few typed words mean.
 *
 * An exact id first (a picked suggestion), then an exact title, then a title that starts with it, then one that
 * contains it, then the artist. Ties go to library order, which is the
 * order the room lists them in, so "/play blue" picks the row you would
 * have clicked.
 */
export const findTrack = (q: string, tracks: LibTrack[]): LibTrack | null => {
  const n = q.trim().toLowerCase()
  if (!n) return null
  const low = (s: string | null | undefined) => (s ?? '').toLowerCase()
  // An exact id is what a picked suggestion sends: titles can repeat.
  return tracks.find(t => t.id === q.trim())
    ?? tracks.find(t => low(t.title) === n)
    ?? tracks.find(t => low(t.title).startsWith(n))
    ?? tracks.find(t => low(t.title).includes(n))
    ?? tracks.find(t => low(t.artist).includes(n))
    ?? null
}

/** Library songs for the "/play …" suggestions: the same order as findTrack. */
export const suggestTracks = (q: string, tracks: LibTrack[], limit = 6): LibTrack[] => {
  const n = q.trim().toLowerCase()
  const low = (s: string | null | undefined) => (s ?? '').toLowerCase()
  if (!n) return tracks.slice(0, limit)
  const rank = (t: LibTrack): number =>
    low(t.title) === n ? 0
    : low(t.title).startsWith(n) ? 1
    : low(t.title).includes(n) ? 2
    : low(t.artist).includes(n) ? 3
    : 9
  return tracks
    .map((t, i) => ({ t, r: rank(t), i }))
    .filter(x => x.r < 9)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(x => x.t)
}

// ── wording ─────────────────────────────────────────────────────────────────

const titleOf = (c: MusicChannelView): string => c.now?.title ?? 'the linked track'
const quoted = (s: string) => `“${s}”`
const isLink = (s: string) => /^https?:\/\//i.test(s)

/** When a command needs something playing and nothing is, say where music is. */
const nothingForYou = (w: CommandWorld): string => {
  const playing = w.channels.find(c => c.now)
  return playing
    ? `Nothing is playing for you. /join to listen to ${playing.name}.`
    : 'Nothing is playing. /play <song> to start.'
}

const REPEAT_NEXT: Record<CommandWorld['solo']['repeat'], CommandWorld['solo']['repeat']> = { off: 'all', all: 'one', one: 'off' }
const REPEAT_WORDS: Record<CommandWorld['solo']['repeat'], string> = {
  off: 'Repeat is off.', all: 'Repeating the list.', one: 'Repeating this song.',
}

// ── the commands ────────────────────────────────────────────────────────────

const play = async (arg: string, w: CommandWorld): Promise<string> => {
  if (!arg) {
    if (w.tuned) return `Say what to play: /play <song name>, and it goes on ${w.tuned.name}.`
    if (w.solo.current && w.solo.paused) {
      await w.act.soloToggle()
      return `Playing ${quoted(w.solo.current.title)}.`
    }
    return 'Say what to play: /play <song name or link>.'
  }

  const link = isLink(arg)
  let track: LibTrack | null = null
  let tracks: LibTrack[] = []
  if (!link) {
    tracks = await w.library()
    track = findTrack(arg, tracks)
    if (!track) return `Nothing in your library matches ${quoted(arg)}.`
  }
  const source: Source = track ? { trackId: track.id } : { url: arg }
  const label = track ? quoted(track.title) : 'that link'

  // Tuned in: it goes on the channel you hear, and you stay.
  if (w.tuned) {
    w.act.queue(w.tuned.id, source)
    return w.tuned.now ? `Added ${label} to ${w.tuned.name}.` : `Playing ${label} in ${w.tuned.name}.`
  }

  // In a call: it goes on the call's music, which you then hear.
  if (w.inCall) {
    if (w.channels.length === 1) {
      const c = w.channels[0]
      w.act.queue(c.id, source)
      w.act.listen(c.id)
      return `Added ${label} to ${c.name} — you’re listening.`
    }
    if (w.channels.length > 1) {
      return `This call has ${w.channels.length} music channels: ${w.channels.map(c => c.name).join(', ')}. `
        + 'Pick one with /join <name>, then /play again.'
    }
    const name = `${w.me.name}'s music`.slice(0, 32)
    w.act.create(name, source)
    return `Started ${name} with ${label} — you’re listening.`
  }

  // No call: just for you. A link has nowhere to play.
  if (!track) return 'Links play in a call’s music. Join a voice channel, or import the link in the music room to keep it.'
  await w.act.playSolo(tracks, tracks.indexOf(track))
  return `Playing ${quoted(track.title)} just for you.`
}

const pauseOrResume = async (want: 'pause' | 'resume', w: CommandWorld): Promise<string> => {
  if (w.tuned) return 'A shared song can’t be paused — it would pause for everyone. /leave stops it for you.'
  const t = w.solo.current
  if (!t) return nothingForYou(w)
  if (want === 'pause') {
    if (w.solo.paused) return `${quoted(t.title)} is already paused.`
    w.act.soloPause()
    return `Paused ${quoted(t.title)}.`
  }
  if (!w.solo.paused) return `${quoted(t.title)} is already playing.`
  await w.act.soloToggle()
  return `Playing ${quoted(t.title)}.`
}

const skip = async (w: CommandWorld): Promise<string> => {
  if (w.tuned) {
    if (!w.tuned.now) return `Nothing is playing in ${w.tuned.name}.`
    w.act.skip(w.tuned.id)
    return `Skipped ${quoted(titleOf(w.tuned))} for everyone in ${w.tuned.name}.`
  }
  const t = w.solo.current
  if (!t) return nothingForYou(w)
  await w.act.soloNext()
  return `Skipped ${quoted(t.title)}.`
}

const previous = async (w: CommandWorld): Promise<string> => {
  if (w.tuned) {
    const at = w.elapsed(w.tuned) ?? 0
    const restart = !!w.tuned.now && at > 3
    if (!restart && !w.tuned.previous) return `Nothing played before this in ${w.tuned.name}.`
    w.act.previous(w.tuned.id)
    return restart
      ? `Back to the start of ${quoted(titleOf(w.tuned))} for everyone.`
      : `Back one song for everyone in ${w.tuned.name}.`
  }
  const t = w.solo.current
  if (!t) return nothingForYou(w)
  const restart = w.solo.at > 3
  await w.act.soloPrevious()
  return restart ? `Back to the start of ${quoted(t.title)}.` : 'Back one song.'
}

const stop = (w: CommandWorld): string => {
  if (w.tuned) {
    w.act.close(w.tuned.id)
    return `Stopped ${w.tuned.name} for everyone.`
  }
  if (!w.solo.current) return nothingForYou(w)
  w.act.soloStop()
  return 'Stopped.'
}

const seek = (arg: string, w: CommandWorld): string => {
  const sec = parseTime(arg)
  if (sec === null) return 'Say where: /seek 1:30, or /seek 90 for ninety seconds in.'
  if (w.tuned) {
    const now = w.tuned.now
    if (!now) return `Nothing is playing in ${w.tuned.name}.`
    if (now.durationSec && sec >= now.durationSec) return `${quoted(titleOf(w.tuned))} is only ${clock(now.durationSec)} long.`
    w.act.seek(w.tuned.id, sec)
    return `Moved ${quoted(titleOf(w.tuned))} to ${clock(sec)} for everyone.`
  }
  const t = w.solo.current
  if (!t) return nothingForYou(w)
  if (w.solo.duration && sec >= w.solo.duration) return `${quoted(t.title)} is only ${clock(w.solo.duration)} long.`
  w.act.soloSeek(sec)
  return `Moved ${quoted(t.title)} to ${clock(sec)}.`
}

const nowPlaying = (w: CommandWorld): string => {
  if (w.tuned) {
    const now = w.tuned.now
    if (!now) return `Nothing is playing in ${w.tuned.name}.`
    const at = w.elapsed(w.tuned) ?? 0
    const by = now.artist ? ` by ${now.artist}` : ''
    const len = now.durationSec ? ` / ${clock(now.durationSec)}` : ''
    return `${w.tuned.name}: ${quoted(titleOf(w.tuned))}${by} — ${clock(at)}${len}, added by ${w.nameOf(now.addedBy)}.`
  }
  const t = w.solo.current
  if (!t) return nothingForYou(w)
  const by = t.artist ? ` by ${t.artist}` : ''
  return `${quoted(t.title)}${by} — ${clock(w.solo.at)} / ${clock(w.solo.duration || t.durationSec)}${w.solo.paused ? ', paused' : ''}.`
}

const SHOWN = 10

const queue = (w: CommandWorld): string => {
  if (w.tuned) {
    const q = w.tuned.queue
    if (!q.length) return `Nothing queued in ${w.tuned.name}. /play <song> adds one.`
    const lines = q.slice(0, SHOWN).map((e, i) => `${i + 1}. ${e.title ?? 'A linked track'} — ${w.nameOf(e.addedBy)}`)
    const more = q.length > SHOWN ? `\n…and ${q.length - SHOWN} more` : ''
    return `Up next in ${w.tuned.name}:\n${lines.join('\n')}${more}`
  }
  if (!w.solo.current) return nothingForYou(w)
  const q = w.solo.upNext()
  if (!q.length) return 'Nothing after this one.'
  const lines = q.slice(0, SHOWN).map((t, i) => `${i + 1}. ${t.title}${t.artist ? ` — ${t.artist}` : ''}`)
  const more = q.length > SHOWN ? `\n…and ${q.length - SHOWN} more` : ''
  return `Up next for you:\n${lines.join('\n')}${more}`
}

const join = (arg: string, w: CommandWorld): string => {
  if (!w.inCall) return 'Join a voice channel first — music plays inside a call.'
  if (!w.channels.length) return 'No music in this call yet. /play <song> starts some.'
  const n = arg.trim().toLowerCase()
  const names = w.channels.map(c => c.name).join(', ')
  const c = n
    ? (w.channels.find(x => x.name.toLowerCase() === n) ?? w.channels.find(x => x.name.toLowerCase().includes(n)))
    : (w.channels.length === 1 ? w.channels[0] : undefined)
  if (!c) {
    return n
      ? `No music channel called ${quoted(arg.trim())}. This call has: ${names}.`
      : `This call has ${w.channels.length} music channels: ${names}. /join <name>.`
  }
  if (w.tuned?.id === c.id) return `You’re already listening to ${c.name}.`
  w.act.listen(c.id)
  return `Listening to ${c.name}${c.now ? ` — ${quoted(titleOf(c))}` : ''}.`
}

const leave = (w: CommandWorld): string => {
  if (!w.tuned) return 'You’re not in a music channel.'
  w.act.listen(null)
  return `Left ${w.tuned.name}. It keeps playing for everyone else.`
}

const volume = (arg: string, w: CommandWorld): string => {
  const v = /^\d{1,3}%?$/.test(arg.trim()) ? parseInt(arg, 10) : NaN
  if (!Number.isFinite(v) || v < 0 || v > 100) return 'Say how loud: /volume 0 to 100.'
  if (w.tuned) { w.act.setChannelVolume(v / 100); return `${w.tuned.name} at ${v}% for you.` }
  w.act.soloVolume(v / 100)
  return `Volume ${v}%.`
}

const OWN_QUEUE_ONLY = 'Shuffle and repeat are for your own queue — a shared channel plays songs in the order people add them.'

/** Run one music command. Answers with the note to show the person who typed it. */
export const runMusicCommand = async (typed: string, arg: string, w: CommandWorld): Promise<string> => {
  const name = resolveCommand(typed)
  if (!name) return `There is no /${typed} command.`
  if (!w.available) return 'Music isn’t switched on for this server.'
  const a = arg.trim()
  switch (name) {
    case 'play':    return play(a, w)
    case 'pause':   return pauseOrResume('pause', w)
    case 'resume':  return pauseOrResume('resume', w)
    case 'skip':
    case 'next':    return skip(w)
    case 'prev':    return previous(w)
    case 'stop':    return stop(w)
    case 'seek':    return seek(a, w)
    case 'np':      return nowPlaying(w)
    case 'queue':   return queue(w)
    case 'join':    return join(a, w)
    case 'leave':   return leave(w)
    case 'volume':  return volume(a, w)
    case 'shuffle': {
      if (w.tuned) return OWN_QUEUE_ONLY
      const was = w.solo.shuffle
      w.act.soloShuffle()
      return was ? 'Shuffle is off.' : 'Shuffle is on.'
    }
    case 'loop': {
      if (w.tuned) return OWN_QUEUE_ONLY
      const next = REPEAT_NEXT[w.solo.repeat]
      w.act.soloRepeat()
      return REPEAT_WORDS[next]
    }
    default:        return `There is no /${typed} command.`
  }
}

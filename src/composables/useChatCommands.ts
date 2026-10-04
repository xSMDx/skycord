/**
 * Slash command registry. Each command computes a result that either replaces
 * the composer text (`insert`) or is sent immediately (`send`). Adding a command
 * is a one-liner here — the `/` autocomplete lists them all automatically.
 *
 * A command can instead DO something and answer privately (`act`): the music
 * commands control playback and reply with a note only the typist sees,
 * rather than posting anything to the channel.
 */
import { musicAvailable } from './useMusic'
import { MUSIC_COMMANDS, runMusicCommand } from './musicCommands'

export interface SlashCommand {
  name:        string
  description: string
  glyph:       string
  /** Shown as the list's heading when every row shown belongs to it. */
  group?:      string
  /** Other names that run it when typed. Not listed. */
  aliases?:    string[]
  /** Whether it exists right now — music commands only where music runs. */
  available?:  () => boolean
  run?: (arg: string) => { insert?: string; send?: string }
  /** Does something, and answers with a note for the person who typed it. */
  act?: (arg: string) => Promise<string>
  /** Needs something after its name, so Enter on the bare name completes it rather than running it. */
  takesArg?:   boolean
}

const rand = (n: number) => Math.floor(Math.random() * n)

const EIGHT_BALL = [
  'It is certain.', 'Without a doubt.', 'Yes — definitely.', 'You may rely on it.',
  'Most likely.', 'Outlook good.', 'Signs point to yes.', 'Reply hazy, try again.',
  'Ask again later.', 'Cannot predict now.', "Don't count on it.", 'My reply is no.',
  'Very doubtful.', 'Outlook not so good.',
]

export const slashCommands: SlashCommand[] = [
  { name: 'me',       description: 'Display text with emphasis',         glyph: '🙋', run: (a) => ({ send: a ? `*${a}*` : '' }) },
  { name: 'shrug',    description: 'Append ¯\\_(ツ)_/¯ to your message',  glyph: '🤷', run: (a) => ({ send: `${a} ¯\\_(ツ)_/¯`.trim() }) },
  { name: 'dice',     description: 'Roll a die (default d6)',            glyph: '🎲', run: (a) => { const n = Math.max(2, parseInt(a, 10) || 6); return { send: `🎲 rolled **${1 + rand(n)}** (d${n})` } } },
  { name: 'coinflip', description: 'Flip a coin',                        glyph: '🪙', run: () => ({ send: `🪙 **${rand(2) ? 'Heads' : 'Tails'}**` }) },
  { name: '8ball',    description: 'Ask the magic 8-ball a question',    glyph: '🎱', run: (a) => ({ send: `🎱 ${a ? `**${a}** — ` : ''}${EIGHT_BALL[rand(EIGHT_BALL.length)]}` }) },
]

const MUSIC_GLYPH: Record<string, string> = {
  play: '▶️', skip: '⏭️', next: '⏭️', prev: '⏮️', stop: '⏹️', pause: '⏸️', resume: '▶️',
  np: '🎵', queue: '📜', seek: '⏩', join: '🎧', leave: '🚪', volume: '🔊', shuffle: '🔀', loop: '🔁',
}

for (const m of MUSIC_COMMANDS) {
  slashCommands.push({
    name: m.name,
    description: m.description,
    glyph: MUSIC_GLYPH[m.name] ?? '🎵',
    group: 'Music',
    aliases: m.aliases,
    // "<song>" is required, "[channel]" is not: /join alone is a whole command.
    takesArg: m.usage.includes('<'),
    available: () => musicAvailable.value,
    // Loaded on first use: the bridge reaches the player and the call, and
    // listing command names should not have to.
    act: async (arg) => {
      const { musicWorld } = await import('./musicCommandWorld')
      return runMusicCommand(m.name, arg, musicWorld())
    },
  })
}

const usable = (c: SlashCommand) => !c.available || c.available()

/** The command a typed name means — by name or alias — if it exists here. */
export const resolveSlash = (typed: string): SlashCommand | undefined => {
  const t = typed.toLowerCase()
  return slashCommands.find(c => usable(c) && (c.name === t || c.aliases?.includes(t)))
}

export const matchCommands = (query: string) =>
  slashCommands.filter(c => usable(c) && c.name.startsWith(query.toLowerCase()))

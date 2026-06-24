/**
 * Slash command registry. Each command computes a result that either replaces
 * the composer text (`insert`) or is sent immediately (`send`). Adding a command
 * is a one-liner here — the `/` autocomplete lists them all automatically.
 */
export interface SlashCommand {
  name:        string
  description: string
  glyph:       string
  run: (arg: string) => { insert?: string; send?: string }
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

export const matchCommands = (query: string) =>
  slashCommands.filter(c => c.name.startsWith(query.toLowerCase()))

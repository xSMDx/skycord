/**
 * richText — render a message's stored text (with inline markers) into safe HTML,
 * and strip markers back to plain text for previews.
 *
 * Markers are stored verbatim in the message `content` string (no schema change):
 *   **bold**  *italic* / _italic_  __underline__  ~~strike~~  `code`  ```block```
 *   > quote          [label](url)           bare https URLs
 *   <@Name>  (member mention)   @everyone   <t:unixSeconds:style>  (time token)
 *
 * Everything is HTML-escaped before marker substitution, so user content can't
 * inject markup.
 */

import { appearance } from '@/composables/useAppearance'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Emoji packs — render native emoji as images from a CDN (your client only) ─
const EMOJI_CDN: Record<string, ((cps: string[]) => string) | null> = {
  native:  null,
  twemoji: cps => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${cps.join('-')}.svg`,
  noto:    cps => `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u${cps.join('_')}.svg`,
}
const EMOJI_RE = new RegExp(
  '\\p{Extended_Pictographic}(?:\\uFE0F)?(?:\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F)?(?:\\p{Emoji_Modifier})?)*',
  'gu',
)
const toCodepoints = (grapheme: string) =>
  [...grapheme].map(c => c.codePointAt(0)!).filter(c => c !== 0xFE0F).map(c => c.toString(16))
const emojify = (html: string): string => {
  const build = EMOJI_CDN[appearance.emojiPack]
  if (!build) return html
  return html.replace(EMOJI_RE, (m) => {
    const cps = toCodepoints(m)
    if (!cps.length) return m
    return `<img class="emoji" draggable="false" alt="${m}" src="${build(cps)}" />`
  })
}

// ── Time tokens — rendered in the VIEWER's locale + timezone ────────────────
export type TimeStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'

const relative = (d: Date): string => {
  const diff = d.getTime() - Date.now()
  const abs  = Math.abs(diff)
  const rtf  = new Intl.RelativeTimeFormat([], { numeric: 'auto' })
  const steps: [number, number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, 1000, 'second'],
    [3_600_000, 60_000, 'minute'],
    [86_400_000, 3_600_000, 'hour'],
    [604_800_000, 86_400_000, 'day'],
    [2_629_800_000, 604_800_000, 'week'],
    [31_557_600_000, 2_629_800_000, 'month'],
  ]
  for (const [limit, div, unit] of steps) {
    if (abs < limit) return rtf.format(Math.round(diff / div), unit)
  }
  return rtf.format(Math.round(diff / 31_557_600_000), 'year')
}

export const formatTimeToken = (unixSeconds: number, style: TimeStyle): string => {
  const d = new Date(unixSeconds * 1000)
  if (Number.isNaN(d.getTime())) return ''
  switch (style) {
    case 't': return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    case 'T': return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    case 'd': return d.toLocaleDateString()
    case 'D': return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    case 'f': return d.toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    case 'F': return d.toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    case 'R': return relative(d)
    default:  return d.toLocaleString()
  }
}

// Private-use-area sentinel (U+F8FF): never appears in user text, survives
// HTML-escaping, and isn't matched by any markdown regex — so stashed HTML is
// shielded from both escaping and marker parsing.
const S = String.fromCharCode(0xF8FF)

export const renderMessage = (raw: string): string => {
  const ph: string[] = []
  const stash = (html: string) => S + (ph.push(html) - 1) + S

  let s = raw

  // 1. Code first — content shown literally, no markers parsed inside.
  s = s.replace(/```([\s\S]+?)```/g, (_m, code) => stash(`<pre class="msg-cb">${escapeHtml(String(code).replace(/^\n|\n$/g, ''))}</pre>`))
  s = s.replace(/`([^`\n]+?)`/g, (_m, code) => stash(`<code class="ic">${escapeHtml(code)}</code>`))

  // 2. Markdown links [label](url) — http/https only.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) =>
    stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="msg-link">${escapeHtml(label)}</a>`))

  // 3. Bare URLs.
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (url) =>
    stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="msg-link">${escapeHtml(url)}</a>`))

  // 4. Mentions + time tokens.
  s = s.replace(/<@([^>\n]+)>/g, (_m, name) => stash(`<span class="mention">@${escapeHtml(name)}</span>`))
  s = s.replace(/@everyone\b/g, () => stash(`<span class="mention mention-all">@everyone</span>`))
  s = s.replace(/<t:(\d+):([tTdDfFR])>/g, (_m, unix, style) =>
    stash(`<span class="msg-time-token" title="${escapeHtml(formatTimeToken(+unix, 'F'))}">${escapeHtml(formatTimeToken(+unix, style as TimeStyle))}</span>`))

  // 5. Escape everything still inline.
  s = escapeHtml(s)

  // 6. Blockquote (line-starting "> ").
  s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="msg-bq">$1</blockquote>')

  // 7. Inline marks — bold/underline/strike before italic so __ and ** win.
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^\n]+?)__/g, '<u>$1</u>')
  s = s.replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, '$1<em>$2</em>')

  // 7b. Emoji pack — swap native glyphs for the chosen image set (if not native).
  s = emojify(s)

  // 8. Restore stashed HTML.
  return s.replace(new RegExp(S + '(\\d+)' + S, 'g'), (_m, i) => ph[+i] ?? '')
}

// ── Strip to plain text (reply previews, tree cards, sidebar last-message) ──
export const stripMarkers = (raw: string): string =>
  raw
    .replace(/```([\s\S]+?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/<@([^>\n]+)>/g, '@$1')
    .replace(/<t:(\d+):([tTdDfFR])>/g, (_m, unix, style) => formatTimeToken(+unix, style as TimeStyle))
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/~~([^\n]+?)~~/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, '$1$2')
    .replace(/^>\s?/gm, '')
    .trim()

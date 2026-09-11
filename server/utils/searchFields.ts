/**
 * What a message contains and whom it mentions, worked out from its text.
 *
 * Pure — no database — so the model hook, the startup backfill and the tests
 * run exactly the same rules, and a client test can import it to check the
 * embed patterns still match what the client draws as cards.
 */

export type SearchHas = 'link' | 'image' | 'video' | 'embed'
export const SEARCH_HAS: readonly SearchHas[] = ['link', 'image', 'video', 'embed']

const URL_RE    = /https?:\/\/[^\s<>"']+/gi
const IMAGE_EXT = /\.(?:gif|png|jpe?g|webp|avif)(?:\?\S*)?$/i
const VIDEO_EXT = /\.(?:mp4|webm|mov)(?:\?\S*)?$/i
/** The links MessageItem draws as cards: server invite, group invite, theme. */
const CARD_LINK_RE = /https?:\/\/[^/\s]+\/(?:join|invite|theme)\/[A-Za-z0-9_-]{6,16}\/?/i
/** Mirrors THEME_CODE_RE in src/composables/useAppearance.ts — pinned by a parity test. */
export const THEME_CODE_RE = /(?:skycord|sykord)-theme:[A-Za-z0-9_-]+/
const MENTION_RE = /<@([^>\n]+)>/g

/** Sentence punctuation after a link is not part of it. */
const trimUrl = (u: string) => u.replace(/[).,!?:;]+$/, '')

export const classifyHas = (content: string): SearchHas[] => {
  const found = new Set<SearchHas>()
  const urls = (content.match(URL_RE) ?? []).map(trimUrl)
  if (urls.length) found.add('link')
  for (const u of urls) {
    if (IMAGE_EXT.test(u)) found.add('image')
    if (VIDEO_EXT.test(u)) found.add('video')
  }
  if (CARD_LINK_RE.test(content) || THEME_CODE_RE.test(content)) found.add('embed')
  return SEARCH_HAS.filter(h => found.has(h))
}

/**
 * The names inside `<@…>` mention tokens, trimmed, each once. The composer
 * writes a member's display name there, not an id — see MessageInput.vue.
 */
export const mentionNames = (content: string): string[] => {
  const out = new Set<string>()
  for (const m of content.matchAll(MENTION_RE)) {
    const name = m[1].trim()
    if (name) out.add(name)
  }
  return [...out]
}

export interface MentionCandidate { _id: { toString(): string }; username: string; displayName?: string | null }

/**
 * Which of `people` the names refer to: display name or username, ignoring
 * case. A name two people share resolves to both — a search for either of
 * them should find the message.
 */
export const resolveMentions = (names: string[], people: MentionCandidate[]): string[] => {
  const wanted = new Set(names.map(n => n.toLowerCase()))
  return people
    .filter(p => wanted.has(p.username.toLowerCase())
      || (!!p.displayName && wanted.has(p.displayName.toLowerCase())))
    .map(p => p._id.toString())
}

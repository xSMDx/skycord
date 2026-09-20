/**
 * Markdown for a host's legal documents, and for nothing else.
 *
 * Locked down, because the text comes from whoever runs the instance: raw HTML
 * is escaped and shown as text (markdown-it's html: false), images are never
 * rendered (a legal page is the last place for a tracking pixel), and only
 * https:, http: and mailto: become links — each opening in a new tab without
 * an opener. Anything else in link position stays plain text.
 *
 * markdown-it is imported on first use, so it costs nothing until a document
 * is opened.
 */
// markdown-it 15 ships its own types and its DEFAULT export is a callable,
// not the class — so the instance type comes from the named export. There is
// no @types/markdown-it here on purpose: the published one is still on 14 and
// would shadow the real thing with an older shape.
import type { MarkdownIt } from 'markdown-it'

const SAFE_LINK = /^(https?:|mailto:)/i

let renderer: MarkdownIt | null = null

const build = async (): Promise<MarkdownIt> => {
  const { default: Markdown } = await import('markdown-it')
  const md = new Markdown({ html: false, linkify: false, typographer: false })
  md.disable('image')
  md.validateLink = (url: string) => SAFE_LINK.test(url.trim())
  const openLink = md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
    return openLink(tokens, idx, options, env, self)
  }
  return md
}

export const renderLegalMarkdown = async (source: string): Promise<string> => {
  renderer ??= await build()
  return renderer.render(source)
}

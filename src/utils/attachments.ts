/**
 * Attachments on the client: how many tiles a message's media gets, what a
 * message with no text is called in a one-line preview, which links are GIFs
 * worth previewing, and how a file is labelled on its card.
 *
 * Pure, so every surface that shows a message — the message itself, the
 * conversation list, a reply pill, a notification — takes its words from one
 * place and none of them falls back to printing a raw link.
 */
import type { Attachment, AttachmentSummary } from '@/types'

// ── layout ──────────────────────────────────────────────────────────────

export type MosaicTemplate = 'one' | 'two' | 'three' | 'four'

/** One box for all of a message's media: up to four tiles, the rest counted
 *  on the last ("+3"). The owner chose this over even squares. */
export const mosaicLayout = (count: number): { shown: number; extra: number; template: MosaicTemplate } => {
  const shown = Math.max(0, Math.min(count, 4))
  const template: MosaicTemplate = shown >= 4 ? 'four' : shown === 3 ? 'three' : shown === 2 ? 'two' : 'one'
  return { shown, extra: Math.max(0, count - 4), template }
}

// ── GIF links ───────────────────────────────────────────────────────────

/** A message whose whole content is a .gif link — what the GIF picker sends.
 *  Any host: older messages hold links from the previous GIF provider. */
const GIF_URL_RE = /^https?:\/\/\S+\.gif(\?\S*)?$/i
export const isGifOnly = (content: string): boolean => GIF_URL_RE.test(content.trim())

const URL_RE = /https?:\/\/[^\s<>"']+/gi
/** Sentence punctuation after a link is not part of it (the server's rule too). */
const trimUrl = (u: string) => u.replace(/[).,!?:;]+$/, '')

/**
 * KLIPY GIF links inside a message, for inline previews under the text.
 * KLIPY only: drawing an image from any host a member pastes would hand that
 * host the IP of everyone who reads the message.
 */
export const klipyGifLinks = (content: string): string[] => {
  const out: string[] = []
  for (const raw of content.match(URL_RE) ?? []) {
    const link = trimUrl(raw)
    let u: URL
    try { u = new URL(link) } catch { continue }
    const host = u.hostname.toLowerCase()
    if (u.protocol !== 'https:' || !(host === 'klipy.com' || host.endsWith('.klipy.com'))) continue
    if (!/\.gif$/i.test(u.pathname) || out.includes(link)) continue
    out.push(link)
    if (out.length === 4) break
  }
  return out
}

// ── one-line previews ───────────────────────────────────────────────────

type FileLike = Pick<Attachment, 'kind' | 'name' | 'mime'>

const summarize = (list: readonly FileLike[]): AttachmentSummary | null => {
  if (!list.length) return null
  const [first] = list
  const kind = list.every(a => a.kind === first.kind) ? first.kind : 'file'
  return { count: list.length, kind, name: first.name, mime: first.mime }
}

const describe = (s: AttachmentSummary): string => {
  if (s.count === 1) {
    if (s.kind === 'image') return s.mime === 'image/gif' ? 'GIF' : 'Sent a photo'
    if (s.kind === 'video') return 'Sent a video'
    return s.name
  }
  if (s.kind === 'image') return `Sent ${s.count} photos`
  if (s.kind === 'video') return `Sent ${s.count} videos`
  return `Sent ${s.count} files`
}

/**
 * What a message is, in one line: its text when it has some; "GIF" for a GIF
 * on its own; otherwise what was sent — "Sent a photo", "Sent 3 photos",
 * "notes.pdf", "Sent 2 files". `summary` is the server's description of files
 * it did not send whole (reply parents, the DM list).
 */
export const previewText = (m: {
  content?: string | null
  attachments?: readonly FileLike[] | null
  summary?: AttachmentSummary | null
}): string => {
  const text = (m.content ?? '').trim()
  if (text) return isGifOnly(text) ? 'GIF' : text
  const s = m.attachments?.length ? summarize(m.attachments) : m.summary ?? null
  return s ? describe(s) : ''
}

// ── file cards ──────────────────────────────────────────────────────────

/** The extension stays visible however long the name: only the stem truncates. */
export const splitName = (name: string): { stem: string; ext: string } => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' }
}

const extOf = (name: string): string => splitName(name).ext.slice(1).toLowerCase()

/** Binary units, one decimal from KB up: "900 B", "2.4 MB". */
export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export type FileIcon = 'doc' | 'sheet' | 'archive' | 'audio' | 'code' | 'file'

const FAMILIES: Record<Exclude<FileIcon, 'file'>, string[]> = {
  doc:     ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages'],
  sheet:   ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  audio:   ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac'],
  code:    ['js', 'ts', 'json', 'html', 'css', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'xml', 'vue'],
}

export const fileIconFor = (name: string): FileIcon => {
  const ext = extOf(name)
  for (const [family, exts] of Object.entries(FAMILIES)) if (exts.includes(ext)) return family as FileIcon
  return 'file'
}

/** The words under a file's name on its card: "PDF · 2.4 MB". */
export const fileTypeLabel = (name: string): string => {
  const ext = extOf(name)
  if (!ext) return 'File'
  if (ext === 'pdf') return 'PDF'
  switch (fileIconFor(name)) {
    case 'archive': return `${ext.toUpperCase()} archive`
    case 'sheet':   return 'Spreadsheet'
    case 'audio':   return 'Audio'
    case 'doc':     return ext === 'txt' || ext === 'md' ? 'Text' : 'Document'
    default:        return `${ext.toUpperCase()} file`
  }
}

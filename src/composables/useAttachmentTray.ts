/**
 * The files waiting in the composer, one tray per conversation.
 *
 * A file starts uploading the moment it is added — picked, pasted or dropped —
 * so by the time the message is written it is usually already up, and Send
 * only has to name it. Send waits while anything is still going up or has
 * failed (`ready` is null then); a refused file has to be removed.
 *
 * Per conversation because people switch mid-upload: a photo added in one DM
 * must not ride along with a message sent in another. The trays live for the
 * page session.
 *
 * createAttachmentTray takes its side effects as arguments so the tests can
 * hold an upload open and look at every state; useAttachmentTray is the app's
 * one instance, wired to the real upload, the server delete and the session.
 */
import { reactive } from 'vue'
import type { Attachment } from '@/types'
import { uploadAttachment, type UploadResult } from './attachmentUpload'
import { useAuth, silentRefresh } from './useAuth'
import { useApi } from './useApi'

export type { UploadResult }

export interface TrayItem {
  id:         string
  name:       string
  size:       number
  /** A guess from the browser's type, for the tile; the server's sniffed kind
   *  comes back on `attachment`. */
  kind:       'image' | 'video' | 'file'
  previewUrl: string | null
  state:      'uploading' | 'done' | 'failed' | 'refused'
  progress:   number
  error:      string | null
  attachment: Attachment | null
  file:       File
}

export interface TrayDeps {
  upload(file: File, opts: { onProgress(f: number): void; signal: AbortSignal }): Promise<UploadResult>
  discard(key: string): Promise<void>
  objectUrl(f: File): string | null
  revoke(url: string): void
}

export interface Limits { maxBytes: number; maxFiles: number }

/** Refusals the server will repeat however often it is asked: too big, flagged. */
const FINAL = new Set([400, 413, 422])

const guessKind = (f: File): TrayItem['kind'] =>
  f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'file'

export const createAttachmentTray = (deps: TrayDeps) => {
  const trays = reactive<Record<string, TrayItem[]>>({})
  const inFlight = new Map<string, AbortController>()
  let seq = 0

  const listFor = (conv: string): TrayItem[] => (trays[conv] ??= [])
  const find = (conv: string, id: string) => trays[conv]?.find(i => i.id === id)

  const start = (conv: string, id: string) => {
    const item = find(conv, id)
    if (!item) return
    const ctrl = new AbortController()
    inFlight.set(id, ctrl)
    item.state = 'uploading'; item.progress = 0; item.error = null
    void deps.upload(item.file, {
      onProgress: f => { const live = find(conv, id); if (live) live.progress = f },
      signal: ctrl.signal,
    }).then(r => {
      inFlight.delete(id)
      const live = find(conv, id)
      if (!live || ctrl.signal.aborted) return     // removed while it was going up
      if (r.ok) { live.state = 'done'; live.progress = 1; live.attachment = r.attachment; return }
      live.state = FINAL.has(r.status) ? 'refused' : 'failed'
      live.error = r.message
    })
  }

  const letGo = (item: TrayItem) => {
    if (item.previewUrl?.startsWith('blob:')) deps.revoke(item.previewUrl)
  }

  return {
    items: (conv: string): TrayItem[] => trays[conv] ?? [],

    /** Adds what fits; returns a message to show when some files did not. */
    add(conv: string, files: File[], limits: Limits): string | null {
      const list = listFor(conv)
      const room = Math.max(0, limits.maxFiles - list.length)
      const mb = Math.round(limits.maxBytes / (1024 * 1024))
      for (const file of files.slice(0, room)) {
        const id = `t${++seq}`
        const kind = guessKind(file)
        const tooBig = file.size > limits.maxBytes
        const empty = file.size === 0
        list.push({
          id, name: file.name, size: file.size, kind,
          previewUrl: kind === 'image' ? deps.objectUrl(file) : null,
          state: tooBig || empty ? 'refused' : 'uploading',
          progress: 0,
          error: tooBig ? `Over ${mb} MB` : empty ? 'Empty file' : null,
          attachment: null, file,
        })
        if (!tooBig && !empty) start(conv, id)
      }
      return files.length > room ? `You can attach up to ${limits.maxFiles} files to one message.` : null
    },

    /** The ×: stops an upload in flight, or throws away one already up. */
    remove(conv: string, id: string): void {
      const list = trays[conv]
      const at = list?.findIndex(i => i.id === id) ?? -1
      if (!list || at < 0) return
      const [item] = list.splice(at, 1)
      inFlight.get(id)?.abort()
      inFlight.delete(id)
      if (item.state === 'done' && item.attachment) void deps.discard(item.attachment.key).catch(() => {})
      letGo(item)
    },

    retry(conv: string, id: string): void {
      if (find(conv, id)?.state === 'failed') start(conv, id)
    },

    /** The uploaded files, in order — or null while anything isn't up yet. */
    ready(conv: string): Attachment[] | null {
      const list = trays[conv] ?? []
      if (list.some(i => i.state !== 'done' || !i.attachment)) return null
      return list.map(i => i.attachment!)
    },

    /**
     * Empties the tray for a send without discarding anything. Local previews
     * are let go here; the uploaded file stands in for one if the send fails
     * and `restore` puts the items back.
     */
    take(conv: string): TrayItem[] {
      const list = trays[conv] ?? []
      trays[conv] = []
      for (const item of list) {
        letGo(item)
        if (item.kind === 'image' && item.attachment) item.previewUrl = item.attachment.url
      }
      return list
    },

    restore(conv: string, items: TrayItem[]): void {
      trays[conv] = [...items, ...(trays[conv] ?? [])]
    },
  }
}

export type AttachmentTray = ReturnType<typeof createAttachmentTray>

let shared: AttachmentTray | null = null

/**
 * The app's tray. Each upload reads the session as it starts, and a 401 gets
 * one silent refresh and one more try — a tray can outlast an access token.
 */
export const useAttachmentTray = (): AttachmentTray => {
  if (shared) return shared
  const { accessToken } = useAuth()
  const api = useApi()
  shared = createAttachmentTray({
    async upload(file, opts) {
      const first = await uploadAttachment(file, accessToken.value, opts)
      if (first.ok || first.status !== 401 || opts.signal.aborted) return first
      if (!(await silentRefresh()) || !accessToken.value) return first
      return uploadAttachment(file, accessToken.value, opts)
    },
    discard: key => api.discardAttachment(key).then(() => undefined),
    objectUrl: f => { try { return URL.createObjectURL(f) } catch { return null } },
    revoke: url => { try { URL.revokeObjectURL(url) } catch { /* already gone */ } },
  })
  return shared
}

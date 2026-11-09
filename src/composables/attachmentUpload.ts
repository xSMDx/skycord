/**
 * One attachment upload, over XHR because fetch cannot report upload
 * progress. The tray (useAttachmentTray) decides when to call this and what
 * a failure means; this only moves the bytes and reads the answer.
 */
import type { Attachment } from '@/types'

export type UploadResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; status: number; message: string }

const NOT_REACHED = 'Couldn’t reach the server.'

export const uploadAttachment = (
  file: File,
  token: string | null,
  opts: { onProgress(fraction: number): void; signal: AbortSignal },
): Promise<UploadResult> =>
  new Promise(resolve => {
    if (opts.signal.aborted) { resolve({ ok: false, status: 0, message: 'The upload was stopped.' }); return }
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/messages/attachments')
    // Always plain bytes: the server judges the type from the contents, and a
    // claimed application/json would invite a body parser to read it first.
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name))
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.withCredentials = true

    xhr.upload.onprogress = e => { if (e.lengthComputable && e.total) opts.onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let body: { attachment?: Attachment; message?: string } = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* the status says enough */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.attachment) {
        resolve({ ok: true, attachment: body.attachment })
        return
      }
      resolve({ ok: false, status: xhr.status, message: body.message || `Upload failed (${xhr.status}).` })
    }
    xhr.onerror = () => resolve({ ok: false, status: 0, message: NOT_REACHED })
    xhr.onabort = () => resolve({ ok: false, status: 0, message: 'The upload was stopped.' })
    opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })

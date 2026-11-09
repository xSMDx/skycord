/**
 * Where attachment bytes live: GridFS, bucket `attachments`.
 *
 * The same trade trackStore.ts makes for music, for the same reason — Mongo is
 * already running on the self-hoster's old machine, GridFS costs nothing new,
 * has no 16 MB ceiling, and is in whatever backup they already take.
 */
import mongoose, { Types } from 'mongoose'
import { Readable } from 'stream'
import type { EmbeddedAttachment, WireAttachment } from '../models/Attachment'

export const BUCKET = 'attachments'

export interface AttachmentRef { kind: 'gridfs'; id: Types.ObjectId }

let _bucket: mongoose.mongo.GridFSBucket | null = null

/** Lazily, and rebuilt when the connection is replaced (between tests). */
const bucket = (): mongoose.mongo.GridFSBucket => {
  const db = mongoose.connection.db
  if (!db) throw new Error('Attachment storage used before MongoDB connected')
  if (!_bucket || (_bucket as unknown as { s?: { db?: unknown } }).s?.db !== db) {
    _bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET })
  }
  return _bucket
}

export const attachmentStore = {
  async put(buf: Buffer, meta: { ownerId: Types.ObjectId | string; mime: string }): Promise<AttachmentRef> {
    const up = bucket().openUploadStream(new Types.ObjectId().toHexString(), {
      metadata: { ownerId: meta.ownerId, mimeType: meta.mime },
    })
    await new Promise<void>((resolve, reject) => {
      up.on('error', reject)
      up.on('finish', resolve)
      Readable.from([buf]).pipe(up)
    })
    return { kind: 'gridfs', id: up.id as Types.ObjectId }
  },

  /** `range` is inclusive at both ends, as HTTP means it. GridFS takes `end`
   *  exclusive — conflating the two drops the last byte of every range. */
  open(ref: AttachmentRef, range?: { start: number; end: number }): Readable {
    return range
      ? bucket().openDownloadStream(ref.id, { start: range.start, end: range.end + 1 })
      : bucket().openDownloadStream(ref.id)
  },

  async remove(ref: AttachmentRef): Promise<void> {
    try { await bucket().delete(ref.id) } catch { /* already gone */ }
  },
}

/** Relative, so it works on every origin the client is served from. */
export const attachmentUrl = (key: string, name: string): string =>
  `/messages/attachments/${key}/${encodeURIComponent(name)}`

export const toWire = (a: EmbeddedAttachment): WireAttachment => ({
  key: a.key, name: a.name, size: a.size, mime: a.mime, kind: a.kind,
  width: a.width ?? null, height: a.height ?? null,
  url: attachmentUrl(a.key, a.name),
})

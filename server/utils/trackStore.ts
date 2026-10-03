/**
 * Where track audio actually lives.
 *
 * GridFS, for a reason that is about who runs this rather than about what is
 * fastest. A hosted instance would be better served by S3; a self-hoster on
 * the hardware PRODUCT.md targets will not stand up MinIO to listen to music
 * with four friends, and Mongo is already a hard dependency. GridFS costs
 * nothing new to run, streams rather than buffers, has no 16MB ceiling, and
 * is included in whatever backup the instance already takes.
 *
 * It is genuinely slower than a filesystem and much slower than S3 under
 * load. That is the trade, and the interface below is what makes it
 * reversible: an S3TrackStore is a new file, not a refactor.
 */
import mongoose, { Types } from 'mongoose'
import type { Readable } from 'stream'

export interface StoredRef {
  kind: 'gridfs'
  id:   Types.ObjectId
}

export interface PutMeta {
  /** Owner, so an orphan sweep can attribute what it finds. */
  ownerId:  Types.ObjectId
  mimeType: string
}

export interface TrackStore {
  put(src: Readable, meta: PutMeta): Promise<{ ref: StoredRef; bytes: number }>
  /** A readable over the stored bytes. `range` is inclusive, as HTTP means it. */
  open(ref: StoredRef, range?: { start: number; end?: number }): Readable
  remove(ref: StoredRef): Promise<void>
}

/** Bucket name is fixed: it is part of the on-disk layout, not a preference. */
export const BUCKET = 'musicAudio'

let _bucket: mongoose.mongo.GridFSBucket | null = null

/**
 * Resolved lazily rather than at import time. A GridFSBucket binds to a live
 * Db, and this module is imported while mongoose is still connecting — taking
 * the handle at import captures a connection that is not ready yet.
 */
export const bucket = (): mongoose.mongo.GridFSBucket => {
  const db = mongoose.connection.db
  if (!db) throw new Error('Track storage used before MongoDB connected')
  // Rebuild if the connection was replaced, which happens between tests.
  if (!_bucket || (_bucket as unknown as { s?: { db?: unknown } }).s?.db !== db) {
    _bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET })
  }
  return _bucket
}

export class GridFsTrackStore implements TrackStore {
  async put(src: Readable, meta: PutMeta): Promise<{ ref: StoredRef; bytes: number }> {
    const up = bucket().openUploadStream(new Types.ObjectId().toHexString(), {
      metadata: { ownerId: meta.ownerId, mimeType: meta.mimeType },
    })

    await new Promise<void>((resolve, reject) => {
      // Both ends are wired before piping. A source that errors synchronously
      // on the first read would otherwise emit before anything is listening,
      // and the await never settles.
      src.on('error', err => { up.destroy(err as Error); reject(err) })
      up.on('error', reject)
      up.on('finish', resolve)
      src.pipe(up)
    })

    return {
      ref:   { kind: 'gridfs', id: up.id as Types.ObjectId },
      bytes: up.length,
    }
  }

  open(ref: StoredRef, range?: { start: number; end?: number }): Readable {
    // GridFS takes `end` exclusive; HTTP Range is inclusive at both ends, and
    // conflating the two drops the last byte of every ranged response.
    return bucket().openDownloadStream(ref.id, range && {
      start: range.start,
      ...(range.end !== undefined ? { end: range.end + 1 } : {}),
    })
  }

  async remove(ref: StoredRef): Promise<void> {
    try {
      await bucket().delete(ref.id)
    } catch (err) {
      // Already gone is the success case: this runs on track delete, and a
      // retry after a half-finished delete must not strand the document.
      const msg = String((err as Error)?.message ?? '')
      if (!/file not found|FileNotFound/i.test(msg)) throw err
    }
  }
}

export const trackStore: TrackStore = new GridFsTrackStore()

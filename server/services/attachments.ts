/**
 * What happens to an uploaded file once a message names it.
 *
 * Every send path — socket dm:send, dm:reply, group:send; REST DM, group and
 * channel — calls claimAttachments with the keys the client sent, before it
 * creates the message, and releaseClaims if creating it then fails. One
 * helper so the six paths cannot drift on who may send what.
 *
 * Mongo is a standalone 4.4 here: no transactions. The claim is a single
 * conditional updateMany (only the sender's own, only if still unsent), and a
 * short count means somebody else got there first or a key was never valid —
 * in which case whatever this call did claim is put back before refusing.
 */
import { Types } from 'mongoose'
import { Attachment, type EmbeddedAttachment, type WireAttachment } from '../models/Attachment'
import type { AttachmentKind } from '../utils/attachmentSniff'
import { MAX_FILES } from '../utils/attachmentLimits'
import { toWire } from '../utils/attachmentStore'

export type ClaimResult =
  | { ok: true; attachments: EmbeddedAttachment[] }
  | { ok: false; status: 400 | 409; message: string }

const MISSING = 'An attachment is missing or was already sent.'

export const claimAttachments = async (
  keys: unknown, ownerId: string, messageId: Types.ObjectId, conversationId: string,
): Promise<ClaimResult> => {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: true, attachments: [] }
  // A non-string key is a malformed request, not "no attachments": refusing
  // it keeps an object like { $ne: null } from ever reaching a query.
  if (!keys.every(k => typeof k === 'string' && k.length > 0 && k.length <= 64)) {
    return { ok: false, status: 409, message: MISSING }
  }
  const wanted = [...new Set(keys as string[])]
  if (wanted.length > MAX_FILES) {
    return { ok: false, status: 400, message: `A message can carry at most ${MAX_FILES} files.` }
  }

  const res = await Attachment.updateMany(
    { key: { $in: wanted }, ownerId, messageId: null },
    { $set: { messageId, conversationId } },
  )
  if (res.modifiedCount !== wanted.length) {
    await releaseClaims(messageId)
    return { ok: false, status: 409, message: MISSING }
  }

  const docs = await Attachment.find({ key: { $in: wanted }, messageId }).lean()
  const byKey = new Map(docs.map(d => [d.key, d]))
  const attachments = wanted.map(k => {
    const d = byKey.get(k)!
    return { key: d.key, name: d.name, size: d.size, mime: d.mime, kind: d.kind, width: d.width ?? null, height: d.height ?? null }
  })
  return { ok: true, attachments }
}

/** Put back everything one message claimed — for a send that failed after claiming. */
export const releaseClaims = async (messageId: Types.ObjectId): Promise<void> => {
  await Attachment.updateMany({ messageId }, { $set: { messageId: null, conversationId: null } })
}

export const wireAttachments = (list: EmbeddedAttachment[] | undefined | null): WireAttachment[] =>
  (list ?? []).map(toWire)

/**
 * Enough about a message's files to describe them in one line ("Sent 3
 * photos", "GIF", "notes.pdf") where the files themselves are not shown — a
 * reply pill, the DM list. `kind` is the shared kind, or `file` for a mix.
 */
export interface AttachmentSummary { count: number; kind: AttachmentKind; name: string; mime: string }

export const summarize = (list: readonly EmbeddedAttachment[] | undefined | null): AttachmentSummary | null => {
  if (!list || list.length === 0) return null
  const [first] = list
  const kind = list.every(a => a.kind === first.kind) ? first.kind : 'file'
  return { count: list.length, kind, name: first.name, mime: first.mime }
}

/** Whether a send named any files at all — what decides if empty text is allowed. */
export const hasKeys = (keys: unknown): boolean => Array.isArray(keys) && keys.length > 0

/**
 * Claim, create, and give the claim back if creating fails — the one
 * sequence every send path runs. The message id is made here so the claim
 * can point at it before the message exists.
 */
export const createWithAttachments = async <T>(
  keys: unknown, ownerId: string, conversationId: string,
  create: (id: Types.ObjectId, attachments: EmbeddedAttachment[]) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; status: 400 | 409; message: string }> => {
  const id = new Types.ObjectId()
  const claim = await claimAttachments(keys, ownerId, id, conversationId)
  if (!claim.ok) return claim
  try {
    return { ok: true, value: await create(id, claim.attachments) }
  } catch (err) {
    if (claim.attachments.length) await releaseClaims(id)
    throw err
  }
}

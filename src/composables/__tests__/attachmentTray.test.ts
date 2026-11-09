/**
 * The composer's tray: files upload the moment they are added, each belongs
 * to the conversation it was added in, and Send waits until every one is up.
 *
 * The upload itself is faked: each call returns a promise the test settles,
 * so every in-between state (uploading, failed, cancelled) can be looked at.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createAttachmentTray, type UploadResult } from '../useAttachmentTray'
import type { Attachment } from '@/types'

type Pending = { file: File; resolve: (r: UploadResult) => void; signal: AbortSignal; progress: (f: number) => void }

let pending: Pending[]
let discarded: string[]
let revoked: string[]
const L = { maxBytes: 1000, maxFiles: 3 }

const tray = () => createAttachmentTray({
  upload: (file, { onProgress, signal }) => new Promise<UploadResult>(resolve => {
    pending.push({ file, resolve, signal, progress: onProgress })
  }),
  discard: async key => { discarded.push(key) },
  objectUrl: f => (f.type.startsWith('image/') ? `blob:${f.name}` : null),
  revoke: url => { revoked.push(url) },
})

const file = (name: string, size = 10, type = 'application/octet-stream') => new File([new Uint8Array(size)], name, { type })
const done = (name: string): UploadResult => ({
  ok: true,
  attachment: { key: `key-${name}`, name, size: 10, mime: 'image/png', kind: 'image', width: 1, height: 1, url: `/messages/attachments/key-${name}/${name}` } as Attachment,
})
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => { pending = []; discarded = []; revoked = [] })

describe('the tray', () => {
  it('uploads on add and is ready only when every item is done', async () => {
    const t = tray()
    expect(t.ready('dm:a')).toEqual([])
    t.add('dm:a', [file('one.png', 10, 'image/png'), file('two.pdf')], L)
    expect(t.items('dm:a').map(i => i.state)).toEqual(['uploading', 'uploading'])
    expect(t.items('dm:a')[0].previewUrl).toBe('blob:one.png')
    expect(t.ready('dm:a')).toBeNull()

    pending[0].progress(0.5)
    expect(t.items('dm:a')[0].progress).toBe(0.5)

    pending[0].resolve(done('one.png')); await flush()
    expect(t.ready('dm:a')).toBeNull()
    pending[1].resolve(done('two.pdf')); await flush()
    expect(t.ready('dm:a')?.map(a => a.key)).toEqual(['key-one.png', 'key-two.pdf'])
  })

  it('refuses a file over maxBytes without uploading it', () => {
    const t = tray()
    t.add('dm:a', [file('big.zip', 1001)], { maxBytes: 1000, maxFiles: 10 })
    expect(pending).toHaveLength(0)
    expect(t.items('dm:a')[0]).toMatchObject({ state: 'refused', error: 'Over 0 MB' })
    expect(t.ready('dm:a')).toBeNull()
  })

  it('names the limit in megabytes', () => {
    const t = tray()
    t.add('dm:a', [file('big.zip', 26 * 1024 * 1024)], { maxBytes: 25 * 1024 * 1024, maxFiles: 10 })
    expect(t.items('dm:a')[0].error).toBe('Over 25 MB')
  })

  it('refuses an empty file', () => {
    const t = tray()
    t.add('dm:a', [file('empty.txt', 0)], L)
    expect(t.items('dm:a')[0]).toMatchObject({ state: 'refused', error: 'Empty file' })
  })

  it('keeps at most maxFiles and says so', () => {
    const t = tray()
    const msg = t.add('dm:a', [file('1'), file('2'), file('3'), file('4'), file('5')], L)
    expect(t.items('dm:a')).toHaveLength(3)
    expect(msg).toBe('You can attach up to 3 files to one message.')
    expect(t.add('dm:a', [file('6')], L)).toBe('You can attach up to 3 files to one message.')
    expect(t.items('dm:a')).toHaveLength(3)
    expect(tray().add('dm:b', [file('x')], L)).toBeNull()
  })

  it('cancels an upload in flight on remove', () => {
    const t = tray()
    t.add('dm:a', [file('one.png', 10, 'image/png')], L)
    t.remove('dm:a', t.items('dm:a')[0].id)
    expect(pending[0].signal.aborted).toBe(true)
    expect(t.items('dm:a')).toEqual([])
    expect(revoked).toEqual(['blob:one.png'])
    expect(discarded).toEqual([])
  })

  it('ignores an upload that finishes after it was removed', async () => {
    const t = tray()
    t.add('dm:a', [file('one.png')], L)
    t.remove('dm:a', t.items('dm:a')[0].id)
    pending[0].resolve(done('one.png')); await flush()
    expect(t.items('dm:a')).toEqual([])
  })

  it('discards an uploaded file on remove', async () => {
    const t = tray()
    t.add('dm:a', [file('one.png')], L)
    pending[0].resolve(done('one.png')); await flush()
    t.remove('dm:a', t.items('dm:a')[0].id)
    expect(discarded).toEqual(['key-one.png'])
  })

  it('marks a failed upload and retries it', async () => {
    const t = tray()
    t.add('dm:a', [file('one.png')], L)
    pending[0].resolve({ ok: false, status: 503, message: 'Can’t check files for viruses right now.' }); await flush()
    expect(t.items('dm:a')[0]).toMatchObject({ state: 'failed', error: 'Can’t check files for viruses right now.' })
    expect(t.ready('dm:a')).toBeNull()

    t.retry('dm:a', t.items('dm:a')[0].id)
    expect(t.items('dm:a')[0]).toMatchObject({ state: 'uploading', error: null, progress: 0 })
    pending[1].resolve(done('one.png')); await flush()
    expect(t.items('dm:a')[0].state).toBe('done')
  })

  it('treats a size or virus refusal as final, not retryable', async () => {
    const t = tray()
    t.add('dm:a', [file('a'), file('b')], L)
    pending[0].resolve({ ok: false, status: 413, message: 'That file is over the 25 MB limit.' })
    pending[1].resolve({ ok: false, status: 422, message: 'The virus scanner flagged this file, so it wasn’t uploaded.' })
    await flush()
    expect(t.items('dm:a').map(i => i.state)).toEqual(['refused', 'refused'])
  })

  it('trays are per conversation', () => {
    const t = tray()
    t.add('dm:a', [file('one.png')], L)
    t.add('chan:b', [file('two.pdf')], L)
    expect(t.items('dm:a').map(i => i.name)).toEqual(['one.png'])
    expect(t.items('chan:b').map(i => i.name)).toEqual(['two.pdf'])
    expect(t.items('group:c')).toEqual([])
  })

  it('take() empties the tray without discarding; restore() puts items back', async () => {
    const t = tray()
    t.add('dm:a', [file('one.png', 10, 'image/png')], L)
    pending[0].resolve(done('one.png')); await flush()
    const taken = t.take('dm:a')
    expect(t.items('dm:a')).toEqual([])
    expect(discarded).toEqual([])
    // The local preview is let go; the uploaded file stands in for it.
    expect(revoked).toEqual(['blob:one.png'])
    expect(taken[0].previewUrl).toBe('/messages/attachments/key-one.png/one.png')

    t.restore('dm:a', taken)
    expect(t.ready('dm:a')?.map(a => a.key)).toEqual(['key-one.png'])
  })
})

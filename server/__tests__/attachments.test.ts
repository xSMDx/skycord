/**
 * Chat attachments: upload, serve, discard — before any message names them.
 *
 * What a sent attachment looks like on a message is attachmentClaim and
 * attachmentSends; this file is the file itself: what is accepted, what it
 * is called, how it is served back, and who may throw an unsent one away.
 */
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { createServer, type Server, type AddressInfo } from 'node:net'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { createApp } from '../app'
import { config } from '../config/env'
import { Attachment } from '../models/Attachment'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const DEFAULT_MAX = config.attachments.maxBytes
afterEach(() => {
  config.attachments.maxBytes = DEFAULT_MAX
  delete process.env.CLAMD_HOST
  delete process.env.CLAMD_PORT
  delete process.env.CLAMD_TIMEOUT_MS
})

const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const png = (w: number, h: number) => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  be32(13), Buffer.from('IHDR'), be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0]),
])

const upload = (u: TestUser, body: Buffer, name: string, type = 'application/octet-stream') =>
  app().post('/messages/attachments').set(auth(u))
    .set('Content-Type', type).set('X-Filename', encodeURIComponent(name)).send(body)

describe('upload', () => {
  let u: TestUser
  beforeEach(async () => { u = await register() })

  it('refuses an upload without a token', async () => {
    const r = await app().post('/messages/attachments').set('Content-Type', 'image/png').send(png(1, 1))
    expect(r.status).toBe(401)
  })

  it('stores a PNG and returns its metadata and url', async () => {
    const r = await upload(u, png(4, 3), 'cat pic.png', 'image/png')
    expect(r.status).toBe(201)
    expect(r.body.attachment).toMatchObject({ name: 'cat pic.png', kind: 'image', mime: 'image/png', width: 4, height: 3, size: 29 })
    expect(r.body.attachment.key).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(r.body.attachment.url).toBe(`/messages/attachments/${r.body.attachment.key}/cat%20pic.png`)
    const doc = await Attachment.findOne({ key: r.body.attachment.key }).lean()
    expect(doc?.ownerId.toString()).toBe(u.id)
    expect(doc?.messageId).toBeNull()
  })

  it('cleans the name it was given', async () => {
    const r = await upload(u, Buffer.from('hello'), '../../secret\r\n.txt')
    expect(r.body.attachment.name).toBe('secret.txt')
  })

  it('takes a JSON or form file as bytes, not as a request body to parse', async () => {
    // A string, not a Buffer: supertest would JSON-encode a Buffer sent as application/json.
    const json = await app().post('/messages/attachments').set(auth(u))
      .set('Content-Type', 'application/json').set('X-Filename', 'config.json').send('{"a":1}')
    expect(json.status).toBe(201)
    expect(json.body.attachment).toMatchObject({ name: 'config.json', kind: 'file', size: 7 })
    const form = await app().post('/messages/attachments').set(auth(u))
      .set('Content-Type', 'application/x-www-form-urlencoded').set('X-Filename', 'form.txt').send('a=1&b=2')
    expect(form.status).toBe(201)
    expect(form.body.attachment.size).toBe(7)
  })

  it('refuses an empty file', async () => {
    const r = await upload(u, Buffer.alloc(0), 'empty.txt')
    expect(r.status).toBe(400)
  })

  it('refuses a declared Content-Length over the cap with 413', async () => {
    config.attachments.maxBytes = 100
    const r = await upload(u, Buffer.alloc(101, 1), 'big.bin')
    expect(r.status).toBe(413)
    expect(r.body.message).toMatch(/limit/)
    expect(await Attachment.countDocuments()).toBe(0)
  })

  it('refuses a streamed body over the cap with 413 even with no Content-Length', async () => {
    config.attachments.maxBytes = 100
    const server = http.createServer(createApp())
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const { port } = server.address() as AddressInfo
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/messages/attachments',
        headers: { ...auth(u), 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked', 'X-Filename': 'x.bin' },
      }, res => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject)
      for (let i = 0; i < 5; i++) req.write(Buffer.alloc(50, 1))
      req.end()
    })
    await new Promise<void>(r => server.close(() => r()))
    expect(status).toBe(413)
    expect(await Attachment.countDocuments()).toBe(0)
  })
})

describe('serving', () => {
  let u: TestUser
  beforeEach(async () => { u = await register() })

  it('serves an image inline with the safety headers, no sign-in needed', async () => {
    const { body } = await upload(u, png(2, 2), 'a.png', 'image/png')
    const r = await app().get(body.attachment.url)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
    expect(r.headers['content-disposition']).toMatch(/^inline; filename="a\.png"/)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(Buffer.compare(r.body as Buffer, png(2, 2))).toBe(0)
  })

  it('serves a disguised HTML file as a download', async () => {
    const { body } = await upload(u, Buffer.from('<html><script>alert(1)</script></html>'), 'photo.png', 'image/png')
    expect(body.attachment).toMatchObject({ kind: 'file', mime: 'application/octet-stream' })
    const r = await app().get(body.attachment.url)
    expect(r.headers['content-type']).toBe('application/octet-stream')
    expect(r.headers['content-disposition']).toMatch(/^attachment; /)
  })

  it('answers a Range request with 206 and the slice', async () => {
    const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
    const { body } = await upload(u, data, 'blob.bin')
    const r = await app().get(body.attachment.url).set('Range', 'bytes=10-19')
      .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    expect(r.status).toBe(206)
    expect(r.headers['content-range']).toBe('bytes 10-19/1000')
    expect(Buffer.compare(r.body as Buffer, data.subarray(10, 20))).toBe(0)
  })

  it('refuses an unsatisfiable range with 416', async () => {
    const { body } = await upload(u, Buffer.alloc(10, 1), 'ten.bin')
    const r = await app().get(body.attachment.url).set('Range', 'bytes=50-60')
    expect(r.status).toBe(416)
  })

  it('404s an unknown key', async () => {
    const r = await app().get('/messages/attachments/AAAAAAAAAAAAAAAAAAAAAA/x.png')
    expect(r.status).toBe(404)
  })
})

describe('scanning', () => {
  let clamd: Server | null = null
  afterEach(() => new Promise<void>(r => { if (clamd) clamd.close(() => r()); else r(); clamd = null }))

  /** A clamd that finds anything containing "EICAR". */
  const startClamd = (): Promise<number> => new Promise(resolve => {
    clamd = createServer(sock => {
      let all = Buffer.alloc(0)
      sock.on('error', () => {})
      sock.on('data', (c: Buffer) => {
        all = Buffer.concat([all, c])
        if (all.length >= 4 && all.subarray(-4).readUInt32BE(0) === 0) {
          sock.end(all.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0')
        }
      })
    })
    clamd.listen(0, '127.0.0.1', () => resolve((clamd!.address() as AddressInfo).port))
  })

  it('refuses an infected file with 422 and stores nothing', async () => {
    const u = await register()
    process.env.CLAMD_HOST = '127.0.0.1'
    process.env.CLAMD_PORT = String(await startClamd())
    const r = await upload(u, Buffer.from('X5O!P%@AP EICAR test'), 'bad.com')
    expect(r.status).toBe(422)
    expect(await Attachment.countDocuments()).toBe(0)
  })

  it('accepts a clean file when the scanner is on', async () => {
    const u = await register()
    process.env.CLAMD_HOST = '127.0.0.1'
    process.env.CLAMD_PORT = String(await startClamd())
    expect((await upload(u, Buffer.from('fine'), 'ok.txt')).status).toBe(201)
  })

  it('refuses with 503 when the scanner is configured but unreachable', async () => {
    const u = await register()
    const port = await startClamd()
    await new Promise<void>(r => clamd!.close(() => r())); clamd = null
    process.env.CLAMD_HOST = '127.0.0.1'
    process.env.CLAMD_PORT = String(port)
    const r = await upload(u, Buffer.from('fine'), 'ok.txt')
    expect(r.status).toBe(503)
    expect(await Attachment.countDocuments()).toBe(0)
  })
})

describe('discarding an unsent upload', () => {
  it('lets the owner discard it, and nobody else', async () => {
    const a = await register(), b = await register()
    const { body } = await upload(a, Buffer.from('mine'), 'mine.txt')
    const key = body.attachment.key

    expect((await app().delete(`/messages/attachments/${key}`).set(auth(b))).status).toBe(404)
    expect((await app().get(body.attachment.url)).status).toBe(200)

    expect((await app().delete(`/messages/attachments/${key}`).set(auth(a))).status).toBe(200)
    expect((await app().get(body.attachment.url)).status).toBe(404)
  })

  it('will not discard one already sent', async () => {
    const a = await register()
    const { body } = await upload(a, Buffer.from('sent'), 'sent.txt')
    await Attachment.updateOne({ key: body.attachment.key }, { $set: { messageId: new (await import('mongoose')).Types.ObjectId(), conversationId: 'c' } })
    expect((await app().delete(`/messages/attachments/${body.attachment.key}`).set(auth(a))).status).toBe(404)
  })
})

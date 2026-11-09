/**
 * The API's clamd client — the music service's, copied (music/ is its own
 * package) — against a fake clamd that answers byte for byte as the real one
 * does, NUL included. See music/__tests__/clamav.test.ts for why the NUL is
 * the whole point of testing this at all.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, type AddressInfo } from 'net'
import { scanBuffer, clamConfigFromEnv } from '../utils/clamav'

let server: Server | null = null
afterEach(() => new Promise<void>(r => { if (server) server.close(() => r()); else r(); server = null }))

/** Reads one zINSTREAM and answers with `reply(bytes)`, NUL-terminated. */
const fakeClamd = (reply: (bytes: Buffer) => string | null): Promise<number> =>
  new Promise(resolve => {
    server = createServer(sock => {
      let buf = Buffer.alloc(0)
      let body = Buffer.alloc(0)
      let seenCommand = false
      sock.on('error', () => {})
      sock.on('data', (c: Buffer) => {
        buf = Buffer.concat([buf, c])
        if (!seenCommand) {
          const nul = buf.indexOf(0)
          if (nul < 0) return
          expect(buf.subarray(0, nul).toString()).toBe('zINSTREAM')
          buf = buf.subarray(nul + 1)
          seenCommand = true
        }
        while (buf.length >= 4) {
          const len = buf.readUInt32BE(0)
          if (len === 0) {
            const r = reply(body)
            if (r !== null) sock.end(`${r}\0`)   // null: never answer
            return
          }
          if (buf.length < 4 + len) return
          body = Buffer.concat([body, buf.subarray(4, 4 + len)])
          buf = buf.subarray(4 + len)
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port))
  })

const cfg = (port: number, timeoutMs = 5_000) => ({ host: '127.0.0.1', port, timeoutMs })
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

describe('scanBuffer', () => {
  it('a clean file is clean — with the NUL clamd puts on the end', async () => {
    const port = await fakeClamd(() => 'stream: OK')
    await expect(scanBuffer(Buffer.from('a photo'), cfg(port))).resolves.toEqual({ state: 'clean' })
  })

  it('a match is infected, and names the signature', async () => {
    const port = await fakeClamd(b => (b.toString().includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK'))
    await expect(scanBuffer(Buffer.from(EICAR), cfg(port)))
      .resolves.toEqual({ state: 'infected', signature: 'Eicar-Test-Signature' })
  })

  it('sends the whole buffer in length-prefixed chunks', async () => {
    let got = 0
    const port = await fakeClamd(b => { got = b.length; return 'stream: OK' })
    await scanBuffer(Buffer.alloc(200_000, 7), cfg(port))   // more than three 64 KiB chunks
    expect(got).toBe(200_000)
  })

  it('an empty buffer still gets an answer', async () => {
    const port = await fakeClamd(() => 'stream: OK')
    await expect(scanBuffer(Buffer.alloc(0), cfg(port))).resolves.toEqual({ state: 'clean' })
  })

  it('nobody listening is an error — the caller refuses the file', async () => {
    const port = await fakeClamd(() => 'stream: OK')
    await new Promise<void>(r => server!.close(() => r())); server = null
    expect((await scanBuffer(Buffer.from('x'), cfg(port))).state).toBe('error')
  })

  it('a scanner that never answers is an error after the timeout', async () => {
    const port = await fakeClamd(() => null)
    expect((await scanBuffer(Buffer.from('x'), cfg(port, 200))).state).toBe('error')
  })
})

describe('clamConfigFromEnv', () => {
  it('is off without a host', () => expect(clamConfigFromEnv({})).toBeNull())

  it('defaults the port and the timeout', () =>
    expect(clamConfigFromEnv({ CLAMD_HOST: 'h' })).toEqual({ host: 'h', port: 3310, timeoutMs: 120_000 }))

  it('ignores a port that is not a number', () =>
    expect(clamConfigFromEnv({ CLAMD_HOST: 'h', CLAMD_PORT: 'nope' })?.port).toBe(3310))

  it('reads its own variables, not the music service\'s', () =>
    expect(clamConfigFromEnv({ MUSIC_CLAMD_HOST: 'clamav' })).toBeNull())
})

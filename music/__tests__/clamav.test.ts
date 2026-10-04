/// <reference types="node" />
/**
 * The clamd client against a fake clamd that answers the way the real one
 * does — byte for byte, including the NUL that ends every reply to a
 * z-prefixed command.
 *
 * That NUL is why this file exists. The client trimmed the reply with
 * String.trim(), which leaves NUL alone, so "stream: OK\0" never matched
 * "ends with OK" and every clean file came back as a scanner error. With a
 * scanner configured, every upload was refused. Nothing caught it, because
 * nothing had ever spoken to a clamd — real or fake.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, type AddressInfo } from 'net'
import { Readable } from 'stream'
import { scanStream, clamConfigFromEnv } from '../src/clamav.js'

let server: Server | null = null
afterEach(() => new Promise<void>(r => { if (server) server.close(() => r()); else r(); server = null }))

/**
 * A clamd that reads one zINSTREAM, collects the chunks, and answers with
 * whatever `reply` says about the bytes it got — NUL-terminated, as clamd
 * terminates every reply to a z command.
 */
const fakeClamd = (reply: (bytes: Buffer) => string): Promise<number> =>
  new Promise(resolve => {
    server = createServer(sock => {
      let buf = Buffer.alloc(0)
      let body = Buffer.alloc(0)
      let seenCommand = false
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
            sock.end(`${reply(body)}\0`)
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

const cfg = (port: number) => ({ host: '127.0.0.1', port, timeoutMs: 5_000 })
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

describe('talking to clamd', () => {
  it('a clean file is clean — with the NUL clamd puts on the end', async () => {
    const port = await fakeClamd(() => 'stream: OK')
    await expect(scanStream(Readable.from([Buffer.from('music')]), cfg(port))).resolves.toEqual({ state: 'clean' })
  })

  it('a match is infected, and names the signature', async () => {
    const port = await fakeClamd(b => (b.toString().includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK'))
    await expect(scanStream(Readable.from([Buffer.from(EICAR)]), cfg(port)))
      .resolves.toEqual({ state: 'infected', signature: 'Eicar-Test-Signature' })
  })

  it('sends the whole file, in length-prefixed chunks, however it arrives', async () => {
    let got = 0
    const port = await fakeClamd(b => { got = b.length; return 'stream: OK' })
    const big = Buffer.alloc(200_000, 7)                // more than one 64 KiB chunk
    await scanStream(Readable.from([big.subarray(0, 70_000), big.subarray(70_000)]), cfg(port))
    expect(got).toBe(200_000)
  })

  it('an ERROR reply is an error, never clean', async () => {
    const port = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR')
    const v = await scanStream(Readable.from([Buffer.from('x')]), cfg(port))
    expect(v.state).toBe('error')
  })

  it('nobody listening is an error — the caller refuses the file', async () => {
    const port = await fakeClamd(() => 'stream: OK')
    await new Promise<void>(r => server!.close(() => r())); server = null
    const v = await scanStream(Readable.from([Buffer.from('x')]), cfg(port))
    expect(v.state).toBe('error')
  })
})

describe('configuration', () => {
  it('is off without a host, on with one', () => {
    expect(clamConfigFromEnv({})).toBeNull()
    expect(clamConfigFromEnv({ MUSIC_CLAMD_HOST: 'clamav' })).toMatchObject({ host: 'clamav', port: 3310 })
  })
})

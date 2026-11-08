/**
 * Virus scanning through clamd's INSTREAM command, for chat attachments.
 *
 * A copy of the music service's client (`music/src/clamav.ts`) — music/ is a
 * separate package the API does not import from. Same protocol, same fail-
 * closed rule, its own variables (`CLAMD_HOST`, `CLAMD_PORT`,
 * `CLAMD_TIMEOUT_MS`), because the API and the music container are configured
 * separately even when they point at the same clamd. A fix to one belongs in
 * both.
 *
 * ## Why this is optional, and why that is not a cop-out
 *
 * A ClamAV signature database wants roughly a gigabyte of resident memory.
 * PRODUCT.md targets hardware old enough that MongoDB is pinned to 4.4 for
 * it, so making the scanner mandatory would price a self-hoster out of
 * attachments entirely. It is off unless `CLAMD_HOST` is set, on for
 * hosted instances, and documented for everyone.
 *
 * ## Why it fails closed
 *
 * The only thing worse than no scanner is a scanner everyone believes in
 * that is quietly not running. If one is configured and cannot be reached,
 * the upload is refused. An operator who wants availability over scanning
 * can unset the variable, which is a decision someone makes on purpose
 * rather than one a timeout makes for them at 3am.
 *
 * ## What it is actually for
 *
 * The download path. An attachment goes to everyone in the conversation, so a
 * planted executable that reaches another member's disk is the real risk, and
 * that is exactly what signatures are good at.
 */
import { createConnection, type Socket } from 'net'
import { Readable } from 'stream'

export type ScanVerdict =
  | { state: 'clean' }
  | { state: 'infected'; signature: string }
  /** Configured but unusable. The caller must refuse the file. */
  | { state: 'error'; detail: string }

export interface ClamConfig {
  host: string
  port: number
  /** Whole-scan deadline. clamd can sit on a big archive for a long time. */
  timeoutMs: number
}

export const clamConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ClamConfig | null => {
  const host = (env.CLAMD_HOST ?? '').trim()
  if (!host) return null
  const port = Number(env.CLAMD_PORT ?? 3310)
  const timeoutMs = Number(env.CLAMD_TIMEOUT_MS ?? 120_000)
  return {
    host,
    port:      Number.isFinite(port) && port > 0 ? Math.floor(port) : 3310,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 120_000,
  }
}

/**
 * INSTREAM framing: `zINSTREAM\0`, then length-prefixed chunks, then a zero
 * length to finish. Chunks must stay under clamd's StreamMaxLength chunk
 * ceiling; 64KB is the conventional size and well inside every default.
 */
const CHUNK = 64 * 1024

export const scanStream = (src: Readable, cfg: ClamConfig): Promise<ScanVerdict> =>
  new Promise<ScanVerdict>((resolve) => {
    let settled = false
    const finish = (v: ScanVerdict): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      src.destroy()
      sock.destroy()
      resolve(v)
    }

    const timer = setTimeout(
      () => finish({ state: 'error', detail: 'the scanner did not answer in time' }),
      cfg.timeoutMs,
    )

    const sock: Socket = createConnection({ host: cfg.host, port: cfg.port })
    sock.on('error', err => finish({ state: 'error', detail: (err as Error).message }))

    let reply = ''
    sock.on('data', (c: Buffer) => { reply += c.toString('utf8') })

    sock.on('end', () => {
      // A z-command's reply ends in NUL, and trim() leaves NUL alone — so
      // without this "stream: OK\0" never ended in OK, every clean file read
      // as a scanner error, and a configured scanner refused every upload.
      const line = reply.replace(/\0/g, '').trim()
      // `stream: OK` / `stream: Eicar-Test-Signature FOUND` / `... ERROR`
      if (/\bOK$/.test(line)) return finish({ state: 'clean' })
      const found = /^stream:\s*(.+?)\s+FOUND$/m.exec(line)
      if (found) return finish({ state: 'infected', signature: found[1] })
      finish({ state: 'error', detail: line || 'the scanner closed without answering' })
    })

    sock.on('connect', () => {
      sock.write('zINSTREAM\0')

      // Written by hand rather than piped: every chunk needs a four-byte
      // big-endian length in front of it, and the terminator is a length of
      // zero rather than the socket closing.
      src.on('data', (chunk: Buffer) => {
        for (let at = 0; at < chunk.length; at += CHUNK) {
          const part = chunk.subarray(at, Math.min(at + CHUNK, chunk.length))
          const len = Buffer.alloc(4)
          len.writeUInt32BE(part.length, 0)
          // Respect backpressure: clamd is slower than a local disk read, and
          // ignoring the return value here buffers the whole file in memory.
          if (!sock.write(Buffer.concat([len, part]))) src.pause()
        }
      })
      sock.on('drain', () => src.resume())

      src.on('end', () => {
        const zero = Buffer.alloc(4)
        zero.writeUInt32BE(0, 0)
        sock.write(zero)
      })
      src.on('error', err =>
        finish({ state: 'error', detail: `could not read the file: ${(err as Error).message}` }))
    })
  })

/**
 * An upload is already in memory by the time it is scanned (it is buffered
 * to sniff its type and enforce the size cap), so the stream is the buffer.
 */
export const scanBuffer = (buf: Buffer, cfg: ClamConfig): Promise<ScanVerdict> =>
  scanStream(Readable.from([buf]), cfg)

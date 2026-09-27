/**
 * The only process that ever loads the capture addon.
 *
 * This is the whole reason it is a separate process. It is the first native
 * code in Skycord and it runs during calls; a fault in C++ audio code should
 * cost a helper we can restart, not the call and the window.
 *
 * It owns nothing but the running capture. The main process tells it which
 * application to capture and hands it one end of a port to the page; audio
 * never travels through the main process at all.
 */
import type { MessagePortMain } from 'electron'

// Resolved from dist/, so one level up to desktop/native.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const addon = require('../native') as {
  supported: () => boolean
  start: (pid: number, onChunk: (chunk: Buffer) => void) => boolean
  stop: () => void
}

const shutDown = () => { try { addon.stop() } catch { /* already gone */ } }
process.on('SIGTERM', () => { shutDown(); process.exit(0) })
process.on('exit', shutDown)

process.parentPort.once('message', (event) => {
  const port: MessagePortMain | undefined = event.ports[0]
  const pid = (event.data as { pid?: unknown } | null)?.pid
  if (!port || typeof pid !== 'number') { process.exit(1); return }

  port.start()
  const ok = addon.start(pid, (chunk) => {
    // Electron's MessagePortMain can only transfer ports, never ArrayBuffers
    // (`transfer?: MessagePortMain[]`), so this hop is a structured-clone
    // copy whatever we do. At 3840 bytes a hundred times a second — 384 KB/s
    // — that is cheap, and the renderer's own hop into the worklet does
    // transfer. Sending a view avoids a second copy on this side.
    port.postMessage(new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4))
  })

  // The parent waits for this before it tells the page anything.
  process.parentPort.postMessage({ started: ok })
  if (!ok) process.exit(0)
})

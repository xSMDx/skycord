/**
 * Starting and stopping one application's audio capture.
 *
 * Owns the helper process and the port to the page. The addon is loaded here
 * only to read facts — the process table and a window's pid. Capture itself
 * happens in the helper, and audio never passes through this process.
 */
/**
 * Types only, and the values fetched inside the one function that needs them.
 *
 * A static `import … from 'electron'` makes this module unloadable anywhere
 * electron is not installed — which includes CI, where only the root
 * package's dependencies are installed and the test suite imports this file
 * for its pure helpers. Every other desktop module under test already avoids
 * electron at module scope; this one broke that and turned the whole suite
 * red while passing locally, where desktop/node_modules happens to exist.
 *
 * `resolveRootPid`, `pidForSource` and `supportsPerAppAudio` need nothing
 * from electron. Only `startShareAudio` does, and by then the app is running.
 */
import type { UtilityProcess, WebContents } from 'electron'
import { join } from 'path'
import { rootOfApp, type ProcRow } from './processWalk'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = (): typeof import('electron') => require('electron')

export interface CaptureAddon {
  supported: () => boolean
  pidForWindow: (hwnd: number) => number | null
  processTable: () => ProcRow[]
  start: (pid: number, onChunk: (chunk: Buffer) => void) => boolean
  stop: () => void
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nativeAddon = (): CaptureAddon => require('../native') as CaptureAddon

/** Whether this machine can capture one application's sound. */
export const supportsPerAppAudio = (addon: CaptureAddon = nativeAddon()): boolean => addon.supported()

/**
 * The application behind a window's process, or null when this machine cannot
 * capture per-app audio or the process has already gone.
 */
export const resolveRootPid = (windowPid: number, addon: CaptureAddon = nativeAddon()): number | null => {
  if (!addon.supported()) return null
  return rootOfApp(windowPid, addon.processTable())
}

/**
 * The pid behind a `window:<HWND>:0` source id, or null. desktopCapturer
 * writes the HWND in decimal, which is why this is a plain Number.
 */
export const pidForSource = (sourceId: string, addon: CaptureAddon = nativeAddon()): number | null => {
  const hwnd = Number(sourceId.split(':')[1])
  if (!addon.supported() || !Number.isInteger(hwnd) || hwnd <= 0) return null
  const windowPid = addon.pidForWindow(hwnd)
  return windowPid === null ? null : rootOfApp(windowPid, addon.processTable())
}

/** How long the helper has to say whether the capture started. */
const START_MS = 5000

let helper: UtilityProcess | null = null

/**
 * Capture `pid` and deliver it to `page`. Returns false when the helper could
 * not start it — the caller shares video without sound and says so.
 */
export const startShareAudio = async (pid: number, page: WebContents): Promise<boolean> => {
  stopShareAudio()
  const { utilityProcess, MessageChannelMain } = electron()
  const child = utilityProcess.fork(join(__dirname, 'shareAudioHelper.js'), [], { serviceName: 'skycord-share-audio' })
  helper = child

  const { port1, port2 } = new MessageChannelMain()
  // The page gets its end first, so nothing is posted into a void.
  page.postMessage('share-audio-port', null, [port1])

  const started = await new Promise<boolean>(resolve => {
    let settled = false
    const done = (value: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value) } }
    const timer = setTimeout(() => done(false), START_MS)
    child.once('message', (msg: { started?: boolean } | null) => done(msg?.started === true))
    child.once('exit', () => done(false))
    child.postMessage({ pid }, [port2])
  })

  // A helper that could not start is a helper we do not keep.
  if (!started && helper === child) stopShareAudio()
  return started
}

/** Stop and forget the helper. Safe whether or not one is running. */
export const stopShareAudio = (): void => {
  const child = helper
  helper = null
  if (child) { try { child.kill() } catch { /* already gone */ } }
}

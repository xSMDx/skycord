/**
 * Screen-share choices as plain data. The picker page offers them, the main
 * process checks what comes back, and the web client turns them into capture
 * and encoding settings. Nothing here touches Electron, so it is tested alone.
 */

export const RESOLUTIONS = [720, 1080, 1440, 'source'] as const
export const FRAME_RATES = [15, 30, 60] as const
export type Resolution = typeof RESOLUTIONS[number]
export type FrameRate = typeof FRAME_RATES[number]

export interface Quality { resolution: Resolution; frameRate: FrameRate }

/** The two presets. Any other pair is Custom. Nothing is held back. */
export const PRESETS = {
  gaming: { resolution: 720, frameRate: 60 },       // motion over sharpness
  text:   { resolution: 'source', frameRate: 15 },  // code, slides, documents
} as const satisfies Record<string, Quality>

export const DEFAULT_QUALITY: Quality = PRESETS.gaming

export interface ShareChoice extends Quality {
  sourceId: string
  name: string
  kind: 'screen' | 'window'
  audio: boolean
  /**
   * The application to capture sound from, for a window share. Null for a
   * screen (there is no single app) and null when the pid could not be
   * resolved, which means the share goes out without sound.
   */
  pid: number | null
  /** Don't show the member their own stream. Others still see it. */
  hidePreview: boolean
}

/**
 * What the app keeps between shares. Audio is remembered per kind because the
 * two mean different things: a window sends one app, a screen sends everything
 * except Skycord, and it is reasonable to want the first and not the second.
 */
export interface Remembered extends Quality {
  windowAudio: boolean
  screenAudio: boolean
  hidePreview: boolean
}

const resolutionOf = (v: unknown): Resolution => RESOLUTIONS.find(r => r === v) ?? DEFAULT_QUALITY.resolution
const frameRateOf = (v: unknown): FrameRate => FRAME_RATES.find(f => f === v) ?? DEFAULT_QUALITY.frameRate

const pidOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null

/**
 * The picker page's answer, checked. The id must be one the picker was shown.
 * A window may now carry audio — one application's sound, captured by pid —
 * and a screen may not carry a pid, because it is not one application.
 */
export const parseChoice = (value: unknown, shown: ReadonlyMap<string, string>): ShareChoice | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.sourceId !== 'string') return null
  const name = shown.get(v.sourceId)
  if (name === undefined) return null
  const kind = v.sourceId.startsWith('screen:') ? 'screen' : 'window'
  return {
    sourceId: v.sourceId,
    name,
    kind,
    resolution: resolutionOf(v.resolution),
    frameRate: frameRateOf(v.frameRate),
    audio: v.audio === true,
    pid: kind === 'window' ? pidOf(v.pid) : null,
    hidePreview: v.hidePreview === true,
  }
}

/**
 * A saved choice read back from disk, where anything may have been written.
 *
 * Before per-app audio there was one `audio` flag, and it meant one thing:
 * "send the system's sound with a whole-screen share". So it restores
 * `screenAudio` and nothing else. It says nothing at all about a window,
 * which could not carry sound when it was written — a window therefore takes
 * the new default rather than inheriting an answer to a different question.
 */
export const readRemembered = (value: unknown): Remembered => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    resolution: resolutionOf(v.resolution),
    frameRate: frameRateOf(v.frameRate),
    windowAudio: typeof v.windowAudio === 'boolean' ? v.windowAudio : true,
    screenAudio: typeof v.screenAudio === 'boolean' ? v.screenAudio : v.audio === true,
    hidePreview: v.hidePreview === true,
  }
}

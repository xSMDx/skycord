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
  /** Don't show the member their own stream. Others still see it. */
  hidePreview: boolean
}

/** What the app keeps between shares. */
export interface Remembered extends Quality { audio: boolean; hidePreview: boolean }

const resolutionOf = (v: unknown): Resolution => RESOLUTIONS.find(r => r === v) ?? DEFAULT_QUALITY.resolution
const frameRateOf = (v: unknown): FrameRate => FRAME_RATES.find(f => f === v) ?? DEFAULT_QUALITY.frameRate

/**
 * The picker page's answer, checked. The id must be one the picker was shown,
 * and audio only comes with a whole screen: Windows can loop back only the
 * entire system's sound, never one window's.
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
    audio: kind === 'screen' && v.audio === true,
    hidePreview: v.hidePreview === true,
  }
}

/** A saved choice read back from disk, where anything may have been written. */
export const readRemembered = (value: unknown): Remembered => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return { resolution: resolutionOf(v.resolution), frameRate: frameRateOf(v.frameRate), audio: v.audio === true, hidePreview: v.hidePreview === true }
}

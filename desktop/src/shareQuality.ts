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

/**
 * What the picker says beneath "Share stream audio".
 *
 * It states what leaves the machine, every time, because that is the thing
 * worth being sure about. A window share admits it sends the whole
 * application; a screen share promises only that the call is left out.
 *
 * It cannot name the application: this line is read in the gear menu, and the
 * picker has no selection to name — clicking a tile is what chooses it.
 */
export const audioLine = (kind: 'screen' | 'window', on: boolean, supported: boolean, platform = 'win32'): string => {
  if (!supported && platform !== 'win32') {
    // Off Windows neither capture exists yet: the app's sound needs the WASAPI
    // addon, and a whole screen's needs Chromium's loopback, Windows-only too.
    const os = platform === 'linux' ? 'Linux' : platform === 'darwin' ? 'macOS' : 'this system'
    return kind === 'window'
      ? `Sharing one app’s sound isn’t available on ${os} yet`
      : `Sharing your computer’s sound isn’t available on ${os} yet`
  }
  if (kind === 'window' && !supported) return 'Your version of Windows cannot share one app’s sound'
  if (!on) return 'No sound goes with this share'
  return kind === 'window'
    ? 'Sends the app’s own sound — but all of it, every window and tab it has'
    : 'Sends everything your PC plays, except this call'
}

/**
 * Every line the picker might show, rendered once for the page to index. The
 * page is a plain script and cannot import this module.
 */
export const audioCopy = (perAppAudio: boolean, platform = 'win32') => {
  const screen = screenAudioSupported(platform)
  return {
    windowOn: audioLine('window', true, perAppAudio, platform),
    windowOff: audioLine('window', false, perAppAudio, platform),
    screenOn: audioLine('screen', true, screen, platform),
    screenOff: audioLine('screen', false, screen, platform),
  }
}

/**
 * Whether a whole-screen share can carry sound: Electron's system loopback,
 * which it supports on Windows only. A window's sound is the addon's to say
 * (shareAudio.ts `supportsPerAppAudio`).
 */
export const screenAudioSupported = (platform: string): boolean => platform === 'win32'

/** Whether a share of this kind can carry sound at all here. */
export const audioSupported = (kind: 'screen' | 'window', perAppAudio: boolean, platform: string): boolean =>
  kind === 'window' ? perAppAudio : screenAudioSupported(platform)

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

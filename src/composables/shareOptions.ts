/**
 * The Windows app's share picker answer, as LiveKit settings.
 *
 * The encoding is set here as well as the capture. Left to itself, LiveKit
 * picks an encoding from the track's size, and for 1080p that is 15 fps at
 * 2.5 Mbps whatever frame rate was captured.
 */
import type { ScreenShareCaptureOptions, TrackPublishOptions } from 'livekit-client'
import type { DesktopShareChoice } from './desktopBridge'
import { familyOf } from './themeMode'
import type { Theme } from './useAppearance'

/** Bits per second at 30 fps, by output height. Source is budgeted as 1440p. */
const AT_30: Record<string, number> = { 720: 2_500_000, 1080: 5_000_000, 1440: 8_000_000, source: 8_000_000 }
/** Each frame rate's share of that. Frames that follow each other cost less. */
const FPS_SHARE: Record<number, number> = { 5: 0.3, 15: 0.6, 30: 1, 60: 1.6 }

export const shareOptions = (c: DesktopShareChoice): { capture: ScreenShareCaptureOptions; publish: TrackPublishOptions } => {
  const frameRate = FPS_SHARE[c.frameRate] ? c.frameRate : 30
  const height = typeof c.resolution === 'number' && AT_30[c.resolution] ? c.resolution : null
  return {
    capture: {
      audio: c.audio,
      // Games move and documents don't: which one the encoder keeps under strain.
      contentHint: frameRate >= 30 ? 'motion' : 'detail',
      ...(height
        ? { resolution: { width: Math.round(height * 16 / 9), height, frameRate } }
        // Source: no size cap. LiveKit types `video` narrowly but hands it to
        // getDisplayMedia as given, so the frame rate travels this way.
        : { video: { frameRate } as unknown as ScreenShareCaptureOptions['video'] }),
    },
    publish: {
      screenShareEncoding: { maxBitrate: Math.round(AT_30[height ?? 'source'] * FPS_SHARE[frameRate]), maxFramerate: frameRate },
    },
  }
}

/** The picker opens in the client's own light or dark. */
export const pickerHints = (root: HTMLElement = document.documentElement): { dark: boolean } =>
  ({ dark: familyOf(root.dataset.theme as Theme) !== 'light' })

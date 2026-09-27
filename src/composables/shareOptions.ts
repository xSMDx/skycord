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
  const capture = {
      /**
       * Only a whole screen's sound comes through LiveKit's own capture, and
       * it asks Chromium to leave this app out of it: `restrictOwnAudio`
       * selects the loopback device that excludes our own process tree, so
       * the call is no longer sent back to the people in it. A window's sound
       * is captured natively, per application, and published as its own track
       * — Chromium cannot capture one application at all.
       */
      audio: c.kind === 'screen' && c.audio,
      ...(c.kind === 'screen' && c.audio ? { restrictOwnAudio: true } : {}),
      /**
       * Only a 60 fps share is called motion.
       *
       * `motion` tells the encoder that smooth movement matters more than
       * pixels, so under any strain it keeps the frame rate and scales the
       * picture down — which is exactly the "it keeps going blurry" people
       * report while sharing a screen at 30 fps. Detail keeps the resolution
       * and drops frames instead, which is what you want for anything with
       * text in it. 60 fps is only ever chosen for games, where the opposite
       * is true.
       */
      contentHint: frameRate > 30 ? 'motion' : 'detail',
      ...(height
        ? { resolution: { width: Math.round(height * 16 / 9), height, frameRate } }
        // Source: no size cap. LiveKit types `video` narrowly but hands it to
        // getDisplayMedia as given, so the frame rate travels this way.
        : { video: { frameRate } as unknown as ScreenShareCaptureOptions['video'] }),
    // LiveKit's type predates the constraint; getDisplayMedia takes it as given.
  } as ScreenShareCaptureOptions & { restrictOwnAudio?: boolean }

  return {
    capture,
    publish: {
      screenShareEncoding: { maxBitrate: Math.round(AT_30[height ?? 'source'] * FPS_SHARE[frameRate]), maxFramerate: frameRate },
      /**
       * One layer, and keep its size.
       *
       * Simulcast publishes the share two or three times at different sizes,
       * and every viewer's client then picks one by how big the tile is on
       * their screen. In a call that tile is small, so the small layer is what
       * everyone got — and it changed under them whenever the layout did. A
       * screen share has one right answer: the size it was captured at.
       *
       * `maintain-resolution` is the same bargain for the encoder itself:
       * when the machine or the connection cannot keep up, drop frames, never
       * pixels. A share that stutters is readable; a share that goes soft is
       * not.
       */
      simulcast: false,
      degradationPreference: 'maintain-resolution',
    },
  }
}

/** The picker opens in the client's own light or dark. */
export const pickerHints = (root: HTMLElement = document.documentElement): { dark: boolean } =>
  ({ dark: familyOf(root.dataset.theme as Theme) !== 'light' })

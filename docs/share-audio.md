# Screen-share audio

Sound follows what you share.

| Shared | Sound sent | Default | How |
|---|---|---|---|
| A window | That application only | on | `desktop/native`, WASAPI process loopback |
| A whole screen | Everything except Skycord | off | Chromium's `restrictOwnAudio` |

## Why a window needs native code

Chromium offers one loopback device: the whole system. Windows has had
per-process loopback since version 2004, through
`ActivateAudioInterfaceAsync` with `AUDIOCLIENT_ACTIVATION_PARAMS`, but
Chromium does not expose it. So a window's sound is captured by our own addon
in a utility process and published as a second LiveKit track
(`Track.Source.ScreenShareAudio`).

A whole screen needs none of that. Electron 44 understands the
`restrictOwnAudio` constraint (electron/electron#52455, backported to
`44-x-y`), which selects the loopback device that excludes the capturing
process tree.

## The path the sound takes

```
utilityProcess                        renderer
skycord_audio_capture.node            share-audio-worklet.js
  → 480-frame f32 chunks   ─port─→      ring buffer (6 chunks)
                                        → MediaStreamAudioDestinationNode
                                        → publishTrack(ScreenShareAudio)
```

Electron's `MessagePortMain` transfers ports and nothing else, so the first hop
is a structured-clone copy — 384 KB/s, which is cheap. The renderer's hop into
the worklet does transfer. Audio never passes through the main process.

The track is built from a worklet, not `getUserMedia`, on purpose: Chromium's
echo canceller, gain control and noise suppression exist for a microphone, and
a game's soundtrack run through them comes out pumping and hollow.

## Which process is "the application"

A window's own process is usually the wrong one — a Chrome tab is a renderer,
and the sound comes from a sibling. `desktop/src/processWalk.ts` walks up the
parent chain while the executable name stays the same, so a Chrome renderer
resolves to the Chrome browser process and a Steam game resolves to itself.
Walking to the true root would be worse: `explorer.exe` sits above everything.

**This means sharing one Chrome window sends all of Chrome's sound.** Windows
offers nothing finer than a process tree, and the picker says so.

## When it does not work

- **Windows below build 19041**: the option is disabled for windows, with a
  reason. Whole-screen audio still works.
- **The addon is missing or did not build**: `native/index.js` falls back to a
  stub whose `supported()` is `false`. The app runs normally; per-app audio is
  simply not offered.
- **`start()` fails**: the share goes out without sound and says so. It is
  never refused over audio.
- **A wrong root**: the capture succeeds and delivers silence. Windows gives no
  signal distinguishing this from an application that is simply quiet, so there
  is no runtime detection. The walk is what keeps it rare.

## Building the addon

`npm run build:native` in `desktop/`, which `dist` and `release` depend on. It
needs the MSVC C++ toolchain; the `windows-latest` CI runner has it. See
`desktop/native/README.md`.

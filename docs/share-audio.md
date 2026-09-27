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

## What has been verified, and what has not

Measured on Windows 11 (build 28000) with MSVC 14.44, 2026-09-27:

| Claim | Result |
|---|---|
| The addon compiles and loads | Yes, clean, no warnings |
| `processTable` reports real parents and creation times | 382 processes |
| The walk collapses a browser to one root | Chrome 37 processes → 1; Edge 35 → 1 |
| Chunk format and cadence | 3840 bytes, ~99.7/s — exactly 10 ms |
| A silent application still yields chunks | Yes, at amplitude 0 |
| Real audio is captured from a named process | Peak 0.27 |
| An unrelated process tree stays silent | 0.0000 across repeated runs |
| **A child's audio reaches a parent target** | **Yes — peak 0.22 targeting a parent that plays nothing** |

That last row is the premise the whole `processWalk` design rests on: we aim at
Chrome's browser process expecting to capture the audio service, which is its
child. It was tested directly rather than assumed.

**One unexplained result.** Targeting `explorer.exe`, which is a distant
ancestor of the test player (six levels up, through the terminal), captured
silence. One level down works; six levels through a chain of shells did not.
Windows appears to resolve the tree at capture time in a way a long or partly
exited chain does not survive. It does not affect this feature — the walk never
targets anything more than a step or two from the window's own process — but
anyone extending it should not assume arbitrary depth.

**Still needs a person:** whether a real Chrome tab's sound is captured when
Chrome is the target, whether the published track sounds untouched by echo
cancellation, and whether audio and video stay in sync over several minutes.

## Building the addon

`npm run build:native` in `desktop/`, which `dist` and `release` depend on. It
needs the MSVC C++ toolchain; the `windows-latest` CI runner has it. See
`desktop/native/README.md`.

# Per-app screen-share audio — design

**Goal.** Sharing a window sends that application's sound and nothing else.
Sharing a whole screen sends everything except Skycord. Either way, nobody in
the call hears the call back.

**Platform.** Windows only, in the desktop app. The web client is unchanged; a
browser cannot do this and will not be asked to.

---

## Why this exists

v0.20.0 shipped screen-share audio as Windows system loopback, because that is
all Electron offered: `audio: 'loopback'` in the display-media handler. System
loopback contains everything the PC plays, and that includes the call, so the
far side hears themselves. The picker offers it for a whole screen only, off by
default, and says so — a warning in place of a fix.

Two things have changed since:

- Electron 44 understands the `restrictOwnAudio` constraint
  (electron/electron#52455, merged 2026-07-29, backported to `44-x-y`; the
  string is present in the 44.4.3 binary we ship). It selects Chromium's
  `loopbackWithoutChrome` device: system audio minus the capturing process
  tree. That answers the whole-screen case with no native code.
- Windows has had per-process loopback since Windows 10 version 2004:
  `ActivateAudioInterfaceAsync` with `AUDIOCLIENT_ACTIVATION_PARAMS` in
  `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`. Chromium does not expose
  it, so reaching it means our own native addon.

## The rule

**Sound follows what you share.**

| Shared | Sound | Default | Mechanism |
|---|---|---|---|
| A window | That application only | **on** | Native addon, INCLUDE process tree |
| A whole screen | Everything except Skycord | **off** | `restrictOwnAudio`, no native code |

A window share gains audio for the first time — today it is refused outright.
A whole-screen share keeps its existing behaviour and loses the echo, so the
default stays off: it still sends notifications, music, and everything else.

### Which process is "the application"

`desktopCapturer` window ids are `window:<HWND>:0`, HWND in decimal (verified on
this machine: `window:328988:0`). `GetWindowThreadProcessId` turns that into a
PID — but that PID is often the wrong one. A Chrome window belongs to a
renderer; the sound is rendered by the audio service, a sibling. Capturing the
renderer's tree yields silence.

So: **walk up the parent chain while the executable name stays the same, and
capture that root plus its descendants.**

| Picked window | Walk | Captured root |
|---|---|---|
| Chrome tab | `chrome.exe` → `chrome.exe` → `explorer.exe` (stop) | the Chrome browser process |
| Spotify (Electron) | `Spotify.exe` → `Spotify.exe` → `explorer.exe` (stop) | the Spotify main process |
| A Steam game | `game.exe` → `steam.exe` (stop) | `game.exe` |

The rule gets browsers and Electron apps right without ever swallowing an
unrelated tree, which walking to the true root would do — every process started
from the desktop has `explorer.exe` above it.

Parent lookup is `CreateToolhelp32Snapshot` / `Process32Next`
(`th32ParentProcessID`). PIDs are reused, so the walk stops if a parent's
creation time is later than the child's — a recycled PID is not a parent. The
walk is also capped at 8 hops against a cycle in a corrupt snapshot.

**The cost, which the picker states:** sharing one Chrome window sends all of
Chrome's sound, every tab. Windows offers nothing finer than a process tree.

---

## Architecture

Four units with flat interfaces. The PCM path never touches the main process.

```
 utilityProcess                 renderer
 ┌──────────────────┐          ┌─────────────────────────────┐
 │ skycord-audio-   │  Message │ AudioWorklet (ring buffer)  │
 │ capture (.node)  │──Channel─▶ → MediaStreamAudioDestNode  │
 │ WASAPI loopback  │  Main    │ → LiveKit publishTrack      │
 └──────────────────┘  port    │   (Track.Source.            │
         ▲                     │    ScreenShareAudio)        │
         │ start(rootPid)      └─────────────────────────────┘
 ┌───────┴──────────┐
 │ main process     │  picks the source, resolves the root pid,
 │ displayMedia.ts  │  spawns the helper, forwards the port
 └──────────────────┘
```

### 1. `skycord-audio-capture` — the native addon

Ours, C++, N-API (ABI-stable across Node and Electron), built from Microsoft's
ApplicationLoopback sample. Lives at `desktop/native/`.

```
start(rootPid: number, onChunk: (buf: Buffer) => void): boolean
stop(): void
supported(): boolean            // false below Windows 10 build 19041
pidForWindow(hwnd: number): number | null
processTable(): { pid, parentPid, exe, createdAt }[]
```

The addon reports facts and never decides. The walk itself is
`rootOfApp(pid, table)` in `desktop/src/processWalk.ts` — ordinary
TypeScript, unit-tested against hand-written process tables, with no
Windows and no native build needed to exercise it. Native code is the part
that cannot be tested cheaply, so as little as possible lives there.

Chunks are 10 ms: 480 frames, 2 channels, 32-bit float, 3840 bytes. 48 kHz
fixed — the same rate the mic chain and RNNoise already assume.

`start` returns `false` when `ActivateAudioInterfaceAsync` fails or the API is
absent. It never throws into JS.

**The binary is never committed.** It is compiled during the build, on the
`windows-latest` runner `desktop-release.yml` already uses, which carries the
MSVC toolchain: `npm run build:native` runs `node-gyp rebuild` and the `dist`
and `release` scripts depend on it. A developer on Windows gets it the same
way; a developer without the toolchain gets a clear failure from that one
script rather than a broken app.

Because a `.node` cannot be loaded from inside an asar, `desktop/native/build/
Release/*.node` is listed in `electron-builder.yml` under both `files` and
`asarUnpack`.

### 2. The capture helper — an Electron `utilityProcess`

The addon is loaded here and nowhere else. This is the point of the design: it
is the first native code in Skycord and it runs during calls. A fault in C++
audio code ends a helper process we restart, not the call.

The helper is spawned when a window share with audio starts and exits when it
stops. It holds no state beyond the running capture.

### 3. The pipe — a `MessageChannelMain` port

One port, created in main, one end given to the helper and the other forwarded
to the renderer with `webContents.postMessage`. PCM travels as transferred
`ArrayBuffer`s — no copy, no structured clone of a Buffer.

Volume is 384 KB/s at 100 messages a second. On a dedicated port this never
competes with ordinary IPC, and a slow main process cannot stutter the audio.

### 4. The track — `AudioWorklet` → `MediaStreamAudioDestinationNode`

A classic script at `public/share-audio-worklet.js`, following the pattern
`public/mic-gate-worklet.js` already sets: `addModule()` fetches a plain file
by absolute URL, so it cannot be bundled. It is tested by evaluating that very
file against stubbed worklet globals, so the test covers the artifact that
ships rather than a copy of it.

The worklet holds a ring buffer of 6 chunks (60 ms) and writes silence when it
underruns, which is what a late chunk must sound like — a gap, not a stall.
Its output feeds a `MediaStreamAudioDestinationNode`, whose track is published:

```ts
room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShareAudio })
```

Separate from the video track LiveKit publishes through
`setScreenShareEnabled`, so it starts, stops and fails independently.

**Not from `getUserMedia`**, so Chromium's echo canceller, gain control and
noise suppression are not in the path — this audio must arrive untouched. This
is asserted in the plan as a thing to verify on real output, not assumed.

---

## What changes in the existing code

| File | Change |
|---|---|
| `desktop/src/shareQuality.ts` | `ShareChoice` gains `pid: number \| null`. `audio` is no longer `kind === 'screen'` only. `Remembered` splits `audio` into `windowAudio` (default true) and `screenAudio` (default false); a stored `audio` migrates to both. |
| `desktop/src/sharePicker.ts` | Resolves `rootPidForWindow` for the chosen window and puts it on the choice. |
| `desktop/src/sharePage.ts` | The audio row is offered for windows too. Its description says what each kind sends. Disabled with a reason when `supported()` is false. |
| `desktop/src/displayMedia.ts` | Windows no longer get `audio: 'loopback'`. Screens keep system audio, now via `restrictOwnAudio`. Spawns the helper and forwards the port for a window share with audio. |
| `desktop/src/shareAudio.ts` *(new)* | Owns the helper's lifecycle and the port. |
| `src/composables/shareAudioTrack.ts` *(new)* | Renderer side: receives the port, builds the worklet and the track, publishes and unpublishes. |
| `src/composables/useVoiceMedia.ts` | Publishes the extra track when the desktop supplies one; unpublishes on stop. Screen path asks for `restrictOwnAudio`. |

---

## When it cannot work

Chosen behaviour: **say so, and share the video without sound.** The share is
the point; silence with an explanation beats a share that never starts.

| Condition | What happens |
|---|---|
| Windows below build 19041 | The picker's audio row is disabled for windows, with "Your version of Windows cannot share one app's sound." Whole-screen audio still works. |
| The addon fails to load | Same as above, discovered at startup, logged once. |
| `start()` returns false | The share starts without audio and a toast says "Couldn't capture *Firefox*'s sound — sharing video only." |
| The helper crashes mid-share | The track is unpublished and the same toast appears. The video share is untouched. No automatic restart: audio that comes back by itself halfway through a call is worse than audio that stayed off. |
| The app plays nothing | Nothing. Silence is correct, not a failure, and is not reported. |

**A limitation with no fix here:** if the walk picks the wrong root, the capture
succeeds and delivers silence. Windows gives no signal distinguishing "this app
is quiet" from "wrong process". The walk rule is what makes this rare; there is
no runtime detection to fall back on.

---

## Testing

**Pure, unit-tested, no Windows needed:**

- the process walk, as a pure function over a process table
  (`{pid, parentPid, exe, createdAt}[]`) — Chrome, Steam, cycles, PID reuse,
  a missing parent, the 8-hop cap;
- `parseChoice` with and without a pid, and the rejection of a pid the picker
  never offered;
- the `Remembered` migration from one `audio` flag to two;
- the ring buffer: fill, drain, underrun writes silence, overrun drops oldest;
- which mechanism a choice selects — window → addon, screen → `restrictOwnAudio`.

**Needs Windows and a person** (listed in the plan as owner checks, not
automated):

- a game window shared, its sound heard, no call echo;
- a Chrome window shared, sound heard, and it is all of Chrome;
- a whole screen shared, sound heard, no call echo;
- the addon's output confirmed untouched by echo cancellation;
- audio and video staying in sync over several minutes.

---

## Out of scope

- macOS and Linux. The desktop app is Windows-only.
- Changing what is shared without restarting the stream.
- Per-app audio for a *whole-screen* share — settled as everything-except-
  Skycord, deliberately.
- Letting a viewer mute the shared audio separately from the sharer's voice.
  LiveKit already gives it its own track and source, so this is possible later
  without redesign.

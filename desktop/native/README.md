# skycord-audio-capture

WASAPI process loopback: the sound one application's process tree plays.
Windows only, Windows 10 build 19041 (version 2004) and later.

## Building

Built from source, never committed. `npm run build:native` in `desktop/` runs
`node-gyp rebuild`; `npm run dist` and `npm run release` depend on it, as does
CI. `desktop/native/build/` is git-ignored.

It needs the MSVC C++ toolchain, which the `windows-latest` CI runner already
has. A developer machine without it gets a clear failure from that one script
rather than a broken app — and the app still runs, because `index.js` falls
back to a stub whose `supported()` is `false`.

```
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## What it does and does not decide

It reports facts and captures audio. Which process counts as "the application"
behind a window is decided in `desktop/src/processWalk.ts`, in TypeScript,
where it is unit-tested without Windows. Native code is the part that cannot be
tested cheaply, so as little as possible lives here.

## Output

Fixed: 48 kHz, 2 channels, 32-bit float, 480-frame chunks (3840 bytes), one
every 10 ms. A silent application still produces chunks, of silence — dropping
them would break the stream's timing.

## API

```
supported(): boolean
pidForWindow(hwnd: number): number | null
processTable(): { pid, parentPid, exe, createdAt }[]
start(rootPid: number, onChunk: (chunk: Buffer) => void): boolean
stop(): void
```

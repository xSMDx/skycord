# Per-app screen-share audio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sharing a window sends that application's sound and nothing else; sharing a whole screen sends everything except Skycord.

**Architecture:** A native N-API addon runs WASAPI process loopback inside a crash-isolated Electron `utilityProcess`. Its PCM reaches the renderer over a dedicated `MessageChannelMain` port, where an `AudioWorklet` ring-buffers it into a `MediaStreamAudioDestinationNode` published as a second LiveKit track. Whole-screen audio needs none of that — it is Electron's own `restrictOwnAudio` constraint.

**Tech Stack:** Electron 44.4.3, node-addon-api (N-API), node-gyp, WASAPI (`ActivateAudioInterfaceAsync`), LiveKit 2.20, Vue 3, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-27-share-app-audio-design.md`

## Global Constraints

- **Windows only.** The web client is unchanged. Every new path must be inert on other platforms and in a browser.
- **Audio format is fixed:** 48 kHz, 2 channels, 32-bit float, 480-frame chunks (3840 bytes). Do not make these configurable.
- **The `.node` binary is never committed.** It is built by `npm run build:native` and by CI.
- **Never load the addon in the main process.** It is loaded only inside the utility process.
- **Defaults:** window share audio **on**, whole-screen share audio **off**.
- **Failure behaviour:** the share always starts; audio failures are reported and the video continues. Never refuse a share because audio failed.
- **Silence is not a failure** and is never reported.
- Run all tests from the repo root: `npx vitest run`. Typecheck: `npm run typecheck`.
- Commit messages: lower-case `type(scope): subject`, a body explaining *why*, and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/processWalk.ts` *(new)* | Pure: `rootOfApp(pid, table)` — the same-executable walk. |
| `desktop/native/binding.gyp` *(new)* | node-gyp build for the addon, Windows only. |
| `desktop/native/src/capture.cc` *(new)* | WASAPI process loopback, N-API surface. |
| `desktop/native/index.js` *(new)* | Loads the `.node`, degrades to a stub off Windows. |
| `desktop/src/shareQuality.ts` | `ShareChoice.pid`, window audio allowed, `Remembered` split. |
| `public/share-audio-worklet.js` *(new)* | Ring buffer on the audio thread. |
| `src/composables/shareAudioTrack.ts` *(new)* | Port → worklet → `MediaStreamTrack`. |
| `desktop/src/shareAudioHelper.ts` *(new)* | The `utilityProcess` entry point. |
| `desktop/src/shareAudio.ts` *(new)* | Helper lifecycle and the port handoff. |
| `desktop/src/sharePage.ts` | The audio row for windows, and its copy. |
| `desktop/src/sharePicker.ts` | Resolves the pid for the chosen window. |
| `desktop/src/displayMedia.ts` | Drops `loopback` for windows; starts the helper. |
| `src/composables/useVoiceMedia.ts` | Publishes and unpublishes the extra track. |

---

### Task 1: The process walk

**Files:**
- Create: `desktop/src/processWalk.ts`
- Test: `desktop/src/__tests__/processWalk.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ProcRow { pid: number; parentPid: number; exe: string; createdAt: number }` and `rootOfApp(pid: number, table: readonly ProcRow[]): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { rootOfApp, type ProcRow } from '../processWalk'

const row = (pid: number, parentPid: number, exe: string, createdAt = 100): ProcRow =>
  ({ pid, parentPid, exe, createdAt })

describe('rootOfApp', () => {
  it('walks up while the executable name stays the same', () => {
    // A Chrome tab: renderer → browser → explorer (a different exe, so stop).
    const table = [row(10, 1, 'explorer.exe', 1), row(20, 10, 'chrome.exe', 2), row(30, 20, 'chrome.exe', 3)]
    expect(rootOfApp(30, table)).toBe(20)
  })

  it('stops at a differently named parent: a game under Steam is its own app', () => {
    const table = [row(10, 1, 'steam.exe', 1), row(20, 10, 'game.exe', 2)]
    expect(rootOfApp(20, table)).toBe(20)
  })

  it('compares names without case: Windows does not', () => {
    const table = [row(20, 10, 'Spotify.exe', 2), row(30, 20, 'spotify.exe', 3)]
    expect(rootOfApp(30, table)).toBe(20)
  })

  it('refuses a parent created after its child: the pid was reused', () => {
    const table = [row(20, 10, 'chrome.exe', 500), row(30, 20, 'chrome.exe', 100)]
    expect(rootOfApp(30, table)).toBe(30)
  })

  it('stops after 8 hops rather than looping on a corrupt snapshot', () => {
    // A cycle: every row points at the next, and the last points back.
    const table = Array.from({ length: 12 }, (_, i) =>
      row(i + 1, i === 11 ? 1 : i + 2, 'app.exe', 1))
    expect(rootOfApp(1, table)).toBe(9)
  })

  it('stops when the parent is missing from the table', () => {
    expect(rootOfApp(30, [row(30, 20, 'chrome.exe')])).toBe(30)
  })

  it('returns null for a pid that is not in the table at all', () => {
    expect(rootOfApp(99, [row(30, 20, 'chrome.exe')])).toBeNull()
  })

  it('never walks into pid 0 or a self-parenting row', () => {
    expect(rootOfApp(4, [row(4, 4, 'System.exe'), row(0, 0, 'Idle.exe')])).toBe(4)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run desktop/src/__tests__/processWalk.test.ts`
Expected: FAIL — `Failed to resolve import "../processWalk"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Which process is "the application" behind a window.
 *
 * A window's own process is often the wrong one to capture. A Chrome tab
 * belongs to a renderer, but the sound is rendered by the audio service — a
 * sibling in the same tree, not a descendant of the renderer. Capturing the
 * renderer's tree gives silence.
 *
 * Walking to the true root is worse: every process started from the desktop
 * has explorer.exe above it, so the "application" would become the whole
 * session. The rule that works is the connected run of same-named executables:
 * Chrome's renderer and browser are both chrome.exe, and the walk stops at
 * explorer.exe. A game launched by Steam stops immediately, because steam.exe
 * is not game.exe.
 *
 * Pure on purpose: the process table comes from native code, the decision
 * does not.
 */
export interface ProcRow {
  pid: number
  parentPid: number
  /** Base name only, e.g. "chrome.exe". */
  exe: string
  /** Creation time, any monotonic unit — only compared, never displayed. */
  createdAt: number
}

/** A corrupt snapshot can describe a cycle; this bounds the walk regardless. */
const MAX_HOPS = 8

export const rootOfApp = (pid: number, table: readonly ProcRow[]): number | null => {
  const byPid = new Map(table.map(r => [r.pid, r]))
  let current = byPid.get(pid)
  if (!current) return null

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const parent = byPid.get(current.parentPid)
    // No parent recorded, the idle process, or a row that claims to be its own
    // parent: the walk is over and what we have is the root.
    if (!parent || parent.pid === 0 || parent.pid === current.pid) return current.pid
    // A different program is a different application.
    if (parent.exe.toLowerCase() !== current.exe.toLowerCase()) return current.pid
    // Windows reuses pids. Something that started after its supposed child is
    // not its parent — it is a stranger wearing the number.
    if (parent.createdAt > current.createdAt) return current.pid
    current = parent
  }
  return current.pid
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run desktop/src/__tests__/processWalk.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/processWalk.ts desktop/src/__tests__/processWalk.test.ts
git commit -m "feat(share): the walk that finds the app behind a window

A window's own process is usually the wrong one to capture: a Chrome tab
is a renderer, and the sound comes from a sibling. Walking to the true
root is worse, because explorer.exe sits above everything. The connected
run of same-named executables is the rule that gets browsers right and
still leaves a Steam game as itself.

Pure, so the decision is testable without Windows or a native build.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The share choice carries a pid, and audio is no longer screen-only

**Files:**
- Modify: `desktop/src/shareQuality.ts`
- Test: `desktop/src/__tests__/shareQuality.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ShareChoice` gains `pid: number | null`; `Remembered` becomes `{ resolution, frameRate, windowAudio, screenAudio, hidePreview }`; `parseChoice(value, shown)` accepts `audio` for a window and reads `pid`.

**Context you need:** the current file refuses window audio outright — `audio: kind === 'screen' && v.audio === true` — and `readRemembered` reads a single `audio` flag. Both change. An existing install has `{ audio: boolean }` on disk and must not lose it.

- [ ] **Step 1: Write the failing tests**

Replace the test named `'never carries audio with a window: Windows can only loop back the whole system'` with the tests below, and add the rest to the same file.

```ts
  it('carries audio with a window now that one app can be captured', () => {
    expect(parseChoice({ sourceId: 'window:42:0', resolution: 720, frameRate: 30, audio: true, pid: 913 }, shown))
      .toMatchObject({ kind: 'window', audio: true, pid: 913 })
  })

  it('ignores a pid that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, '913', null, undefined]) {
      expect(parseChoice({ sourceId: 'window:42:0', resolution: 720, frameRate: 30, audio: true, pid: bad }, shown)?.pid).toBeNull()
    }
  })

  it('never carries a pid for a whole screen: there is no single app to capture', () => {
    expect(parseChoice({ sourceId: 'screen:1:0', resolution: 720, frameRate: 30, audio: true, pid: 913 }, shown)?.pid).toBeNull()
  })

describe('readRemembered', () => {
  it('splits an older single audio flag across both kinds', () => {
    expect(readRemembered({ resolution: 1080, frameRate: 30, audio: true }))
      .toMatchObject({ windowAudio: true, screenAudio: true })
  })

  it('defaults to sound for a window and silence for a screen', () => {
    expect(readRemembered({})).toMatchObject({ windowAudio: true, screenAudio: false })
  })

  it('prefers the split flags over the old one when both are present', () => {
    expect(readRemembered({ audio: true, windowAudio: false, screenAudio: false }))
      .toMatchObject({ windowAudio: false, screenAudio: false })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run desktop/src/__tests__/shareQuality.test.ts`
Expected: FAIL — window audio comes back `false`, and `windowAudio` is `undefined`.

- [ ] **Step 3: Change the types and the parsers**

In `desktop/src/shareQuality.ts`, replace the `ShareChoice` interface, the `Remembered` interface, the tail of `parseChoice`, and `readRemembered`:

```ts
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

const pidOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
```

The tail of `parseChoice` becomes:

```ts
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
```

And `readRemembered`:

```ts
/**
 * A saved choice read back from disk, where anything may have been written.
 *
 * Before per-app audio there was one `audio` flag, meaning "send the system's
 * sound with a whole-screen share". Someone who had turned that on wanted
 * sound, so it seeds both kinds; the split flags win wherever they exist.
 */
export const readRemembered = (value: unknown): Remembered => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const legacy = v.audio === true
  return {
    resolution: resolutionOf(v.resolution),
    frameRate: frameRateOf(v.frameRate),
    windowAudio: typeof v.windowAudio === 'boolean' ? v.windowAudio : legacy || v.audio === undefined,
    screenAudio: typeof v.screenAudio === 'boolean' ? v.screenAudio : legacy,
    hidePreview: v.hidePreview === true,
  }
}
```

Also update the doc comment above `parseChoice`, which currently says audio comes only with a whole screen:

```ts
/**
 * The picker page's answer, checked. The id must be one the picker was shown.
 * A window may now carry audio — one application's sound, captured by pid —
 * and a screen may not carry a pid, because it is not one application.
 */
```

- [ ] **Step 4: Fix the one caller this breaks**

`desktop/src/displayMedia.ts` builds `Remembered` in `remember()` and reads `last.audio`. Replace its `share:` object:

```ts
    share: {
      resolution: opts.quality ? choice.resolution : last.resolution,
      frameRate: opts.quality ? choice.frameRate : last.frameRate,
      windowAudio: opts.audio && choice.kind === 'window' ? choice.audio : last.windowAudio,
      screenAudio: opts.audio && choice.kind === 'screen' ? choice.audio : last.screenAudio,
      hidePreview: opts.quality ? choice.hidePreview : last.hidePreview,
    },
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run desktop/src/__tests__/shareQuality.test.ts && npm run typecheck`
Expected: PASS, and a clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shareQuality.ts desktop/src/__tests__/shareQuality.test.ts desktop/src/displayMedia.ts
git commit -m "feat(share): a choice can name one application's sound

A window share may now carry audio, which it never could, and carries the
pid of the application to capture it from. A screen never carries a pid,
because a screen is not one application.

Audio is remembered per kind. The two mean different things — one app
against everything-except-Skycord — so wanting the first is not wanting
the second. An older single flag seeds both, since anyone who had it on
wanted sound.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The native addon

**Files:**
- Create: `desktop/native/binding.gyp`, `desktop/native/src/capture.cc`, `desktop/native/index.js`, `desktop/native/README.md`
- Modify: `desktop/package.json`, `desktop/electron-builder.yml`, `.github/workflows/desktop-release.yml`, `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `require('../native')` exporting
  `supported(): boolean`,
  `pidForWindow(hwnd: number): number | null`,
  `processTable(): { pid: number; parentPid: number; exe: string; createdAt: number }[]`,
  `start(rootPid: number, onChunk: (chunk: Buffer) => void): boolean`,
  `stop(): void`.

**Context you need:** `desktopCapturer` window ids are `window:<HWND>:0` with the HWND in **decimal** — verified on Windows: `window:328988:0`. Windows 10 build 19041 (version 2004) is the floor for process loopback. The magic device string is `VAD\Process_Loopback`.

- [ ] **Step 1: Add the dependency and the build script**

```bash
cd desktop && npm install --save node-addon-api && npm install --save-dev node-gyp
```

In `desktop/package.json`, add to `scripts`:

```json
    "build:native": "node-gyp rebuild --directory=native",
    "dist": "npm run build:native && tsc && electron-builder --publish never",
    "release": "npm run build:native && tsc && electron-builder --publish always"
```

(`dist` and `release` already exist — replace them with the lines above.)

- [ ] **Step 2: Write `desktop/native/binding.gyp`**

```python
{
  "targets": [
    {
      "target_name": "skycord_audio_capture",
      "sources": [ "src/capture.cc" ],
      "include_dirs": [ "<!@(node -p \"require('node-addon-api').include\")" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS", "NOMINMAX", "UNICODE", "_UNICODE" ],
      "conditions": [
        [ "OS=='win'", {
          "libraries": [ "-lmmdevapi.lib", "-lole32.lib", "-lavrt.lib" ],
          "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": [ "/std:c++17" ] } }
        } ],
        [ "OS!='win'", { "sources": [] } ]
      ]
    }
  ]
}
```

- [ ] **Step 3: Write `desktop/native/src/capture.cc`**

```cpp
// WASAPI process loopback: the sound one application's process tree plays.
//
// Windows has had this since Windows 10 version 2004 (build 19041), through
// ActivateAudioInterfaceAsync with AUDIOCLIENT_ACTIVATION_PARAMS. Chromium
// does not expose it, which is the whole reason this file exists.
//
// This reports facts and captures audio. It makes no decisions: which process
// counts as "the application" is worked out in TypeScript, where it can be
// tested without Windows.
#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <tlhelp32.h>
#include <wrl/implements.h>
#include <atomic>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

namespace {

constexpr int kSampleRate = 48000;
constexpr int kChannels   = 2;
constexpr int kFrames     = 480;                              // 10 ms
constexpr int kChunkBytes = kFrames * kChannels * sizeof(float);

std::atomic<bool> g_running{false};
std::thread       g_thread;
Napi::ThreadSafeFunction g_tsfn;

// ActivateAudioInterfaceAsync answers on another thread; this waits for it.
class ActivationHandler
    : public RuntimeClass<RuntimeClassFlags<ClassicCom | FtmBase>,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  HRESULT ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hr = S_OK;
    ComPtr<IUnknown> unknown;
    if (SUCCEEDED(op->GetActivateResult(&hr, &unknown)) && SUCCEEDED(hr)) {
      unknown.As(&client);
    }
    result = hr;
    SetEvent(done);
    return S_OK;
  }
  ComPtr<IAudioClient> client;
  HRESULT result = E_FAIL;
  HANDLE  done   = CreateEventW(nullptr, TRUE, FALSE, nullptr);
};

bool IsSupported() {
  // Process loopback needs build 19041. RtlGetVersion is the only version
  // call Windows does not lie about to unmanifested processes.
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;
  auto fn = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (!fn) return false;
  RTL_OSVERSIONINFOW info{};
  info.dwOSVersionInfoSize = sizeof(info);
  if (fn(&info) != 0) return false;
  return info.dwMajorVersion > 10 ||
         (info.dwMajorVersion == 10 && info.dwBuildNumber >= 19041);
}

// The capture loop. Event-driven: Windows signals when a buffer is ready.
void CaptureLoop(DWORD pid) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  AUDIOCLIENT_ACTIVATION_PARAMS params{};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT pv{};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  auto handler = Microsoft::WRL::Make<ActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  if (FAILED(ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                         __uuidof(IAudioClient), &pv, handler.Get(), &op))) {
    g_running = false; CoUninitialize(); return;
  }
  WaitForSingleObject(handler->done, 5000);
  if (!handler->client) { g_running = false; CoUninitialize(); return; }

  // Process loopback is shared-mode only and takes the format we ask for.
  WAVEFORMATEX fmt{};
  fmt.wFormatTag      = WAVE_FORMAT_IEEE_FLOAT;
  fmt.nChannels       = kChannels;
  fmt.nSamplesPerSec  = kSampleRate;
  fmt.wBitsPerSample  = 32;
  fmt.nBlockAlign     = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  if (FAILED(handler->client->Initialize(
          AUDCLNT_SHAREMODE_SHARED,
          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
          2000000 /* 200 ms */, 0, &fmt, nullptr))) {
    g_running = false; CoUninitialize(); return;
  }

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  handler->client->SetEventHandle(ready);

  ComPtr<IAudioCaptureClient> capture;
  if (FAILED(handler->client->GetService(__uuidof(IAudioCaptureClient), &capture)) ||
      FAILED(handler->client->Start())) {
    g_running = false; CloseHandle(ready); CoUninitialize(); return;
  }

  // Windows hands over whatever is ready; the renderer wants fixed 10 ms
  // chunks, so leftovers carry into the next one.
  std::vector<float> pending;
  pending.reserve(kFrames * kChannels * 4);

  while (g_running) {
    if (WaitForSingleObject(ready, 200) != WAIT_OBJECT_0) continue;
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0 && g_running) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      const size_t samples = static_cast<size_t>(frames) * kChannels;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        // An app that plays nothing still produces buffers. They must be sent:
        // silence keeps the stream's timing, and a gap would not.
        pending.insert(pending.end(), samples, 0.0f);
      } else {
        const float* in = reinterpret_cast<const float*>(data);
        pending.insert(pending.end(), in, in + samples);
      }
      capture->ReleaseBuffer(frames);

      const size_t per = kFrames * kChannels;
      while (pending.size() >= per) {
        std::vector<float> chunk(pending.begin(), pending.begin() + per);
        pending.erase(pending.begin(), pending.begin() + per);
        g_tsfn.BlockingCall(new std::vector<float>(std::move(chunk)),
            [](Napi::Env env, Napi::Function cb, std::vector<float>* c) {
              cb.Call({ Napi::Buffer<float>::Copy(env, c->data(), c->size()) });
              delete c;
            });
      }
    }
  }

  handler->client->Stop();
  CloseHandle(ready);
  CoUninitialize();
}

Napi::Value Supported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsSupported());
}

Napi::Value PidForWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Null();
  // desktopCapturer gives the HWND in decimal, so it arrives as a JS number.
  HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(info[0].As<Napi::Number>().Int64Value()));
  if (!IsWindow(hwnd)) return env.Null();
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return pid ? Napi::Number::New(env, pid) : env.Null();
}

Napi::Value ProcessTable(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return out;

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  uint32_t i = 0;
  if (Process32FirstW(snap, &entry)) {
    do {
      // Creation time distinguishes a real parent from a recycled pid. A
      // process we may not open gets 0, which never looks later than a child.
      double created = 0;
      HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
      if (h) {
        FILETIME c{}, e{}, k{}, u{};
        if (GetProcessTimes(h, &c, &e, &k, &u)) {
          created = static_cast<double>((static_cast<uint64_t>(c.dwHighDateTime) << 32) | c.dwLowDateTime);
        }
        CloseHandle(h);
      }
      Napi::Object row = Napi::Object::New(env);
      row.Set("pid", Napi::Number::New(env, entry.th32ProcessID));
      row.Set("parentPid", Napi::Number::New(env, entry.th32ParentProcessID));
      row.Set("exe", Napi::String::New(env, reinterpret_cast<const char16_t*>(entry.szExeFile)));
      row.Set("createdAt", Napi::Number::New(env, created));
      out.Set(i++, row);
    } while (Process32NextW(snap, &entry));
  }
  CloseHandle(snap);
  return out;
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_running) return Napi::Boolean::New(env, false);
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction())
    return Napi::Boolean::New(env, false);
  if (!IsSupported()) return Napi::Boolean::New(env, false);

  const DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
  g_tsfn = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "shareAudio", 0, 1);
  g_running = true;
  g_thread = std::thread(CaptureLoop, pid);
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (g_running) {
    g_running = false;
    if (g_thread.joinable()) g_thread.join();
    g_tsfn.Release();
  }
  return info.Env().Undefined();
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("supported",    Napi::Function::New(env, Supported));
  exports.Set("pidForWindow", Napi::Function::New(env, PidForWindow));
  exports.Set("processTable", Napi::Function::New(env, ProcessTable));
  exports.Set("start",        Napi::Function::New(env, Start));
  exports.Set("stop",         Napi::Function::New(env, Stop));
  return exports;
}
NODE_API_MODULE(skycord_audio_capture, Init)

#else   // not Windows

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("supported", Napi::Function::New(env, [](const Napi::CallbackInfo& i) -> Napi::Value {
    return Napi::Boolean::New(i.Env(), false);
  }));
  return exports;
}
NODE_API_MODULE(skycord_audio_capture, Init)

#endif
```

- [ ] **Step 4: Write the loader `desktop/native/index.js`**

```js
/**
 * The addon, or a stub that says it cannot work.
 *
 * Loading native code must never be the thing that stops the app starting.
 * Off Windows, on an old Windows, or after a build that did not run, every
 * caller gets `supported() === false` and nothing else is ever reached.
 */
const DEAD = {
  supported: () => false,
  pidForWindow: () => null,
  processTable: () => [],
  start: () => false,
  stop: () => {},
}

let addon = DEAD
if (process.platform === 'win32') {
  try {
    addon = require('./build/Release/skycord_audio_capture.node')
  } catch (e) {
    console.warn('[share-audio] the capture addon did not load:', e.message)
  }
}

module.exports = addon
```

- [ ] **Step 5: Keep build output out of git, and put it in the installer**

Append to `.gitignore`:

```
desktop/native/build/
```

In `desktop/electron-builder.yml`, extend `files` and add `asarUnpack` (a `.node` cannot be loaded from inside an asar):

```yaml
files:
  - dist/**/*
  - "!dist/**/*.map"
  - static/**/*
  - package.json
  - native/index.js
  - native/build/Release/*.node
asarUnpack:
  - native/build/Release/*.node
```

- [ ] **Step 6: Build it and prove it captures**

Run: `cd desktop && npm run build:native`
Expected: `gyp info ok`, and `desktop/native/build/Release/skycord_audio_capture.node` exists.

Then, with music playing in a browser, run this from `desktop/`:

```bash
node -e "
const a = require('./native');
console.log('supported', a.supported());
const t = a.processTable();
console.log('processes', t.length, '| sample', JSON.stringify(t[1]));
const chrome = t.filter(r => /chrome|msedge|firefox/i.test(r.exe)).sort((x,y)=>x.pid-y.pid)[0];
if (!chrome) { console.log('no browser running — start one with sound'); process.exit(0) }
let chunks = 0, loud = 0;
a.start(chrome.pid, buf => { chunks++; for (let i=0;i<buf.length;i+=4) if (Math.abs(buf.readFloatLE(i))>0.001) { loud++; break } });
setTimeout(() => { a.stop(); console.log('chunks', chunks, 'loud', loud) }, 2000);
"
```

Expected: `supported true`, roughly `chunks 200` in two seconds, and `loud` well above zero while sound is playing. If `chunks` is ~200 but `loud` is 0, the pid was a silent process — try the browser's root pid.

- [ ] **Step 7: Build it in CI**

In `.github/workflows/desktop-release.yml`, the `npm run release` step already runs `build:native` through the script change in Step 1. Add an explicit check after `npm ci` so a native failure is reported where it happened rather than inside electron-builder:

```yaml
      - name: Build the audio capture addon
        run: npm run build:native
        working-directory: desktop
```

- [ ] **Step 8: Write `desktop/native/README.md`**

```markdown
# skycord-audio-capture

WASAPI process loopback: the sound one application's process tree plays.
Windows only, Windows 10 build 19041 (version 2004) and later.

Built from source, never committed. `npm run build:native` in `desktop/`
runs `node-gyp rebuild`; `npm run dist` and `npm run release` depend on it,
as does CI. `desktop/native/build/` is git-ignored.

It reports facts and captures audio. Which process counts as "the
application" behind a window is decided in `desktop/src/processWalk.ts`,
in TypeScript, where it is unit-tested without Windows.

Output is fixed: 48 kHz, 2 channels, 32-bit float, 480-frame chunks
(3840 bytes), one every 10 ms. A silent application still produces chunks,
of silence — dropping them would break the stream's timing.
```

- [ ] **Step 9: Commit**

```bash
git add desktop/native desktop/package.json desktop/package-lock.json desktop/electron-builder.yml .github/workflows/desktop-release.yml .gitignore
git commit -m "feat(share): a native addon for one app's sound

Windows has had per-process loopback since version 2004; Chromium does
not expose it, so this is the only way to reach it. N-API, so one binary
works across Node and Electron, and built from source in CI — nothing
prebuilt and unverifiable goes into the installer.

The addon reports facts and captures audio. It decides nothing: the walk
that picks which process is the application lives in TypeScript, where it
can be tested without Windows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The worklet and its ring buffer

**Files:**
- Create: `public/share-audio-worklet.js`
- Test: `src/composables/__tests__/shareAudioWorklet.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an `AudioWorkletProcessor` registered as `share-audio`. It accepts `Float32Array` chunks by `port.postMessage` and renders them to two output channels.

**Context you need:** `public/mic-gate-worklet.js` is the pattern — a classic script served from `/public`, loaded by absolute URL, because `addModule()` fetches a plain file. It cannot use `import`. The test evaluates the real file against stubbed globals, so it covers the artifact that ships.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'

// The worklet is a classic script for the audio thread: no exports, and its
// globals do not exist in node. Evaluating the real file against stubs is
// what makes the shipped artifact testable rather than a copy of it.
let Processor: new () => {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown, outputs: Float32Array[][]): boolean
}

beforeAll(() => {
  const src = readFileSync(new URL('../../../public/share-audio-worklet.js', import.meta.url), 'utf8')
  let registered: unknown
  const scope = {
    AudioWorkletProcessor: class { port = { onmessage: null } },
    registerProcessor: (_name: string, cls: unknown) => { registered = cls },
    sampleRate: 48000,
  }
  new Function(...Object.keys(scope), src)(...Object.values(scope))
  Processor = registered as typeof Processor
})

const block = () => [new Float32Array(128), new Float32Array(128)]
const chunk = (value: number) => Float32Array.from({ length: 960 }, () => value)

describe('the share-audio worklet', () => {
  it('renders silence before anything arrives', () => {
    const p = new Processor()
    const out = block()
    expect(p.process([], [out])).toBe(true)
    expect(Array.from(out[0])).toEqual(new Array(128).fill(0))
  })

  it('de-interleaves a chunk across the two channels', () => {
    const p = new Processor()
    // Left 0.5, right -0.5, interleaved.
    const c = new Float32Array(960)
    for (let i = 0; i < 480; i++) { c[i * 2] = 0.5; c[i * 2 + 1] = -0.5 }
    p.port.onmessage!({ data: c })
    const out = block()
    p.process([], [out])
    expect(out[0][0]).toBeCloseTo(0.5)
    expect(out[1][0]).toBeCloseTo(-0.5)
  })

  it('keeps rendering across several blocks until the chunk runs out', () => {
    const p = new Processor()
    p.port.onmessage!({ data: chunk(0.25) })
    // 480 frames is 3.75 blocks of 128.
    for (let i = 0; i < 3; i++) {
      const out = block()
      p.process([], [out])
      expect(out[0][127]).toBeCloseTo(0.25)
    }
  })

  it('writes silence when it underruns rather than repeating the last block', () => {
    const p = new Processor()
    p.port.onmessage!({ data: chunk(0.25) })
    for (let i = 0; i < 4; i++) p.process([], [block()])
    const out = block()
    p.process([], [out])
    expect(Array.from(out[0])).toEqual(new Array(128).fill(0))
  })

  it('drops the oldest chunk when more than six are queued', () => {
    const p = new Processor()
    // Seven chunks, each a different value. The first must be gone.
    for (let i = 1; i <= 7; i++) p.port.onmessage!({ data: chunk(i / 10) })
    const out = block()
    p.process([], [out])
    expect(out[0][0]).toBeCloseTo(0.2)
  })

  it('ignores a message that is not audio', () => {
    const p = new Processor()
    for (const bad of [null, undefined, 'x', 42, {}]) p.port.onmessage!({ data: bad })
    const out = block()
    expect(p.process([], [out])).toBe(true)
    expect(out[0][0]).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/shareAudioWorklet.test.ts`
Expected: FAIL — `ENOENT` for `public/share-audio-worklet.js`.

- [ ] **Step 3: Write `public/share-audio-worklet.js`**

```js
/**
 * Shared-application audio, on the audio thread.
 *
 * A native addon captures one application's sound on Windows and sends it
 * here as interleaved stereo float chunks. This turns that stream back into
 * an AudioWorklet output, which becomes a MediaStreamTrack and goes out as a
 * second LiveKit track beside the screen share.
 *
 * The audio thread cannot wait for anything, so the only job here is a ring
 * buffer with two honest failure modes: when a chunk is late, render silence;
 * when chunks arrive faster than they are consumed, drop the oldest. Silence
 * is a gap in the sound, which is what a dropped packet should be. Repeating
 * the last block instead would sound like a stutter, and growing the queue
 * without limit would turn a hiccup into permanent delay.
 *
 * Served from /public rather than bundled: AudioWorklet.addModule() fetches a
 * classic script by URL, so it must exist as a plain file at a stable path.
 */

// Six 10 ms chunks. Enough to ride out ordinary IPC jitter, short enough that
// the sound stays with the picture.
const MAX_QUEUED = 6

class ShareAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    /** @type {Float32Array[]} interleaved stereo chunks, oldest first */
    this.queue = []
    /** How far into queue[0] the last block got. */
    this.offset = 0
    this.port.onmessage = (event) => {
      const chunk = event.data
      if (!(chunk instanceof Float32Array) || chunk.length === 0) return
      this.queue.push(chunk)
      // Dropping the oldest keeps delay bounded. Dropping the newest would
      // hold on to sound nobody will hear in time.
      while (this.queue.length > MAX_QUEUED) { this.queue.shift(); this.offset = 0 }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    if (!out || out.length === 0) return true
    const left = out[0]
    const right = out.length > 1 ? out[1] : out[0]

    for (let i = 0; i < left.length; i++) {
      const chunk = this.queue[0]
      if (!chunk) { left[i] = 0; right[i] = 0; continue }
      left[i] = chunk[this.offset]
      right[i] = chunk[this.offset + 1]
      this.offset += 2
      if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0 }
    }
    // Never return false: that ends the node for good, and the share may well
    // go quiet for a while before it has more to say.
    return true
  }
}

registerProcessor('share-audio', ShareAudioProcessor)
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/composables/__tests__/shareAudioWorklet.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add public/share-audio-worklet.js src/composables/__tests__/shareAudioWorklet.test.ts
git commit -m "feat(share): the audio thread's ring buffer for a shared app

Two honest failure modes and no others: a late chunk renders silence, and
a queue over 60ms drops its oldest. Repeating the last block would sound
like a stutter, and an unbounded queue would turn one hiccup into delay
that never comes back.

Tested by evaluating the shipped file against stubbed worklet globals, so
the test covers the artifact and not a copy of it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The renderer's track

**Files:**
- Create: `src/composables/shareAudioTrack.ts`
- Test: `src/composables/__tests__/shareAudioTrack.test.ts`

**Interfaces:**
- Consumes: the worklet name `'share-audio'` and the URL `/share-audio-worklet.js` from Task 4.
- Produces:
  `startShareAudioTrack(port: MessagePort, ctxFactory?: () => AudioContext): Promise<MediaStreamTrack | null>` and
  `stopShareAudioTrack(): Promise<void>`.

**Context you need:** tests run in the **node** environment (see `vitest.config.mts`), so `AudioContext` does not exist — stub it and inject through `ctxFactory`. The app's existing tests take this approach; see `src/composables/__tests__/callLimits.test.ts` for the shape.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startShareAudioTrack, stopShareAudioTrack } from '../shareAudioTrack'

const track = { kind: 'audio', id: 't1', stop: vi.fn() }

class FakeCtx {
  static added: string[] = []
  sampleRate = 48000
  state = 'running'
  audioWorklet = { addModule: vi.fn(async (u: string) => { FakeCtx.added.push(u) }) }
  close = vi.fn(async () => { this.state = 'closed' })
  createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [track] } })
}
const node = { connect: vi.fn(), disconnect: vi.fn(), port: { postMessage: vi.fn(), close: vi.fn() } }

const port = () => ({ onmessage: null as ((e: MessageEvent) => void) | null, start: vi.fn(), close: vi.fn() })

beforeEach(async () => {
  await stopShareAudioTrack()
  FakeCtx.added = []
  vi.clearAllMocks()
  ;(globalThis as Record<string, unknown>).AudioWorkletNode = vi.fn(() => node)
})

describe('startShareAudioTrack', () => {
  it('loads the worklet from its stable public path', async () => {
    await startShareAudioTrack(port() as unknown as MessagePort, () => new FakeCtx() as unknown as AudioContext)
    expect(FakeCtx.added).toEqual(['/share-audio-worklet.js'])
  })

  it('returns the destination track', async () => {
    const t = await startShareAudioTrack(port() as unknown as MessagePort, () => new FakeCtx() as unknown as AudioContext)
    expect(t).toBe(track)
  })

  it('forwards each chunk to the worklet', async () => {
    const p = port()
    await startShareAudioTrack(p as unknown as MessagePort, () => new FakeCtx() as unknown as AudioContext)
    const chunk = new Float32Array(960)
    p.onmessage!({ data: chunk } as MessageEvent)
    expect(node.port.postMessage).toHaveBeenCalledWith(chunk, [chunk.buffer])
  })

  it('refuses a second start while one is running', async () => {
    const make = () => new FakeCtx() as unknown as AudioContext
    await startShareAudioTrack(port() as unknown as MessagePort, make)
    expect(await startShareAudioTrack(port() as unknown as MessagePort, make)).toBeNull()
  })

  it('returns null and closes the port when the worklet will not load', async () => {
    const p = port()
    const broken = () => {
      const c = new FakeCtx()
      c.audioWorklet.addModule = vi.fn(async () => { throw new Error('nope') })
      return c as unknown as AudioContext
    }
    expect(await startShareAudioTrack(p as unknown as MessagePort, broken)).toBeNull()
    expect(p.close).toHaveBeenCalled()
  })
})

describe('stopShareAudioTrack', () => {
  it('stops the track, closes the port and the context', async () => {
    const p = port()
    const ctx = new FakeCtx()
    await startShareAudioTrack(p as unknown as MessagePort, () => ctx as unknown as AudioContext)
    await stopShareAudioTrack()
    expect(track.stop).toHaveBeenCalled()
    expect(p.close).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
  })

  it('is safe to call when nothing is running', async () => {
    await expect(stopShareAudioTrack()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/shareAudioTrack.test.ts`
Expected: FAIL — `Failed to resolve import "../shareAudioTrack"`.

- [ ] **Step 3: Write `src/composables/shareAudioTrack.ts`**

```ts
/**
 * One shared application's sound, as a track LiveKit can publish.
 *
 * The Windows app captures it natively and sends interleaved stereo float
 * chunks down a MessagePort. This end turns that back into audio: an
 * AudioWorklet ring-buffers the chunks and a MediaStreamAudioDestinationNode
 * gives us a real MediaStreamTrack.
 *
 * Deliberately NOT a getUserMedia track: Chromium's echo canceller, gain
 * control and noise suppression are built for a microphone, and a game's
 * soundtrack run through them comes out pumping and hollow. A worklet's
 * output goes out as it arrived.
 *
 * Module-level state, one share at a time, matching the rest of the voice
 * composables.
 */
const WORKLET_URL = '/share-audio-worklet.js'
const WORKLET_NAME = 'share-audio'

interface Live {
  ctx: AudioContext
  node: AudioWorkletNode
  port: MessagePort
  track: MediaStreamTrack
}
let live: Live | null = null

/**
 * Build the track and start feeding it. Returns null when the browser will
 * not give us a worklet, which is not worth a toast on its own — the caller
 * reports the share going out without sound.
 */
export const startShareAudioTrack = async (
  port: MessagePort,
  ctxFactory: () => AudioContext = () => new AudioContext({ sampleRate: 48000 }),
): Promise<MediaStreamTrack | null> => {
  if (live) return null
  const ctx = ctxFactory()
  try {
    await ctx.audioWorklet.addModule(WORKLET_URL)
  } catch (e) {
    console.warn('[share-audio] the worklet did not load', e)
    port.close()
    await ctx.close().catch(() => {})
    return null
  }

  const node = new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 0, outputChannelCount: [2] })
  const dest = ctx.createMediaStreamDestination()
  node.connect(dest)

  // Transfer rather than copy: this runs 100 times a second.
  port.onmessage = (event: MessageEvent) => {
    const chunk = event.data
    if (!(chunk instanceof Float32Array)) return
    node.port.postMessage(chunk, [chunk.buffer])
  }
  port.start?.()

  const track = dest.stream.getAudioTracks()[0] ?? null
  if (!track) { port.close(); await ctx.close().catch(() => {}); return null }
  live = { ctx, node, port, track }
  return track
}

/** Tear everything down. Safe whether or not a share is running. */
export const stopShareAudioTrack = async (): Promise<void> => {
  const l = live
  live = null
  if (!l) return
  l.port.onmessage = null
  l.port.close()
  l.node.disconnect()
  l.track.stop()
  await l.ctx.close().catch(() => {})
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/composables/__tests__/shareAudioTrack.test.ts && npm run typecheck`
Expected: PASS, 7 tests, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/composables/shareAudioTrack.ts src/composables/__tests__/shareAudioTrack.test.ts
git commit -m "feat(share): the shared app's sound as a publishable track

Chunks arrive on a MessagePort, a worklet ring-buffers them and a
destination node turns them back into a MediaStreamTrack.

Not a getUserMedia track on purpose: Chromium's echo canceller, gain
control and noise suppression exist for a microphone, and a game's
soundtrack run through them comes out pumping and hollow.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The capture helper and its port

**Files:**
- Create: `desktop/src/shareAudioHelper.ts`, `desktop/src/shareAudio.ts`
- Test: `desktop/src/__tests__/shareAudio.test.ts`
- Modify: `desktop/tsconfig.json` if `native/index.js` is not already outside `include` (it must not be compiled)

**Interfaces:**
- Consumes: `rootOfApp(pid, table)` from Task 1; the addon from Task 3.
- Produces: `startShareAudio(pid: number, page: WebContents): boolean` and `stopShareAudio(): void` from `desktop/src/shareAudio.ts`; and `resolveRootPid(hwndPid: number, addon: CaptureAddon): number | null` exported from the same file for testing.

**Context you need:** the helper is spawned with `utilityProcess.fork`. It receives one `MessagePortMain` and the pid to capture, loads the addon, and posts chunks down the port. The main process forwards the other end of the port to the page with `webContents.postMessage`. The addon must never be `require`d in the main process — only in the helper.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { resolveRootPid } from '../shareAudio'

const addon = (table: { pid: number; parentPid: number; exe: string; createdAt: number }[]) => ({
  supported: () => true,
  processTable: () => table,
  pidForWindow: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
})

describe('resolveRootPid', () => {
  it('walks the window pid up to the application root', () => {
    const a = addon([
      { pid: 10, parentPid: 1, exe: 'explorer.exe', createdAt: 1 },
      { pid: 20, parentPid: 10, exe: 'chrome.exe', createdAt: 2 },
      { pid: 30, parentPid: 20, exe: 'chrome.exe', createdAt: 3 },
    ])
    expect(resolveRootPid(30, a)).toBe(20)
  })

  it('gives null when the addon cannot work at all', () => {
    expect(resolveRootPid(30, { ...addon([]), supported: () => false })).toBeNull()
  })

  it('gives null when the pid is not in the table', () => {
    expect(resolveRootPid(999, addon([{ pid: 1, parentPid: 0, exe: 'a.exe', createdAt: 1 }]))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run desktop/src/__tests__/shareAudio.test.ts`
Expected: FAIL — `Failed to resolve import "../shareAudio"`.

- [ ] **Step 3: Write the helper `desktop/src/shareAudioHelper.ts`**

```ts
/**
 * The only process that ever loads the capture addon.
 *
 * This is the whole reason it is a separate process. It is the first native
 * code in Skycord and it runs during calls; a fault in C++ audio code should
 * cost a helper we can restart, not the call and the window.
 *
 * It owns nothing but the running capture. The main process tells it which
 * application to capture and hands it one end of a port to the page; audio
 * never travels through the main process at all.
 */
import type { MessagePortMain } from 'electron'

// Resolved from dist/, so two levels up to desktop/.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const addon = require('../native') as {
  supported: () => boolean
  start: (pid: number, onChunk: (chunk: Buffer) => void) => boolean
  stop: () => void
}

process.parentPort.once('message', (event) => {
  const port = event.ports[0] as MessagePortMain | undefined
  const pid = (event.data as { pid?: unknown })?.pid
  if (!port || typeof pid !== 'number') { process.exit(1); return }

  port.start()
  const ok = addon.start(pid, (chunk) => {
    // Hand over a Float32Array view of a copy: the buffer is transferred, so
    // it must not be one the addon or another chunk still owns.
    const copy = new Float32Array(chunk.byteLength / 4)
    Buffer.from(copy.buffer).set(chunk)
    port.postMessage(copy, [copy.buffer as unknown as MessagePortMain])
  })

  // The parent waits for this before it publishes anything.
  process.parentPort.postMessage({ started: ok })
  if (!ok) process.exit(0)
})

const shutDown = () => { try { addon.stop() } catch { /* already gone */ } process.exit(0) }
process.on('SIGTERM', shutDown)
process.on('exit', () => { try { addon.stop() } catch { /* already gone */ } })
```

- [ ] **Step 4: Write the lifecycle `desktop/src/shareAudio.ts`**

```ts
/**
 * Starting and stopping one application's audio capture.
 *
 * Owns the helper process and the port to the page. The addon is loaded here
 * only to read facts — the process table and a window's pid. Capture itself
 * happens in the helper, and audio never passes through this process.
 */
import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'path'
import { rootOfApp, type ProcRow } from './processWalk'

export interface CaptureAddon {
  supported: () => boolean
  pidForWindow: (hwnd: number) => number | null
  processTable: () => ProcRow[]
  start: (pid: number, onChunk: (chunk: Buffer) => void) => boolean
  stop: () => void
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nativeAddon = (): CaptureAddon => require('../native') as CaptureAddon

/**
 * The application behind a window's process, or null when this machine cannot
 * capture per-app audio or the process has already gone.
 */
export const resolveRootPid = (windowPid: number, addon: CaptureAddon = nativeAddon()): number | null => {
  if (!addon.supported()) return null
  return rootOfApp(windowPid, addon.processTable())
}

/** The pid behind a `window:<HWND>:0` source id, or null. */
export const pidForSource = (sourceId: string, addon: CaptureAddon = nativeAddon()): number | null => {
  const hwnd = Number(sourceId.split(':')[1])
  if (!addon.supported() || !Number.isInteger(hwnd) || hwnd <= 0) return null
  const windowPid = addon.pidForWindow(hwnd)
  return windowPid === null ? null : rootOfApp(windowPid, addon.processTable())
}

let helper: UtilityProcess | null = null

/**
 * Capture `pid` and deliver it to `page`. Returns false when the helper could
 * not start it — the caller shares video without sound and says so.
 */
export const startShareAudio = async (pid: number, page: WebContents): Promise<boolean> => {
  stopShareAudio()
  const entry = join(__dirname, 'shareAudioHelper.js')
  const child = utilityProcess.fork(entry, [], { serviceName: 'skycord-share-audio' })
  helper = child

  const { port1, port2 } = new MessageChannelMain()
  // The page gets its end first, so nothing is posted into a void.
  page.postMessage('share-audio-port', null, [port1])

  const started = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 5000)
    child.once('message', (msg: { started?: boolean }) => { clearTimeout(timer); resolve(msg?.started === true) })
    child.once('exit', () => { clearTimeout(timer); resolve(false) })
    child.postMessage({ pid }, [port2])
  })

  if (!started) stopShareAudio()
  return started
}

/** Stop and forget the helper. Safe whether or not one is running. */
export const stopShareAudio = (): void => {
  const child = helper
  helper = null
  if (child) { try { child.kill() } catch { /* already gone */ } }
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run desktop/src/__tests__/shareAudio.test.ts && npm run typecheck`
Expected: PASS, 3 tests, clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shareAudio.ts desktop/src/shareAudioHelper.ts desktop/src/__tests__/shareAudio.test.ts
git commit -m "feat(share): capture in a process of its own

The helper is the only place the addon is ever loaded. It is the first
native code in Skycord and it runs during calls, so a fault in C++ audio
code costs a process we restart rather than the call.

Audio never passes through the main process: it goes straight down a
MessagePort to the page. Main only reads facts — the process table, and
a window's pid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The picker offers sound for a window

**Files:**
- Modify: `desktop/src/sharePage.ts:89-99`, `desktop/src/sharePage.ts:125-128`, `desktop/src/sharePage.ts:194`, `desktop/src/sharePage.ts:400`, `desktop/src/sharePage.ts:445`
- Modify: `desktop/src/sharePicker.ts` (resolve the pid on the chosen source)
- Test: `desktop/src/__tests__/shareAudioCopy.test.ts`

**Interfaces:**
- Consumes: `pidForSource` from Task 6; `Remembered.windowAudio` / `.screenAudio` from Task 2.
- Produces: `audioLine(kind: 'screen' | 'window', on: boolean, supported: boolean, appName: string): string` exported from `desktop/src/shareQuality.ts`, so the picker's wording is testable without a browser.

**Context you need:** `sharePage.ts` currently disables the audio row for a window (`const off = tab !== 'screen'`) and its description reads `'Includes this call, so others may hear an echo'`. Both go. The row keeps one `audio` variable in the page, but its remembered value now depends on the tab.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { audioLine } from '../shareQuality'

describe('audioLine', () => {
  it('names the application whose sound goes out', () => {
    expect(audioLine('window', true, true, 'Firefox')).toBe('Sends Firefox’s sound, and all of it — every window and tab')
  })

  it('says nothing goes out when it is off', () => {
    expect(audioLine('window', false, true, 'Firefox')).toBe('No sound goes with this share')
    expect(audioLine('screen', false, true, '')).toBe('No sound goes with this share')
  })

  it('promises the call is left out of a whole-screen share', () => {
    expect(audioLine('screen', true, true, '')).toBe('Sends everything your PC plays, except this call')
  })

  it('explains an old Windows instead of offering the option', () => {
    expect(audioLine('window', false, false, 'Firefox')).toBe('Your version of Windows cannot share one app’s sound')
    expect(audioLine('window', true, false, 'Firefox')).toBe('Your version of Windows cannot share one app’s sound')
  })

  it('still offers whole-screen sound on an old Windows', () => {
    expect(audioLine('screen', true, false, '')).toBe('Sends everything your PC plays, except this call')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run desktop/src/__tests__/shareAudioCopy.test.ts`
Expected: FAIL — `audioLine` is not exported.

- [ ] **Step 3: Add `audioLine` to `desktop/src/shareQuality.ts`**

```ts
/**
 * What the picker says beneath "Share stream audio".
 *
 * It states what leaves the machine, every time, because that is the thing
 * worth being sure about. A window share names the application and admits it
 * sends all of it; a screen share promises only that the call is left out.
 */
export const audioLine = (
  kind: 'screen' | 'window', on: boolean, supported: boolean, appName: string,
): string => {
  if (kind === 'window' && !supported) return 'Your version of Windows cannot share one app’s sound'
  if (!on) return 'No sound goes with this share'
  return kind === 'window'
    ? `Sends ${appName}’s sound, and all of it — every window and tab`
    : 'Sends everything your PC plays, except this call'
}
```

- [ ] **Step 4: Use it in the picker page**

In `desktop/src/sharePage.ts`, replace the block at lines 89–99:

```ts
    // Sound follows what you share: a window sends its application, a whole
    // screen sends everything except this call.
    const audioItem = document.getElementById('audio-item')
    if (audioItem) {
      const off = tab === 'window' && !settings.perAppAudio
      audioItem.setAttribute('aria-disabled', String(off))
      audioItem.setAttribute('aria-checked', String(!off && audio))
      const desc = $('audio-desc')
      desc.textContent = audioLine(tab === 'screen' ? 'screen' : 'window', audio, settings.perAppAudio, selectedName())
      desc.classList.toggle('warn', false)
    }
```

Add `selectedName()` near the other helpers in that file — the name of the tile currently selected, which the page already holds for rendering:

```ts
  /** The chosen tile's own label, for copy that names what is being shared. */
  const selectedName = (): string => {
    const tile = tiles.find(t => t.id === selectedId)
    return tile?.name ?? 'this app'
  }
```

Import `audioLine` at the top of `sharePage.ts` from `./shareQuality`, alongside whatever it already imports from there.

- [ ] **Step 5: Carry the per-kind remembered value and the new flag**

At line 445, where the page seeds `audio` from `settings.last.audio`, replace with a value that follows the tab, and re-seed on a tab change:

```ts
    audio = tab === 'screen' ? settings.last.screenAudio : settings.last.windowAudio
```

In `desktop/src/sharePicker.ts`, add `perAppAudio` to the `share:init` reply so the page knows whether this machine can do it:

```ts
ipcMain.handle('share:init', event => {
  const o = fromPicker(event)
  return o ? {
    quality: o.opts.quality, audio: o.opts.audio, last: o.opts.last,
    perAppAudio: nativeAddon().supported(),
    presets: PRESETS, resolutions: RESOLUTIONS, frameRates: FRAME_RATES,
  } : null
})
```

Import it: `import { pidForSource, type CaptureAddon } from './shareAudio'` plus a small local `const nativeAddon = () => require('../native') as CaptureAddon` — or export `supportsPerAppAudio()` from `shareAudio.ts` and use that. Prefer the latter; add to `desktop/src/shareAudio.ts`:

```ts
/** Whether this machine can capture one application's sound. */
export const supportsPerAppAudio = (addon: CaptureAddon = nativeAddon()): boolean => addon.supported()
```

- [ ] **Step 6: Resolve the pid when a window is chosen**

In `desktop/src/sharePicker.ts`, in the `share:choose` handler, after `parseChoice` succeeds, fill in the pid:

```ts
  const choice = o ? parseChoice(value, o.shown) : null
  const withPid = choice && choice.kind === 'window' && choice.audio
    ? { ...choice, pid: pidForSource(choice.sourceId) }
    : choice
```

and use `withPid` wherever `choice` was used from that point on in the handler.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run desktop/src && npm run typecheck`
Expected: PASS, and a clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/shareQuality.ts desktop/src/sharePage.ts desktop/src/sharePicker.ts desktop/src/shareAudio.ts desktop/src/__tests__/shareAudioCopy.test.ts
git commit -m "feat(share): the picker offers a window's own sound

Sound follows what you share, and the line beneath the switch says what
leaves the machine every time: a window names its application and admits
it sends all of it, tabs included; a screen promises only that the call
is left out. An old Windows is told it cannot, rather than being given a
switch that does nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire it end to end

**Files:**
- Modify: `desktop/src/displayMedia.ts`, `desktop/src/preload.ts`, `src/composables/desktopBridge.ts`, `src/composables/shareOptions.ts`, `src/composables/useVoiceMedia.ts`
- Test: `src/composables/__tests__/shareOptions.test.ts`, `src/composables/__tests__/toggleScreenShare.test.ts`

**Interfaces:**
- Consumes: `startShareAudio`/`stopShareAudio` (Task 6); `startShareAudioTrack`/`stopShareAudioTrack` (Task 5); `ShareChoice.pid` (Task 2).
- Produces: `DesktopShareChoice` gains `pid: number | null`; `shareOptions(c)` sets `capture.audio` only for a screen.

**Context you need:** `useVoiceMedia.ts:198` calls `room.localParticipant.setScreenShareEnabled(next, capture, publish)`. That publishes the video and, for a screen with `capture.audio`, the system audio track. The per-app track is published separately with `publishTrack`.

- [ ] **Step 1: Write the failing tests**

Add to `src/composables/__tests__/shareOptions.test.ts`:

```ts
  it('lets LiveKit capture audio for a whole screen', () => {
    const { capture } = shareOptions({ kind: 'screen', audio: true, pid: null, resolution: 1080, frameRate: 30, hidePreview: false, sourceId: 'screen:1:0', name: 'Entire screen' })
    expect(capture.audio).toBe(true)
  })

  it('never lets LiveKit capture audio for a window: that track is built here', () => {
    const { capture } = shareOptions({ kind: 'window', audio: true, pid: 913, resolution: 1080, frameRate: 30, hidePreview: false, sourceId: 'window:42:0', name: 'Firefox' })
    expect(capture.audio).toBe(false)
  })

  it('asks Chromium to leave this app out of a screen share’s sound', () => {
    const { capture } = shareOptions({ kind: 'screen', audio: true, pid: null, resolution: 1080, frameRate: 30, hidePreview: false, sourceId: 'screen:1:0', name: 'Entire screen' })
    expect((capture as { audio?: unknown }).audio).toBe(true)
    expect(capture.systemAudio).toBeUndefined()
    expect((capture as unknown as { restrictOwnAudio?: boolean }).restrictOwnAudio).toBe(true)
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/composables/__tests__/shareOptions.test.ts`
Expected: FAIL — window audio is `true` and `restrictOwnAudio` is undefined.

- [ ] **Step 3: Teach `shareOptions` the split**

In `src/composables/shareOptions.ts`, replace `audio: c.audio,` inside `capture` with:

```ts
      /**
       * Only a whole screen's sound comes through LiveKit's own capture, and
       * it asks Chromium to leave this app out of it — restrictOwnAudio picks
       * the loopback device that excludes our own process tree, so nobody
       * hears the call back. A window's sound is captured natively, per
       * application, and published as its own track.
       */
      audio: c.kind === 'screen' && c.audio,
      ...(c.kind === 'screen' && c.audio ? { restrictOwnAudio: true } : {}),
```

`ScreenShareCaptureOptions` does not declare `restrictOwnAudio`, so widen the return type where it is built. Change the `capture` object's construction to end with a cast:

```ts
  const capture = {
    /* ...as above... */
  } as ScreenShareCaptureOptions & { restrictOwnAudio?: boolean }
```

and return `{ capture, publish }`.

- [ ] **Step 4: Carry the pid across the bridge**

In `src/composables/desktopBridge.ts`, add `pid: number | null` to `DesktopShareChoice`.

In `desktop/src/preload.ts`, nothing changes — the choice is already forwarded whole.

In `desktop/src/displayMedia.ts`, return the pid from the `desktop:pickShare` handler:

```ts
    return { kind: choice.kind, resolution: choice.resolution, frameRate: choice.frameRate, audio: choice.audio, pid: choice.pid, hidePreview: choice.hidePreview }
```

and stop asking Chromium for loopback on a window, which it could never do anyway:

```ts
    callback({
      video: { id: choice.sourceId, name: choice.name },
      // A window's sound is captured natively and published separately; only
      // a whole screen's comes from Chromium.
      ...(request.audioRequested && choice.audio && choice.kind === 'screen' ? { audio: 'loopback' as const } : {}),
    })
```

(that last line is unchanged — confirm it still reads exactly this, since Task 2 changed `parseChoice` around it).

- [ ] **Step 5: Start the capture when a window share with audio begins**

In `desktop/src/displayMedia.ts`, inside the `desktop:pickShare` handler, after `pending` is set:

```ts
    pending = { choice, at: Date.now() }
    // A window's sound is captured natively. Start it before the page
    // publishes, so the track is fed from its first block.
    let audioStarted = false
    if (choice.kind === 'window' && choice.audio && choice.pid !== null) {
      audioStarted = await startShareAudio(choice.pid, event.sender)
    }
    return { kind: choice.kind, resolution: choice.resolution, frameRate: choice.frameRate, audio: choice.audio && (choice.kind === 'screen' || audioStarted), pid: choice.pid, hidePreview: choice.hidePreview }
```

Import `startShareAudio` and `stopShareAudio` from `./shareAudio` at the top.

- [ ] **Step 6: Publish and unpublish the track**

In `src/composables/useVoiceMedia.ts`, inside `toggleScreenShare`, after `setScreenShareEnabled` succeeds:

```ts
    await room.localParticipant.setScreenShareEnabled(next, capture, publish)
    if (next) {
      const track = await takeShareAudioTrack()
      if (track) await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShareAudio })
    } else {
      await stopShareAudioTrack()
    }
```

`takeShareAudioTrack` waits for the port the main process sent. Add it to `src/composables/shareAudioTrack.ts`:

```ts
/**
 * The port arrives from the main process as a page message, which may land
 * before or after the share starts, so it is kept until asked for.
 */
let waiting: MessagePort | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data === 'share-audio-port' && event.ports[0]) waiting = event.ports[0]
  })
}

/** The track for the port the app sent, if it sent one. */
export const takeShareAudioTrack = async (): Promise<MediaStreamTrack | null> => {
  const port = waiting
  waiting = null
  return port ? startShareAudioTrack(port) : null
}
```

Also call `await stopShareAudioTrack()` in the `catch` branch of `toggleScreenShare`, so a failed start leaves nothing running.

- [ ] **Step 7: Say so when the sound could not be captured**

In `src/composables/useVoiceMedia.ts`, the choice already tells us: `choice.audio` comes back `false` when the native start failed but the user asked for it. Capture that before `shareOptions` overwrites it:

```ts
  let audioRefused = false
  if (bridge?.pickShare) {
    const choice = await bridge.pickShare(pickerHints())
    if (!choice) return null
    audioRefused = choice.kind === 'window' && choice.pid !== null && !choice.audio
    ;({ capture, publish } = shareOptions(choice))
    hideOwn = choice.hidePreview === true
  }
```

and in the success path, after publishing:

```ts
    if (audioRefused) return "Couldn't capture that app's sound — sharing video only"
    return null
```

- [ ] **Step 8: Stop capture when the share stops**

In `desktop/src/displayMedia.ts`, the app must not keep capturing after a share ends. Add to `handleDisplayMedia`, inside the exported function:

```ts
  // The page tells us when it stops sharing; a page that goes away stops too.
  ipcMain.on('desktop:shareAudioStop', event => {
    if (event.sender === getPage()) stopShareAudio()
  })
```

Expose it in `desktop/src/preload.ts` alongside the other share methods as `stopShareAudio: () => ipcRenderer.send('desktop:shareAudioStop')`, add it to `DesktopBridge` in `src/composables/desktopBridge.ts`, and call `bridge?.stopShareAudio?.()` in the `next === false` branch of `toggleScreenShare`.

- [ ] **Step 9: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass (811 client + the new ones, 63 desktop + the new ones), clean typecheck.

- [ ] **Step 10: Commit**

```bash
git add desktop/src src/composables
git commit -m "feat(share): sound follows what you share

A window publishes its application's sound as its own track, captured
natively. A whole screen keeps Chromium's loopback and now asks for
restrictOwnAudio with it, which picks the device that leaves our own
process tree out — so the call is no longer sent back to the people in it.

When the native capture will not start, the share still goes out and says
it went out without sound. The video was the point.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation, changelog, and the checks a person must make

**Files:**
- Modify: `docs/ROADMAP.md`, `landing/index.html`, `README.md`
- Create: `docs/share-audio.md`

- [ ] **Step 1: Write `docs/share-audio.md`**

```markdown
# Screen-share audio

Sound follows what you share.

| Shared | Sound sent | Default | How |
|---|---|---|---|
| A window | That application only | on | `desktop/native`, WASAPI process loopback |
| A whole screen | Everything except Skycord | off | Chromium's `restrictOwnAudio` |

## Why a window needs native code

Chromium offers one loopback device: the whole system. Windows has had
per-process loopback since version 2004, through
`ActivateAudioInterfaceAsync`, but Chromium does not expose it. So a window's
sound is captured by our own addon, in a utility process, and published as a
second LiveKit track (`Track.Source.ScreenShareAudio`).

## Which process is "the application"

A window's own process is usually the wrong one — a Chrome tab is a renderer,
and the sound comes from a sibling. `desktop/src/processWalk.ts` walks up the
parent chain while the executable name stays the same, so a Chrome renderer
resolves to the Chrome browser process and a Steam game resolves to itself.

**This means sharing one Chrome window sends all of Chrome's sound.** Windows
offers nothing finer than a process tree, and the picker says so.

## When it does not work

- Windows below build 19041: the option is disabled for windows, with a reason.
- A wrong root: the capture succeeds and delivers silence. Windows gives no
  signal that distinguishes this from an application that is simply quiet, so
  there is no runtime detection. The walk is what keeps it rare.
```

- [ ] **Step 2: Retire the roadmap line**

In `docs/ROADMAP.md`, the custom screen-share section ends with "Echo-free audio needs native per-process capture: a later release." Replace that sentence with:

```markdown
Echo-free audio shipped after all, in two halves: a whole screen now uses
Chromium's `restrictOwnAudio`, and a window's sound is captured per
application by our own addon. See `docs/share-audio.md`.
```

- [ ] **Step 3: Add the changelog entry**

In `landing/index.html`, at the top of `var RELEASES = [{`, add a new release above v0.20.0. Use the day you ship it and the real commit time.

```js
  {
    v: 'v0.20.1', date: '<ship date>', time: '<HH:MM UTC+2>', title: 'Share one app’s sound',
    items: [
      ['add', 'Sharing a window now sends that application’s sound, and only that application’s. It is on by default, because sharing a game without its sound is rarely what anyone meant. Windows can only separate sound by application, not by window, so sharing one browser window sends every tab — the picker says so before you start'],
      ['fix', 'Sharing a whole screen no longer sends the call back to the people in it. It still sends everything else your PC is playing, so it stays off until you turn it on'],
      ['imp', 'The picker’s audio line now says what actually leaves your machine, for each kind of share, instead of warning about an echo that is gone']
    ]
  },
```

Also remove the "Screen-share sound from one app instead of the whole PC" line from the roadmap data in the same file — it has shipped.

- [ ] **Step 4: Run everything one last time**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/share-audio.md docs/ROADMAP.md landing/index.html
git commit -m "docs(share): what per-app share audio does and cannot do

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand the owner the checks only a person can make**

These need Windows, a second participant and ears. Report them; do not claim them.

1. Share a game window with sound. The other side hears the game and does not hear themselves.
2. Share a Chrome window playing music. The other side hears it — and hears other Chrome tabs too, which is expected and documented.
3. Share a whole screen with sound. The other side hears the PC and does not hear themselves.
4. Listen for pumping or hollowness on the shared audio. There should be none: this track never goes through the microphone's echo canceller. If it does, the track is being treated as a mic source and needs `publishTrack` options checked.
5. Watch a video in the shared window for several minutes. Sound and picture should stay together.
6. Turn the share off and confirm `skycord-share-audio` disappears from Task Manager.

---

## Self-review

**Spec coverage.** Rule and defaults → Tasks 2, 7. Process walk → Task 1. Addon
→ Task 3. Utility process and port → Task 6. Worklet → Task 4. Track → Task 5.
`restrictOwnAudio` → Task 8. Failure behaviour → Tasks 7 (old Windows), 8
(start failed). Packaging and CI → Task 3. Tests → each task; owner checks →
Task 9. No gaps.

**Naming.** `rootOfApp`, `ProcRow`, `resolveRootPid`, `pidForSource`,
`supportsPerAppAudio`, `startShareAudio`, `stopShareAudio`,
`startShareAudioTrack`, `stopShareAudioTrack`, `takeShareAudioTrack`,
`audioLine` — each defined once and used under the same name everywhere.

**Known risk, to be settled by measurement in Task 9's check 4.** Whether a
`MediaStreamAudioDestinationNode` track escapes Chromium's audio processing is
asserted here from how WebRTC treats non-`getUserMedia` sources, not from an
observation on this build. If check 4 finds pumping, the fix is to publish with
explicit processing disabled, and the plan should be amended rather than the
finding explained away.

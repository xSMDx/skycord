# Updates you can see, and a debug tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An update that finishes and installs when asked, a version you can read, and diagnostics that make the next failure a ten-second check.

**Architecture:** One update state lives in the main process, built by a pure reducer, and is pushed to the page over IPC. The launch gate is deleted so the app never waits. Two new Settings pages consume that state — Updates (always visible on desktop) and Debug (hidden until the Skycord icon is tapped seven times).

**Tech Stack:** Electron 44, electron-updater 6, Vue 3, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-29-updates-and-debug-design.md`

## Global Constraints

- **Do not write download machinery.** `NsisUpdater` already tries `differentialDownloadInstaller()` and `disableDifferentialDownload` defaults to `false`. This work makes the existing download able to finish.
- **Never delete the cached `installer.exe`** — differential updates diff against it.
- **The app never restarts itself.** `quitAndInstall` runs only from a person's click.
- **No server changes.** No API, no user field, no migration. The debug unlock is `localStorage`.
- **Desktop-only surfaces must be absent in a browser**, except the Debug page, which appears with desktop-only rows marked "desktop only".
- Unlock needs **7 taps, each within 3000ms of the last**; a longer gap resets the count.
- Tests run from the repo root: `npx vitest run`. Typechecks: `npm run typecheck` and, in `desktop/`, `npx tsc --noEmit -p tsconfig.json`.
- `desktop/src/*` modules that are unit-tested must not `import` electron at module scope — CI installs only the root package. Use `import type` plus a lazy `require` inside the function.
- Commit messages: lower-case `type(scope): subject`, a body explaining *why*, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/updateState.ts` *(new)* | Pure: the phase machine. No electron. |
| `desktop/src/updates.ts` | Rewritten: owns the state, talks to electron-updater, broadcasts. |
| `desktop/src/main.ts:262,294` | Stop awaiting the launch gate. |
| `desktop/src/about.ts` *(new)* | Gathers version and addon facts for the bridge. |
| `desktop/src/preload.ts` | Exposes `updates` and `about`. |
| `src/composables/desktopBridge.ts` | Types for both. |
| `src/composables/debugUnlock.ts` *(new)* | Pure: tap counter + localStorage flag. |
| `src/composables/useUpdates.ts` *(new)* | Renderer-side reactive mirror of the state. |
| `src/components/settings/UpdatesPage.vue` *(new)* | The Updates page. |
| `src/components/settings/DebugPage.vue` *(new)* | The Debug page. |
| `src/components/modals/SettingsModal.vue` | Registers and renders both. |
| `src/components/settings/AboutInstancePage.vue` | The seven taps. |

---

### Task 1: The phase machine

**Files:**
- Create: `desktop/src/updateState.ts`
- Test: `desktop/src/__tests__/updateState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `UpdatePhase`, `UpdateState`, `initialUpdateState`, `UpdateEvent`, `reduceUpdate(state, event): UpdateState`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { initialUpdateState, reduceUpdate, type UpdateState } from '../updateState'

const at = 1_700_000_000_000

describe('reduceUpdate', () => {
  it('starts idle, with nothing claimed', () => {
    expect(initialUpdateState).toEqual({
      phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '',
    })
  })

  it('a check in flight is a phase, not a guess', () => {
    expect(reduceUpdate(initialUpdateState, { type: 'check' }).phase).toBe('checking')
  })

  it('an available update names its version and resets progress', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'available', version: '1.2.3' })
    expect(s).toMatchObject({ phase: 'available', version: '1.2.3', percent: 0 })
  })

  it('progress moves percent without losing the version', () => {
    let s = reduceUpdate(initialUpdateState, { type: 'available', version: '1.2.3' })
    s = reduceUpdate(s, { type: 'progress', percent: 41.6, bytesPerSecond: 900 })
    expect(s).toMatchObject({ phase: 'downloading', version: '1.2.3', percent: 41.6, bytesPerSecond: 900 })
  })

  it('clamps a percent the updater exaggerates', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'progress', percent: 140, bytesPerSecond: 0 })
    expect(s.percent).toBe(100)
    expect(reduceUpdate(initialUpdateState, { type: 'progress', percent: -5, bytesPerSecond: 0 }).percent).toBe(0)
  })

  it('a finished download is ready at 100, not downloading at 99', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'downloaded', version: '1.2.3' })
    expect(s).toMatchObject({ phase: 'ready', version: '1.2.3', percent: 100 })
  })

  it('no update means idle, and records that a check happened', () => {
    const s = reduceUpdate({ ...initialUpdateState, phase: 'checking' }, { type: 'none', at })
    expect(s).toMatchObject({ phase: 'idle', lastCheckedAt: at, version: '' })
  })

  it('an error is kept with the time it happened', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'error', message: 'net down', at })
    expect(s).toMatchObject({ phase: 'error', error: 'net down', lastCheckedAt: at })
  })

  it('the next success clears the last error — a stale error reads as a live one', () => {
    const bad = reduceUpdate(initialUpdateState, { type: 'error', message: 'net down', at })
    expect(reduceUpdate(bad, { type: 'none', at: at + 1 }).error).toBe('')
    expect(reduceUpdate(bad, { type: 'available', version: '2.0.0' }).error).toBe('')
  })

  it('a ready update survives a later failed check: it is still installable', () => {
    const ready: UpdateState = reduceUpdate(initialUpdateState, { type: 'downloaded', version: '1.2.3' })
    const after = reduceUpdate(ready, { type: 'error', message: 'net down', at })
    expect(after).toMatchObject({ phase: 'ready', version: '1.2.3', error: 'net down' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run desktop/src/__tests__/updateState.test.ts`
Expected: FAIL — `Failed to resolve import "../updateState"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * What the app knows about updating, as one value.
 *
 * This used to be spread across a launch flow and a running handler that each
 * registered their own listeners for the same events, and disagreed about who
 * owned `update-downloaded`. The launch flow detached itself after eight
 * seconds and the install was dropped on the floor — silently, for a week.
 * One state, built here, is the fix for that class of bug.
 *
 * Pure on purpose: electron-updater's events go in, a value comes out, and
 * the whole machine is testable without Electron.
 */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The version being offered or downloaded; '' when there is none. */
  version: string
  /** 0–100. */
  percent: number
  bytesPerSecond: number
  /** Epoch ms of the last completed check, successful or not. 0 = never. */
  lastCheckedAt: number
  /** From the last failure; cleared by the next success. */
  error: string
}

export const initialUpdateState: UpdateState = {
  phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '',
}

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number; bytesPerSecond: number }
  | { type: 'downloaded'; version: string }
  | { type: 'none'; at: number }
  | { type: 'error'; message: string; at: number }

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)

export const reduceUpdate = (s: UpdateState, e: UpdateEvent): UpdateState => {
  switch (e.type) {
    case 'check':
      return { ...s, phase: 'checking' }
    case 'available':
      return { ...s, phase: 'available', version: e.version, percent: 0, bytesPerSecond: 0, error: '' }
    case 'progress':
      return { ...s, phase: 'downloading', percent: clamp(e.percent), bytesPerSecond: e.bytesPerSecond, error: '' }
    case 'downloaded':
      return { ...s, phase: 'ready', version: e.version, percent: 100, bytesPerSecond: 0, error: '' }
    case 'none':
      return { ...s, phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: e.at, error: '' }
    case 'error':
      // A downloaded update stays installable. Losing the network after the
      // file is on disk must not take away the Restart button.
      return s.phase === 'ready'
        ? { ...s, lastCheckedAt: e.at, error: e.message }
        : { ...s, phase: 'error', lastCheckedAt: e.at, error: e.message }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run desktop/src/__tests__/updateState.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/updateState.ts desktop/src/__tests__/updateState.test.ts
git commit -m "feat(updates): the update phase as one value

It was spread across a launch flow and a running handler that each
listened for the same events and disagreed about who owned
update-downloaded. One state, and a pure reducer so the machine is
testable without Electron.

A ready update survives a later failed check: once the file is on disk,
losing the network must not take away the Restart button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The updater owns that state, and stops blocking launch

**Files:**
- Rewrite: `desktop/src/updates.ts`
- Modify: `desktop/src/main.ts:262` and `desktop/src/main.ts:294`

**Interfaces:**
- Consumes: `reduceUpdate`, `initialUpdateState`, `UpdateState`, `UpdateEvent` (Task 1).
- Produces: `startUpdates(getPage: () => WebContents | null): void`, `currentUpdateState(): UpdateState`, `checkForUpdatesNow(): void`, `installUpdateNow(): void`. The launch export `updateAtLaunch` is **removed**.

**Context you need:** `main.ts:262` currently does `await updateAtLaunch(...)` before opening the window, and `main.ts:294` calls `startUpdates(() => shellWin?.win ?? null)`. The splash's `status`/`onSkip` plumbing for updates becomes unused; leave the splash itself alone — it still reports other launch phases.

- [ ] **Step 1: Replace `desktop/src/updates.ts` entirely**

```ts
/**
 * Updates, from the public releases repo.
 *
 * The app never waits for one. A check runs at launch and every six hours,
 * the download runs in the background, and nothing restarts until a person
 * asks. The previous design gave the launch check eight seconds and then
 * detached its own listeners: the download carried on into the cache and the
 * install was dropped, every launch, with no way to see it. The owner ran a
 * version from eight days earlier while two releases shipped.
 *
 * Differential downloads are NOT implemented here and must not be: NsisUpdater
 * already tries `differentialDownloadInstaller()` first and only falls back to
 * a full download, and every release publishes a .exe.blockmap. It diffs
 * against the previous installer in the updater cache, which is why nothing
 * here ever deletes that file.
 *
 * Only a packaged app updates: `electron .` has nothing to replace.
 */
import { app, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { initialUpdateState, reduceUpdate, type UpdateEvent, type UpdateState } from './updateState'

const SIX_HOURS = 6 * 60 * 60 * 1000

let state: UpdateState = initialUpdateState
let getPage: () => WebContents | null = () => null

export const currentUpdateState = (): UpdateState => state

const apply = (e: UpdateEvent): void => {
  const next = reduceUpdate(state, e)
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  try { getPage()?.send('desktop:updateState', state) } catch { /* the page may be gone */ }
}

export const checkForUpdatesNow = (): void => {
  if (!app.isPackaged) return
  apply({ type: 'check' })
  autoUpdater.checkForUpdates().catch(err => apply({ type: 'error', message: String(err?.message ?? err), at: Date.now() }))
}

/** Only ever called because someone pressed a button. */
export const installUpdateNow = (): void => {
  if (state.phase !== 'ready') return
  autoUpdater.quitAndInstall()
}

export const startUpdates = (page: () => WebContents | null): void => {
  getPage = page
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // A backstop only. The Restart button is the route people are meant to use.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', info => apply({ type: 'available', version: info.version }))
  autoUpdater.on('download-progress', p => apply({ type: 'progress', percent: p.percent, bytesPerSecond: p.bytesPerSecond }))
  autoUpdater.on('update-downloaded', info => apply({ type: 'downloaded', version: info.version }))
  autoUpdater.on('update-not-available', () => apply({ type: 'none', at: Date.now() }))
  autoUpdater.on('error', err => apply({ type: 'error', message: String(err?.message ?? err), at: Date.now() }))

  checkForUpdatesNow()
  setInterval(checkForUpdatesNow, SIX_HOURS)
}
```

- [ ] **Step 2: Stop awaiting the launch gate in `desktop/src/main.ts`**

Delete the `updateAtLaunch` import at line 20, leaving `import { startUpdates } from './updates'`. Then replace line 262:

```ts
  await updateAtLaunch(s => splash.status(s), cb => splash.onSkip(cb))
```

with nothing — delete the line. The window opens immediately; the check happens in `startUpdates` below.

- [ ] **Step 3: Pass the page, not the window, at line 294**

```ts
  startUpdates(() => shellWin?.page() ?? null)
```

If `shellWin` has no `page()` accessor, use the same expression `displayMedia.ts` uses to reach the instance's `WebContents` and pass that.

- [ ] **Step 4: Typecheck**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json`
Expected: clean. If `UpdateStatus` is now unreferenced anywhere, delete it and the splash's update-status branch with it.

- [ ] **Step 5: Confirm the app still launches and no longer waits**

Run: `cd desktop && npx tsc && ./node_modules/.bin/electron . --user-data-dir=.probe/profile-launch`
Expected: the window appears without a pause on the splash. Close it.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/updates.ts desktop/src/main.ts
git commit -m "fix(updates): the app stops abandoning its own download

updateAtLaunch gave the check eight seconds, then detached every
listener and booted. A 111MB installer never finishes in eight seconds,
so it downloaded into the cache and the install was dropped — every
launch, silently. An installer from 21 September was still sitting there
unapplied with two releases published since.

The gate is deleted rather than lengthened. The app never waits, the
download runs in the background, and nothing restarts until someone
presses a button.

Differential downloads are untouched: they already work and simply never
got to finish.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: What the app knows about itself

**Files:**
- Create: `desktop/src/about.ts`
- Test: `desktop/src/__tests__/about.test.ts`

**Interfaces:**
- Consumes: `CaptureAddon` from `./shareAudio`.
- Produces: `aboutFacts(deps): AboutFacts` and the `AboutFacts` type.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { aboutFacts } from '../about'

const deps = {
  appVersion: '0.20.1',
  versions: { electron: '44.4.3', chrome: '130.0.1', node: '22.9.0' },
  platform: 'win32',
  osVersion: '10.0.28000',
  addon: { supported: () => true, loaded: true },
}

describe('aboutFacts', () => {
  it('reports the versions a bug report needs', () => {
    expect(aboutFacts(deps)).toMatchObject({
      app: '0.20.1', electron: '44.4.3', chromium: '130.0.1', node: '22.9.0',
      platform: 'win32', osVersion: '10.0.28000',
    })
  })

  it('separates "the addon loaded" from "it can work here"', () => {
    expect(aboutFacts(deps)).toMatchObject({ addonLoaded: true, perAppAudio: true })
    expect(aboutFacts({ ...deps, addon: { supported: () => false, loaded: true } }))
      .toMatchObject({ addonLoaded: true, perAppAudio: false })
  })

  it('says so when the addon never loaded, rather than throwing', () => {
    expect(aboutFacts({ ...deps, addon: { supported: () => { throw new Error('boom') }, loaded: false } }))
      .toMatchObject({ addonLoaded: false, perAppAudio: false })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run desktop/src/__tests__/about.test.ts`
Expected: FAIL — cannot resolve `../about`.

- [ ] **Step 3: Write `desktop/src/about.ts`**

```ts
/**
 * The facts a bug report needs, and nobody could see.
 *
 * The exe's own metadata reads 0.20.0.0 for every release candidate, and the
 * app version was never exposed to the page at all — so "which build are you
 * on?" had no answer, and a feature was tested three times on a build that did
 * not contain it.
 *
 * `addonLoaded` and `perAppAudio` are deliberately separate. The share
 * picker greys its audio toggle when the second is false, and the two failure
 * modes behind that — the module never loaded, versus it loaded and reported
 * the OS cannot do it — need different fixes.
 */
export interface AboutFacts {
  app: string
  electron: string
  chromium: string
  node: string
  platform: string
  osVersion: string
  addonLoaded: boolean
  perAppAudio: boolean
}

export interface AboutDeps {
  appVersion: string
  versions: { electron: string; chrome: string; node: string }
  platform: string
  osVersion: string
  addon: { supported: () => boolean; loaded: boolean }
}

export const aboutFacts = (d: AboutDeps): AboutFacts => {
  let perAppAudio = false
  try { perAppAudio = d.addon.loaded && d.addon.supported() === true } catch { perAppAudio = false }
  return {
    app: d.appVersion,
    electron: d.versions.electron,
    chromium: d.versions.chrome,
    node: d.versions.node,
    platform: d.platform,
    osVersion: d.osVersion,
    addonLoaded: d.addon.loaded,
    perAppAudio,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run desktop/src/__tests__/about.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/about.ts desktop/src/__tests__/about.test.ts
git commit -m "feat(about): the facts a bug report needs

The exe metadata reads 0.20.0.0 for every release candidate and the app
version never reached the page, so 'which build are you on' had no
answer and a feature was tested three times on a build without it.

addonLoaded and perAppAudio stay separate: the picker greys its audio
toggle on the second, and 'never loaded' and 'loaded but unsupported'
need different fixes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The bridge

**Files:**
- Modify: `desktop/src/preload.ts`, `desktop/src/main.ts` (IPC handlers), `src/composables/desktopBridge.ts`

**Interfaces:**
- Consumes: `currentUpdateState`, `checkForUpdatesNow`, `installUpdateNow` (Task 2); `aboutFacts` (Task 3).
- Produces: on `window.skycordDesktop` — `updates: { state(), onChange(cb), check(), install() }` and `about(): Promise<AboutFacts>`.

- [ ] **Step 1: Add the IPC handlers in `desktop/src/main.ts`**

Beside the other `ipcMain` registrations, and guarded the same way (`event.sender !== getPage()` is refused, matching `desktop:pickShare`):

```ts
  ipcMain.handle('desktop:updateState', () => currentUpdateState())
  ipcMain.on('desktop:updateCheck', () => checkForUpdatesNow())
  ipcMain.on('desktop:updateInstall', () => installUpdateNow())
  ipcMain.handle('desktop:about', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let addon = { supported: () => false, loaded: false }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const a = require('../native') as { supported: () => boolean }
      addon = { supported: () => a.supported(), loaded: true }
    } catch { /* stays not-loaded, which is a fact worth reporting */ }
    return aboutFacts({
      appVersion: app.getVersion(),
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      platform: process.platform,
      osVersion: require('os').release(),
      addon,
    })
  })
```

Import `currentUpdateState, checkForUpdatesNow, installUpdateNow` from `./updates` and `aboutFacts` from `./about`.

- [ ] **Step 2: Expose them in `desktop/src/preload.ts`**

Inside the instance-page branch, beside `pickShare`:

```ts
    updates: {
      state: () => ipcRenderer.invoke('desktop:updateState'),
      onChange: (cb: (s: unknown) => void) => {
        const h = (_e: unknown, s: unknown) => cb(s)
        ipcRenderer.on('desktop:updateState', h)
        return () => ipcRenderer.off('desktop:updateState', h)
      },
      check: () => ipcRenderer.send('desktop:updateCheck'),
      install: () => ipcRenderer.send('desktop:updateInstall'),
    },
    about: () => ipcRenderer.invoke('desktop:about'),
```

- [ ] **Step 3: Type them in `src/composables/desktopBridge.ts`**

Add to the file, and to the `DesktopBridge` interface:

```ts
/** Mirrors desktop/src/updateState.ts. Duplicated because the renderer cannot
 *  import from desktop/ — same reason DesktopShareChoice is duplicated. */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
export interface UpdateState {
  phase: UpdatePhase
  version: string
  percent: number
  bytesPerSecond: number
  lastCheckedAt: number
  error: string
}
export interface AboutFacts {
  app: string; electron: string; chromium: string; node: string
  platform: string; osVersion: string; addonLoaded: boolean; perAppAudio: boolean
}
```

```ts
  /** Update state and control. Absent in app builds before this. */
  updates?: {
    state(): Promise<UpdateState>
    onChange(cb: (s: UpdateState) => void): () => void
    check(): void
    install(): void
  }
  /** Versions and capability facts. Absent in app builds before this. */
  about?(): Promise<AboutFacts>
```

- [ ] **Step 4: Typecheck both projects**

Run: `npm run typecheck && cd desktop && npx tsc --noEmit -p tsconfig.json`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/preload.ts desktop/src/main.ts src/composables/desktopBridge.ts
git commit -m "feat(updates): the page can see update state and app versions

Both are new surfaces: the page had no way to read the app version at
all, which is why nobody could tell which build was running.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The debug unlock

**Files:**
- Create: `src/composables/debugUnlock.ts`
- Test: `src/composables/__tests__/debugUnlock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TAP_WINDOW_MS`, `TAPS_NEEDED`, `createTapCounter(now: () => number)`, `debugUnlocked` (a `ref<boolean>`), `setDebugUnlocked(on: boolean)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTapCounter, TAPS_NEEDED, TAP_WINDOW_MS } from '../debugUnlock'

describe('createTapCounter', () => {
  let t = 0
  const counter = () => createTapCounter(() => t)
  beforeEach(() => { t = 0 })

  it('does not fire before the seventh tap', () => {
    const c = counter()
    for (let i = 1; i < TAPS_NEEDED; i++) { t += 100; expect(c.tap()).toBe(false) }
  })

  it('fires on exactly the seventh', () => {
    const c = counter()
    let fired = false
    for (let i = 0; i < TAPS_NEEDED; i++) { t += 100; fired = c.tap() }
    expect(fired).toBe(true)
  })

  it('a pause resets the run, so it is not reachable by accident', () => {
    const c = counter()
    for (let i = 0; i < 5; i++) { t += 100; c.tap() }
    t += TAP_WINDOW_MS + 1
    expect(c.tap()).toBe(false)          // this one starts a new run
    for (let i = 0; i < TAPS_NEEDED - 2; i++) { t += 100; expect(c.tap()).toBe(false) }
    t += 100
    expect(c.tap()).toBe(true)
  })

  it('starts counting again after it fires, so seven more toggles back', () => {
    const c = counter()
    for (let i = 0; i < TAPS_NEEDED; i++) { t += 100; c.tap() }
    for (let i = 0; i < TAPS_NEEDED - 1; i++) { t += 100; expect(c.tap()).toBe(false) }
    t += 100
    expect(c.tap()).toBe(true)
  })

  it('a tap exactly on the window boundary still counts', () => {
    const c = counter()
    t += 100; c.tap()
    t += TAP_WINDOW_MS
    expect(c.tap()).toBe(false)          // counted, not reset — only 2 of 7
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/debugUnlock.test.ts`
Expected: FAIL — cannot resolve `../debugUnlock`.

- [ ] **Step 3: Write `src/composables/debugUnlock.ts`**

```ts
/**
 * The debug page, and the seven taps that reveal it.
 *
 * Device-local on purpose. Everything the page reports — app version, whether
 * the capture addon loaded, whether the worklet fetched — is a fact about the
 * machine it is running on, so following the account to another device would
 * show facts belonging somewhere else.
 *
 * Seven taps, each within three seconds of the last. The window is what keeps
 * it out of reach by accident: an icon can be double-clicked, but not seven
 * times in a row by mistake.
 */
import { ref } from 'vue'

export const TAPS_NEEDED = 7
export const TAP_WINDOW_MS = 3000
const KEY = 'sykord_debug'

const read = (): boolean => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** Reactive so the settings sidebar can show and hide the entry live. */
export const debugUnlocked = ref(read())

export const setDebugUnlocked = (on: boolean): void => {
  debugUnlocked.value = on
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch { /* private window */ }
}

export interface TapCounter { tap(): boolean }

/** `now` is injected so the window can be tested without waiting for it. */
export const createTapCounter = (now: () => number = () => Date.now()): TapCounter => {
  let count = 0
  let last = -Infinity
  return {
    tap() {
      const t = now()
      count = t - last > TAP_WINDOW_MS ? 1 : count + 1
      last = t
      if (count < TAPS_NEEDED) return false
      count = 0
      return true
    },
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/composables/__tests__/debugUnlock.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/composables/debugUnlock.ts src/composables/__tests__/debugUnlock.test.ts
git commit -m "feat(debug): seven taps, and the flag they set

Device-local: everything the debug page reports is a fact about the
machine it runs on, so following the account elsewhere would show facts
from somewhere else.

The three-second window is what keeps it out of reach by accident — an
icon gets double-clicked, not tapped seven times in a row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The renderer's view of the update

**Files:**
- Create: `src/composables/useUpdates.ts`
- Test: `src/composables/__tests__/useUpdates.test.ts`

**Interfaces:**
- Consumes: `desktopBridge()` and the `UpdateState` type (Task 4).
- Produces: `useUpdates()` returning `{ state, supported, check, install, label }`, and the pure `updateLabel(s: UpdateState): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { updateLabel } from '../useUpdates'
import type { UpdateState } from '../desktopBridge'

const base: UpdateState = { phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '' }

describe('updateLabel', () => {
  it('says it is up to date, because silence is what failed before', () => {
    expect(updateLabel({ ...base, phase: 'idle', lastCheckedAt: 1 })).toBe('Skycord is up to date')
  })

  it('says a check is running', () => {
    expect(updateLabel({ ...base, phase: 'checking' })).toBe('Checking for updates…')
  })

  it('names the version it found', () => {
    expect(updateLabel({ ...base, phase: 'available', version: '0.21.0' })).toBe('Skycord 0.21.0 is available')
  })

  it('shows a whole-number percent while downloading', () => {
    expect(updateLabel({ ...base, phase: 'downloading', version: '0.21.0', percent: 41.6 }))
      .toBe('Downloading Skycord 0.21.0 — 42%')
  })

  it('says it is ready and waiting for you', () => {
    expect(updateLabel({ ...base, phase: 'ready', version: '0.21.0' }))
      .toBe('Skycord 0.21.0 is ready to install')
  })

  it('shows the error rather than pretending the check succeeded', () => {
    expect(updateLabel({ ...base, phase: 'error', error: 'net down' }))
      .toBe("Couldn't check for updates — net down")
  })

  it('has never checked: says that, not "up to date"', () => {
    expect(updateLabel({ ...base, phase: 'idle', lastCheckedAt: 0 })).toBe('Not checked yet')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/useUpdates.test.ts`
Expected: FAIL — cannot resolve `../useUpdates`.

- [ ] **Step 3: Write `src/composables/useUpdates.ts`**

```ts
/**
 * The update, as the page sees it.
 *
 * The main process owns the state; this mirrors it and offers the two verbs.
 * `updateLabel` is separate and pure so the wording is tested — the wording is
 * the feature here. An app that failed to update for a week did so while
 * looking exactly like an app that had nothing to do.
 */
import { onUnmounted, ref } from 'vue'
import { desktopBridge, type UpdateState } from './desktopBridge'

const IDLE: UpdateState = { phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '' }

export const updateLabel = (s: UpdateState): string => {
  switch (s.phase) {
    case 'checking': return 'Checking for updates…'
    case 'available': return `Skycord ${s.version} is available`
    case 'downloading': return `Downloading Skycord ${s.version} — ${Math.round(s.percent)}%`
    case 'ready': return `Skycord ${s.version} is ready to install`
    case 'error': return `Couldn't check for updates — ${s.error}`
    case 'idle': return s.lastCheckedAt ? 'Skycord is up to date' : 'Not checked yet'
  }
}

export const useUpdates = () => {
  const bridge = desktopBridge()
  const supported = !!bridge?.updates
  const state = ref<UpdateState>(IDLE)

  if (bridge?.updates) {
    bridge.updates.state().then(s => { state.value = s }).catch(() => {})
    const off = bridge.updates.onChange(s => { state.value = s })
    onUnmounted(off)
  }

  return {
    state,
    supported,
    check: () => bridge?.updates?.check(),
    install: () => bridge?.updates?.install(),
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/composables/__tests__/useUpdates.test.ts && npm run typecheck`
Expected: PASS, 7 tests, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useUpdates.ts src/composables/__tests__/useUpdates.test.ts
git commit -m "feat(updates): the page's view, and the words it uses

updateLabel is pure and tested because the wording is the feature. An
app that failed to update for a week looked exactly like an app with
nothing to do, and 'up to date' has to be something it actually says.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Settings › Updates

**Files:**
- Create: `src/components/settings/UpdatesPage.vue`
- Modify: `src/components/modals/SettingsModal.vue` (import, page list ~line 481, render branch ~line 1330)

**Interfaces:**
- Consumes: `useUpdates`, `updateLabel` (Task 6).
- Produces: the `updates` settings page id.

- [ ] **Step 1: Write `src/components/settings/UpdatesPage.vue`**

```vue
<script setup lang="ts">
/**
 * Settings › Updates — the page that says what is happening.
 *
 * Its most important state is the dull one. "Skycord is up to date", with the
 * time of the last check, is what distinguishes a working updater from one
 * that has quietly given up — a distinction that did not exist here, and cost
 * a week on a version eight days old.
 */
import { computed } from 'vue'
import { useUpdates, updateLabel } from '@/composables/useUpdates'
import '@/styles/settingsShared.css'

const { state, supported, check, install } = useUpdates()
const label = computed(() => updateLabel(state.value))
const busy = computed(() => state.value.phase === 'checking' || state.value.phase === 'downloading')
const lastChecked = computed(() => {
  if (!state.value.lastCheckedAt) return 'never'
  return new Date(state.value.lastCheckedAt).toLocaleString()
})
</script>

<template>
  <div v-if="!supported" class="st-card">
    <p class="st-hint">Updates are handled by the Skycord app. In a browser, reloading the page is all it takes.</p>
  </div>

  <template v-else>
    <div class="st-card">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">{{ label }}</span>
          <span class="st-field-value">Last checked: {{ lastChecked }}</span>
        </div>
        <button
          v-if="state.phase === 'ready'"
          type="button" class="st-btn st-btn-primary" @click="install"
        >Restart to update</button>
        <button v-else type="button" class="st-btn" :disabled="busy" @click="check">
          {{ busy ? 'Working…' : 'Check now' }}
        </button>
      </div>

      <div v-if="state.phase === 'downloading'" class="up-bar" role="progressbar"
           :aria-valuenow="Math.round(state.percent)" aria-valuemin="0" aria-valuemax="100">
        <div class="up-fill" :style="{ width: Math.round(state.percent) + '%' }" />
      </div>
    </div>

    <p class="st-hint">
      Updates download in the background and only install when you press Restart. Nothing interrupts a call.
    </p>
  </template>
</template>

<style scoped>
.up-bar { height: 6px; border-radius: 3px; background: var(--bg-input); overflow: hidden; margin-top: 12px; }
.up-fill { height: 100%; background: var(--accent); transition: width var(--dur-2) var(--ease-out); }
@media (prefers-reduced-motion: reduce) { .up-fill { transition: none; } }
</style>
```

- [ ] **Step 2: Register it in `src/components/modals/SettingsModal.vue`**

Add the import beside the other settings pages:

```ts
import UpdatesPage from '@/components/settings/UpdatesPage.vue'
```

Add to the **App Settings** group, after `performance`:

```ts
      // Only in the app: a browser updates by reloading.
      ...(desktopBridge() ? [{ id: 'updates', label: 'Updates' }] : []),
```

Add the render branch beside the others:

```vue
          <!-- ── Updates (app only) ── -->
          <template v-else-if="page === 'updates'">
            <UpdatesPage />
          </template>
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npx vitest run src`
Expected: clean, all passing.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/UpdatesPage.vue src/components/modals/SettingsModal.vue
git commit -m "feat(updates): a page that says what the updater is doing

Its most important state is the dull one. 'Skycord is up to date', with
the time of the last check, is what separates a working updater from one
that quietly gave up — a distinction this app did not have.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The ready popup

**Files:**
- Modify: `src/views/ChatApp.vue` (or wherever app-level toasts are mounted — grep for the existing toast host)
- Create: `src/composables/updatePrompt.ts`
- Test: `src/composables/__tests__/updatePrompt.test.ts`

**Interfaces:**
- Consumes: `UpdateState` (Task 4).
- Produces: `shouldPrompt(s: UpdateState, seen: string, inCall: boolean): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { shouldPrompt } from '../updatePrompt'
import type { UpdateState } from '../desktopBridge'

const ready = (version: string): UpdateState =>
  ({ phase: 'ready', version, percent: 100, bytesPerSecond: 0, lastCheckedAt: 1, error: '' })

describe('shouldPrompt', () => {
  it('prompts once a download is ready', () => {
    expect(shouldPrompt(ready('1.0.0'), '', false)).toBe(true)
  })

  it('never prompts twice for the same version', () => {
    expect(shouldPrompt(ready('1.0.0'), '1.0.0', false)).toBe(false)
  })

  it('prompts again for a newer one', () => {
    expect(shouldPrompt(ready('1.1.0'), '1.0.0', false)).toBe(true)
  })

  it('stays quiet during a call — a modal over a conversation teaches people to dismiss without reading', () => {
    expect(shouldPrompt(ready('1.0.0'), '', true)).toBe(false)
  })

  it('does not prompt for anything that is not ready', () => {
    for (const phase of ['idle', 'checking', 'available', 'downloading', 'error'] as const) {
      expect(shouldPrompt({ ...ready('1.0.0'), phase }, '', false)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/updatePrompt.test.ts`
Expected: FAIL — cannot resolve `../updatePrompt`.

- [ ] **Step 3: Write `src/composables/updatePrompt.ts`**

```ts
/**
 * When to interrupt someone about an update.
 *
 * Once per version, and never mid-call. A prompt that appears over a
 * conversation is one people learn to dismiss without reading, which would
 * undo the point of having it at all.
 */
import type { UpdateState } from './desktopBridge'

export const shouldPrompt = (s: UpdateState, promptedVersion: string, inCall: boolean): boolean =>
  s.phase === 'ready' && !inCall && s.version !== '' && s.version !== promptedVersion
```

- [ ] **Step 4: Mount the prompt**

Find the app-level toast host: `grep -rn "toast\|Toast" src/views/ChatApp.vue | head`. Add, in that component's setup, a watcher that uses the existing toast/banner mechanism rather than a new one:

```ts
import { watch, ref } from 'vue'
import { useUpdates } from '@/composables/useUpdates'
import { shouldPrompt } from '@/composables/updatePrompt'
import { isConnectedVoiceRoom } from '@/composables/isConnectedVoiceRoom'

const { state, install } = useUpdates()
const prompted = ref('')
watch(state, s => {
  if (!shouldPrompt(s, prompted.value, isConnectedVoiceRoom())) return
  prompted.value = s.version
  // Use the app's existing toast with an action; see how other toasts here are raised.
  showToast({ text: `Skycord ${s.version} is ready.`, action: { label: 'Restart now', run: install } })
})
```

If the existing toast helper takes no action button, add the update line to the Updates page only and raise a plain toast reading `Skycord ${s.version} is ready — open Settings › Updates to restart.` Do not build a new modal system for this.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src && npm run typecheck`
Expected: all passing, clean.

- [ ] **Step 6: Commit**

```bash
git add src/composables/updatePrompt.ts src/composables/__tests__/updatePrompt.test.ts src/views/ChatApp.vue
git commit -m "feat(updates): tell people once, and never mid-call

Once per version, and silent during a call. A prompt that lands over a
conversation is one people learn to dismiss without reading, which would
undo the point of having it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Settings › Debug, and the seven taps

**Files:**
- Create: `src/components/settings/DebugPage.vue`
- Modify: `src/components/settings/AboutInstancePage.vue`, `src/components/modals/SettingsModal.vue`
- Test: `src/composables/__tests__/diagnosticsText.test.ts`
- Create: `src/composables/diagnosticsText.ts`

**Interfaces:**
- Consumes: `debugUnlocked`, `setDebugUnlocked`, `createTapCounter` (Task 5); `useUpdates` (Task 6); `AboutFacts` (Task 4).
- Produces: `diagnosticsText(facts, extra): string` and the `debug` settings page id.

- [ ] **Step 1: Write the failing test for the copy text**

```ts
import { describe, it, expect } from 'vitest'
import { diagnosticsText } from '../diagnosticsText'

const facts = {
  app: '0.20.1', electron: '44.4.3', chromium: '130.0.1', node: '22.9.0',
  platform: 'win32', osVersion: '10.0.28000', addonLoaded: true, perAppAudio: true,
}
const extra = { origin: 'https://app.skycord.xyz', bundle: 'index-ABC123.js', workletLoaded: true, update: 'Skycord is up to date' }

describe('diagnosticsText', () => {
  it('is plain text a person can paste into a chat', () => {
    const t = diagnosticsText(facts, extra)
    expect(t).toContain('Skycord 0.20.1')
    expect(t).toContain('Electron 44.4.3')
    expect(t).toContain('win32 10.0.28000')
    expect(t).toContain('https://app.skycord.xyz')
    expect(t).toContain('index-ABC123.js')
  })

  it('states the two share-audio facts separately', () => {
    const t = diagnosticsText(facts, extra)
    expect(t).toMatch(/addon loaded:\s*yes/i)
    expect(t).toMatch(/per-app audio:\s*yes/i)
    const off = diagnosticsText({ ...facts, addonLoaded: true, perAppAudio: false }, extra)
    expect(off).toMatch(/addon loaded:\s*yes/i)
    expect(off).toMatch(/per-app audio:\s*no/i)
  })

  it('reports the worklet, which is the file that 404d', () => {
    expect(diagnosticsText(facts, { ...extra, workletLoaded: false })).toMatch(/worklet:\s*not loaded/i)
  })

  it('carries no secrets — no tokens, no cookies, no email', () => {
    const t = diagnosticsText(facts, extra).toLowerCase()
    for (const bad of ['token', 'cookie', 'password', '@']) expect(t).not.toContain(bad)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/diagnosticsText.test.ts`
Expected: FAIL — cannot resolve `../diagnosticsText`.

- [ ] **Step 3: Write `src/composables/diagnosticsText.ts`**

```ts
/**
 * The debug page as plain text, for pasting into a conversation.
 *
 * Deliberately free of anything private: no token, no cookie, no address
 * book, no email. Someone pasting this into a chat should not have to read it
 * first to know it is safe.
 */
import type { AboutFacts } from './desktopBridge'

export interface DiagnosticsExtra {
  origin: string
  bundle: string
  workletLoaded: boolean
  update: string
}

const yn = (b: boolean) => (b ? 'yes' : 'no')

export const diagnosticsText = (f: AboutFacts, x: DiagnosticsExtra): string => [
  `Skycord ${f.app}`,
  `Electron ${f.electron} · Chromium ${f.chromium} · Node ${f.node}`,
  `${f.platform} ${f.osVersion}`,
  '',
  `instance: ${x.origin}`,
  `bundle: ${x.bundle}`,
  '',
  `addon loaded: ${yn(f.addonLoaded)}`,
  `per-app audio: ${yn(f.perAppAudio)}`,
  `worklet: ${x.workletLoaded ? 'loaded' : 'not loaded'}`,
  '',
  `updates: ${x.update}`,
].join('\n')
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/composables/__tests__/diagnosticsText.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `src/components/settings/DebugPage.vue`**

```vue
<script setup lang="ts">
/**
 * Settings › Debug — the page that would have saved the week.
 *
 * Every row here is something that was invisible while it was broken: which
 * build is running, whether the capture addon loaded, whether the audio
 * worklet fetched, what the updater last did. None of it is private, so the
 * whole thing copies to the clipboard in one press.
 */
import { computed, onMounted, ref } from 'vue'
import { desktopBridge, type AboutFacts } from '@/composables/desktopBridge'
import { useUpdates, updateLabel } from '@/composables/useUpdates'
import { diagnosticsText } from '@/composables/diagnosticsText'
import { setDebugUnlocked } from '@/composables/debugUnlock'
import '@/styles/settingsShared.css'

const facts = ref<AboutFacts | null>(null)
const workletLoaded = ref(false)
const copied = ref(false)
const { state } = useUpdates()

const origin = location.origin
const bundle = computed(() =>
  [...document.querySelectorAll('script[src]')].map(s => (s as HTMLScriptElement).src)
    .find(u => /assets\/index-/.test(u))?.split('/').pop() ?? 'unknown')

onMounted(async () => {
  facts.value = (await desktopBridge()?.about?.()) ?? null
  // A HEAD is enough: the failure that mattered was a 404, not bad contents.
  try { workletLoaded.value = (await fetch('/share-audio-worklet.js', { method: 'HEAD' })).ok } catch { workletLoaded.value = false }
})

const text = computed(() => facts.value
  ? diagnosticsText(facts.value, { origin, bundle: bundle.value, workletLoaded: workletLoaded.value, update: updateLabel(state.value) })
  : `web client\ninstance: ${origin}\nbundle: ${bundle.value}\nworklet: ${workletLoaded.value ? 'loaded' : 'not loaded'}`)

const copy = async () => {
  try { await navigator.clipboard.writeText(text.value); copied.value = true; setTimeout(() => { copied.value = false }, 1600) } catch { /* denied */ }
}
const reload = () => location.reload()
</script>

<template>
  <div class="st-card">
    <pre class="dbg-text">{{ text }}</pre>
  </div>
  <div class="dbg-row">
    <button type="button" class="st-btn st-btn-primary" @click="copy">{{ copied ? 'Copied' : 'Copy diagnostics' }}</button>
    <button type="button" class="st-btn" @click="reload">Reload client</button>
    <button type="button" class="st-btn" @click="setDebugUnlocked(false)">Hide this page</button>
  </div>
  <p v-if="!facts" class="st-hint">Version and capture rows are desktop only — this is the web client.</p>
</template>

<style scoped>
.dbg-text { margin: 0; white-space: pre-wrap; word-break: break-word; font: 400 12.5px/1.7 var(--font-mono, monospace); color: var(--text-1); }
.dbg-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
</style>
```

- [ ] **Step 6: Wire the seven taps in `src/components/settings/AboutInstancePage.vue`**

Add to the script:

```ts
import { createTapCounter, debugUnlocked, setDebugUnlocked } from '@/composables/debugUnlock'

const taps = createTapCounter()
const onMarkTap = () => { if (taps.tap()) setDebugUnlocked(!debugUnlocked.value) }
```

Put the handler on both branches of the icon so it works whether or not the instance has one:

```vue
      <img
        v-if="profile.icon && !iconFailed"
        class="ai-icon" :src="profile.icon" alt="" @error="iconFailed = true" @click="onMarkTap"
      >
      <div v-else class="ai-icon ai-mark" @click="onMarkTap"><SkycordIcon :size="28" /></div>
```

- [ ] **Step 7: Register the page in `src/components/modals/SettingsModal.vue`**

Import it and `debugUnlocked`:

```ts
import DebugPage from '@/components/settings/DebugPage.vue'
import { debugUnlocked } from '@/composables/debugUnlock'
```

The page list is a plain array today, so make the last group reactive by wrapping the groups in a `computed` if it is not already; add to the final (unlabelled) group:

```ts
      ...(debugUnlocked.value ? [{ id: 'debug', label: 'Debug' }] : []),
```

And the render branch:

```vue
          <!-- ── Debug (seven taps on the icon in About this instance) ── -->
          <template v-else-if="page === 'debug'">
            <DebugPage />
          </template>
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run src desktop && npm run typecheck`
Expected: all passing, clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/DebugPage.vue src/components/settings/AboutInstancePage.vue src/components/modals/SettingsModal.vue src/composables/diagnosticsText.ts src/composables/__tests__/diagnosticsText.test.ts
git commit -m "feat(debug): the page that would have saved the week

Every row is something that was invisible while it was broken: which
build is running, whether the capture addon loaded, whether the audio
worklet fetched, what the updater last did. Each of those cost a day.

Nothing on it is private, so it copies in one press and can be pasted
into a conversation without being read first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Prove it in the packaged app, and write it down

**Files:**
- Create: `desktop/scripts/update-probe.mjs`
- Modify: `docs/RELEASING.md`, `landing/content.js`

- [ ] **Step 1: Write the launch-speed probe**

```js
// The app must not wait for an update check. This measures the thing that
// regressed: time from launch to the instance window existing.
import { createRequire } from 'module'
const { _electron } = createRequire('H:/projects/sykord-wt/desktop/desktop/package.json')('playwright-core')
const t0 = Date.now()
const app = await _electron.launch({ args: ['.', '--user-data-dir=.probe/profile-launchspeed'], cwd: 'H:/projects/sykord-wt/desktop/desktop' })
for (let i = 0; i < 300; i++) {
  if (app.windows().some(w => !w.url().includes('static/'))) break
  await new Promise(r => setTimeout(r, 100))
}
console.log(`first instance window after ${Date.now() - t0}ms`)
await app.close()
```

Run: `cd desktop && node scripts/update-probe.mjs`
Expected: a number, and no eight-second pause. Record it in the commit message.

- [ ] **Step 2: Document the real deploy in `docs/RELEASING.md`**

`RELEASING.md` documents `sudo skycord update`, which is the containerised path and is **not** what skycord.xyz runs. Add a section for the pm2 host, with the step that caused the worklet 404:

```markdown
## Deploying skycord.xyz (the pm2 host)

This instance is a manual install, not a container, so `skycord update` does
not apply.

```bash
cd ~/sykord && git checkout -- package-lock.json && git pull origin main
npm install && npm run build
sudo rsync -a --delete --exclude 'server' ~/sykord/dist/ /var/www/app.skycord.xyz/
sudo rsync -a --delete ~/sykord/landing/ /var/www/skycord.xyz/
pm2 restart sykord-api && pm2 save
sudo nginx -t && sudo systemctl reload nginx
```

**`--exclude 'server'` is not optional.** `dist/` contains the compiled
backend; copying it wholesale once published the full server source publicly.

**Use rsync, not `cp` of named paths.** The old step copied `dist/assets` and
`dist/index.html` by name, so every other file Vite emits at the root — the
audio worklet, `licenses.json` — silently never deployed. `share-audio-worklet.js`
404'd in production for days while the app degraded quietly to "video without
sound".

Verify by content, never by status code:

```bash
curl -sI https://app.skycord.xyz/share-audio-worklet.js | head -1
```
```

- [ ] **Step 3: Add the changelog entry to `landing/content.js`**

At the top of `var RELEASES = [{`, above the newest entry, using the day you ship:

```js
  {
    v: 'v0.20.2', date: '<ship date>', time: '<HH:MM UTC+2>', title: 'The app can tell you what it is',
    items: [
      ['fix', 'The Windows app stopped updating itself. It gave the download eight seconds at launch and then walked away from it, so the installer landed in a cache folder and was never applied — every launch, with nothing on screen to say so. One person ran a version eight days old while two releases shipped past them. The app no longer waits for anything at startup: updates download in the background, and install when you press Restart'],
      ['add', 'Settings › Updates: what version you are on, what the updater is doing, a progress bar while it downloads, and a Restart button when it is ready. It also says when it last checked and when there is nothing to do — an updater that has quietly given up should not look like one with no news'],
      ['add', 'A debug page, for when something is wrong and nobody can see why. Tap the server icon in Settings › About this instance seven times. It shows the app version, whether the screen-share components loaded, and what the updater last did, and copies the lot to your clipboard in one press'],
    ]
  },
```

- [ ] **Step 4: Verify the changelog parses**

```bash
node -e "
const fs=require('fs'), vm=require('vm');
const sandbox={ window:{}, document:{}, console }; sandbox.self=sandbox.window; sandbox.globalThis=sandbox;
vm.createContext(sandbox); vm.runInContext(fs.readFileSync('landing/content.js','utf8'), sandbox);
const r=sandbox.window.SKYCORD_RELEASES;
console.log('releases:', r.length, '| newest:', r[0].v, '| items:', r[0].items.length);
"
```
Expected: one more release than before, newest `v0.20.2`.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/update-probe.mjs docs/RELEASING.md landing/content.js
git commit -m "docs(updates): the real deploy, and what changed

RELEASING.md documented the containerised path only, so the pm2 host's
sequence lived nowhere in the repo — which is how a two-path cp survived
long enough to leave the audio worklet 404ing in production for days.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** One state + no launch gate → Task 2, machine in Task 1. Bridge → Task 4, facts in Task 3. Updates page → Task 7. Popup, once per version, never in a call → Task 8. Debug page, seven taps, localStorage, copy, reload client → Tasks 5 and 9. Delta untouched and cache preserved → stated in Global Constraints and Task 2's header comment. Testing → each task, plus Task 10's launch-speed probe. No gaps.

**Naming.** `UpdatePhase`, `UpdateState`, `initialUpdateState`, `UpdateEvent`, `reduceUpdate`, `currentUpdateState`, `checkForUpdatesNow`, `installUpdateNow`, `aboutFacts`, `AboutFacts`, `createTapCounter`, `TAPS_NEEDED`, `TAP_WINDOW_MS`, `debugUnlocked`, `setDebugUnlocked`, `useUpdates`, `updateLabel`, `shouldPrompt`, `diagnosticsText` — each defined once and used under that name throughout.

**Two things the implementer must check rather than assume.** Task 2 step 3 guesses at `shellWin?.page()`; the accessor may be spelled differently, and the task says to match whatever `displayMedia.ts` already uses. Task 8 step 4 depends on the app's existing toast helper supporting an action button, and says what to do if it does not — do not build a modal system for this.

# Updates you can see, and a debug tab — design

**Goal.** An update that actually installs, a person who can tell what they are
running, and a diagnosis that takes ten seconds instead of a day.

**Platform.** The desktop app. The web client gains a hidden debug page; every
update surface is desktop-only and absent in a browser.

---

## Why this exists

The owner ran rc.2 for a week while rc.3 and rc.4 shipped, tested a feature
three times on a build that did not contain it, and could not tell — the exe
metadata reads `0.20.0.0` for every release candidate, and the app version is
not exposed to the page at all.

Two faults, both invisible:

**The updater abandons its own download.** `updateAtLaunch` gives the check and
download eight seconds (`CHECK_MS = 8_000`), then calls `start()`, which
detaches every listener and boots the app. A 111 MB installer cannot finish in
eight seconds, so it downloads into the cache and is dropped, every launch. The
evidence sat on disk: `%LOCALAPPDATA%\skycord-desktop-updater\installer.exe`,
dated 21 September, never applied, with two releases published since.

**Nothing says so.** No progress, no error, no version, no "an update is
waiting". Failure and success look identical.

### What is already fine, and must not be rebuilt

`NsisUpdater` already tries `differentialDownloadInstaller()` before falling
back to a full download, `disableDifferentialDownload` defaults to `false`, and
every release publishes a `.exe.blockmap`. **Differential updates are built,
enabled, and have probably never completed once** — because the download is
abandoned before it finishes. Fixing the abandonment is what turns delta on in
practice. No new download machinery is written.

The delta diffs against the previous `installer.exe` in the updater cache, so
**that file is never deleted**.

---

## 1. One update state, in the main process

`desktop/src/updates.ts` loses the launch gate entirely — no `CHECK_MS`, no
`skipTimer`, no second handler set. The app boots immediately, always. Today's
two code paths disagreeing about who owns `update-downloaded` is how the bug
hid; there is now one.

```ts
type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  phase: UpdatePhase
  /** The version being offered or downloaded; '' when idle. */
  version: string
  /** 0–100 while downloading. */
  percent: number
  bytesPerSecond: number
  /** Epoch ms of the last completed check, successful or not. */
  lastCheckedAt: number
  /** Human-readable, from the last failure. Cleared by the next success. */
  error: string
}
```

A check runs at launch and every six hours. `autoDownload` stays `true`, so a
found update downloads in the background while the app is used.
`autoInstallOnAppQuit` stays `true` as a backstop, but is no longer the only
route.

**The app never restarts itself.** `quitAndInstall` runs only when a person
asks. An update that reboots the app mid-call is worse than one that waits.

Every state change is pushed to the page. The main process also answers
`check()` and `install()` on demand.

## 2. The bridge

`skycordDesktop.updates` in the preload:

| Call | Does |
|---|---|
| `state(): Promise<UpdateState>` | the current state, for first paint |
| `onChange(cb): () => void` | subscribe; returns an unsubscribe |
| `check(): void` | check now |
| `install(): void` | quit and install what is downloaded |

And `skycordDesktop.about()`, which is what the app has never had:

```ts
{ app: string, electron: string, chromium: string, node: string,
  platform: string, osVersion: string, perAppAudio: boolean, addonLoaded: boolean }
```

`perAppAudio` and `addonLoaded` come from the capture addon — the exact pair
that decides whether the share picker greys out its audio toggle, and the pair
nobody could see when it did.

## 3. Settings › Updates — always visible

A permanent page on desktop, absent in a browser. It shows the running version,
the state in words, a progress bar while downloading, and one button that
changes with the phase: **Check now** → **Downloading 42%** → **Restart to
update**.

It says "Skycord is up to date" when it is. Saying so is the point: this week's
failure was indistinguishable from silence, and an absence of news has to look
different from an absence of checking. It also shows when the last check ran,
and the error if the last one failed.

The sidebar entry carries a dot when `phase` is `available`, `downloading` or
`ready`.

## 4. The popup

When `phase` becomes `ready`, one non-blocking prompt: *"Skycord 0.20.1 is
ready — Restart now / Later"*. Later dismisses it for the session; the tab and
its dot remain. It never appears twice for the same version, and never during
a call — a modal over a conversation is how people learn to dismiss without
reading.

## 5. Settings › Debug — hidden until asked for

Tapping the Skycord icon in **About this instance** seven times unlocks a Debug
page. The unlock is `localStorage` (`sykord_debug`), per device and permanent
until cleared. No server field, no migration: everything the page reports is a
fact about the machine it is running on, so following the account to another
device would show facts belonging to somewhere else.

Taps must land within 3 seconds of each other, and the counter resets
otherwise, so it is not reachable by accident. On the seventh, the page appears
and a toast confirms it. Tapping seven more times hides it again.

What it shows:

| Group | Fields |
|---|---|
| Versions | app, Electron, Chromium, Node, platform, OS build |
| Screen share | addon loaded, `supported()`, worklet loaded |
| Instance | origin, client bundle filename |
| Updates | phase, version, last check, last error |

**Copy diagnostics** puts the lot on the clipboard as plain text, so it can be
pasted into a conversation. **Reload client** force-reloads the page past the
HTTP cache — the stale-client problem that has bitten this app before, and
cheap to offer here rather than build machinery for.

In a browser the page still appears once unlocked, with the desktop-only rows
marked "desktop only" rather than hidden, so the layout does not change shape
between platforms.

---

## What this does not do

- **No new download machinery.** Differential updates already exist; this makes
  them able to finish.
- **No auto-restart**, ever.
- **No server changes.** No new API, no user field, no migration.
- **No web-client version checking.** "Outdated" means the desktop app is
  behind. A stale web client is handled by Reload client, not by its own
  detection.

## Testing

**Unit, no Electron:**

- the phase machine: each updater event maps to one state, and an error clears
  on the next success
- the tap counter: seven within the window unlocks, six does not, a gap resets,
  seven more re-hides
- `about()` shaping, with the addon present and absent

**Driven, against the packaged app:**

- the app boots without waiting for a check — measure time to first window with
  the update feed pointed at a slow endpoint
- a downloaded update reaches `ready` and does not restart on its own
- Debug shows `addonLoaded: true` and `supported(): true` on a machine where
  the addon works

**Owner checks:** that a real update downloads in the background and installs
on Restart, and that the popup does not appear during a call.

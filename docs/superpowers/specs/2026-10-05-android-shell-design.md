# The Android app, slice 1: the shell — design

**Release:** v0.21 (the phone app). This spec is slice 1 of three. Notifications
(slice 2) and the mobile redesign (slice 3) get their own specs after this one;
calls on a locked phone are a later release.

**Context:** `docs/mobile-design-brief.md` (what the app is for, and the product
it wraps); the Windows app in `desktop/`, whose model this follows.

---

## Decisions (owner, 2026-10-05)

| Question | Decision |
|---|---|
| Platforms and distribution | **Android only, as an APK** from a public GitHub releases repo with its own update check — the way the Windows app ships. No store account. Play Store and iOS can come later. |
| How it is built | **A native shell around the shared web UI.** One UI for web, desktop and phone. |
| Notifications (slice 2) | **The app's own connection** to each saved server from an Android background service. No Google push, no relay. |
| v0.21 scope | The shell (this spec), notifications, and the mobile redesign. Calls on a locked phone are deferred. |
| Oldest Android | **8.0 (API 26).** |

**Why not Capacitor.** It was the first idea for "native shell + web UI", and it
is the wrong tool for this app. Capacitor expects the web app bundled inside the
APK; its own documentation calls `allowNavigation` and a remote `server.url`
"not intended for use in production". A bundled client is one fixed version
talking to every self-hosted server, whatever version each one runs. The
Windows app loads each server's own client for exactly this reason, and the
phone does the same: a small Kotlin app around Android's WebView.

---

## 1. How the shell works

### The main screen

One activity, one WebView. It loads the chosen server's own web client — the
same page a phone browser gets, so the phone layout that already exists (the
one-level list/conversation stack, swipe navigation, the call as a persistent
layer) is what people see, at whatever version that server runs. Nothing in the
APK changes when the web app does.

### The bridge: `window.skycordAndroid`

The native side is reached through a bridge object that exists **only on pages
from a saved server**, checked by origin — the rule the desktop's `fromInstance`
applies. Any other page the WebView might show gets nothing.

Mechanism:

- `WebViewCompat.addWebMessageListener` with `allowedOriginRules` set to the
  saved servers' origins receives messages.
- `WebViewCompat.addDocumentStartJavaScript` adds a small shim, for the same
  origins, that defines `window.skycordAndroid` as promise-returning methods over
  that message channel.
- Both are re-registered whenever a server is opened or the launcher is shown.

These two WebView features need Chromium 86 or later. Where the system WebView
is older, the app does not load a server; it shows a screen asking for an update
to "Android System WebView", with a link to it. No silent half-working mode.

The bridge for slice 1:

| Member | Purpose |
|---|---|
| `platform: 'android'` | Feature detection. |
| `changeInstance()` | Back to the launcher to pick or add a server. |
| `openServers()` | The saved-server list (Settings › Servers already calls this on desktop). |
| `colors({ bar, text })` | Status and navigation bar colours follow the theme — the signal the desktop title bar already receives. |
| `onBack(cb)` | The back button, offered to the page first (see §2). |
| `updates` | `state()`, `onChange(cb)`, `check()`, `install()` — the desktop's update shape. |
| `about()` | App version, WebView version, Android version, for Settings › About. |

On the web side, `desktopBridge()` becomes `appBridge()`, which returns the
desktop bridge or the Android one; every existing feature check keeps working,
because each optional member is still checked before use. Desktop-only members
(share picker, title bar, tray) are simply absent on Android.

### The launcher

A page inside the APK for first run and for switching servers. It is built with
Vite into the app's assets and imports the desktop's tested modules directly —
`desktop/src/instanceAddress.ts` (normalise an address, ask `/instance`, refuse
anything that is not Skycord with a readable reason) and `desktop/src/servers.ts`
(the saved list) — so the two apps cannot drift apart. The launcher talks to the
native side through its own small bridge (save, remove, open a server); it is
served from the app's asset origin, which is the only non-server origin given a
bridge.

### What Android does that the web cannot

- **Back button.** See §2.
- **Links to other sites** open in the system browser; the WebView stays on the
  server.
- **Microphone and camera.** Android's runtime permission prompt first, then the
  WebView grant — and only for the current server's origin.
- **Choosing files.** The page's file inputs (a server or profile icon, a music
  upload) open Android's file picker — only for the current server's page.
  Added at the owner's request on 2026-10-05.
- **A server unreachable at launch** gets a native screen (§2).
- **Updates** — see §3.

---

## 2. What people see

### First launch

The launcher offers two things:

- **Skycord** — `app.skycord.xyz`, one tap.
- **Join a server by address** — type it; the app asks the server and shows its
  name, icon and who runs it, with **Open**. Wrong addresses get plain reasons:
  not a Skycord server, cannot be reached, or does not look like an address.

Then the server's own sign-in page, the one the web app already shows, with the
server's legal documents readable before signing in.

### Plain `http://` servers

They can be added — a server on a home network often has no certificate — and
work for chat. Android gives the microphone only to secure pages, so voice does
not work there, and the launcher says so when the address is added rather than
letting a call fail later.

### Switching servers

From Settings › Servers (the page the Windows app uses). Each server keeps its
own sign-in: WebView cookies are per origin, so switching never signs anyone out
of the other one. The app reopens the server used last.

### The back button

Offered to the page first, through `onBack`. The page:

1. closes whatever is open on top — a modal, sheet, menu or the search screen
   (anything that closes on Escape today);
2. otherwise, from a conversation, goes back to the list;
3. otherwise reports it did not use it.

When the page does not use it, the app moves to the background — like other chat
apps — rather than quitting. A page that never answers within 300 ms counts as
not using it, so a hung page cannot trap the back button.

### A server that cannot be reached

At launch: a native screen — "Can't reach *name*" — with **Retry** and **Choose
another server**. After the page has loaded, connection drops are the web app's
own reconnect banner, as today.

### Phone chrome

The status bar and navigation bar take the app's colours through `colors()`,
light or dark icons chosen by the bar colour's luminance.

---

## 3. Building, releasing and testing

### Where it lives

`android/` in the repo: a Gradle project in Kotlin, `minSdk 26`, `targetSdk` the newest stable
API level at build time (35 or later). Application id `xyz.skycord.android`. The launcher is built by Vite
into `android/app/src/main/assets/launcher/` as part of the Gradle build.

### Releases

A tag `android-vX.Y.Z` runs a GitHub Actions workflow that builds the release
APK, signs it, and publishes it to a public releases-only repo
(`xSMDx/skycord-android-releases`), the pattern the Windows app uses, together
with `latest.json`:

```json
{
  "version": "0.21.0",
  "url": "https://github.com/xSMDx/skycord-android-releases/releases/download/android-v0.21.0/skycord-0.21.0.apk",
  "sha256": "<the APK’s SHA-256, 64 hex characters>",
  "notes": "https://skycord.xyz/changelog/"
}
```

The app checks it at launch and from Settings › About. A newer version is
downloaded, its SHA-256 compared with the feed, and handed to Android's package
installer (the `REQUEST_INSTALL_PACKAGES` permission); the person taps Install.
The landing page's Download section gains **Android (APK)**.

### The signing key

Made once; stored as GitHub Actions secrets, with a copy the owner keeps
offline. Losing it means every phone must uninstall and reinstall to receive
updates, because Android only accepts an update signed with the same key. The
release workflow refuses to run without it rather than signing with a new one.

### Building locally

JDK 17 and Android's command-line tools, installed on H: (C: has no free
space), plus an emulator image. A debug build can point at any address; with
`adb reverse tcp:6200 tcp:6200` the emulator reaches the dev server as
`http://localhost:6200`, which Android treats as a secure page, so microphone
and calls can be tested there too. (6200, not a lower port: Windows reserves
TCP 5041–5740 on the dev machine, so the dev server cannot bind there.)

### Tests

- **Kotlin unit tests** for the parts that decide something: which origins get
  the bridge, whether a navigation stays in the WebView or goes to the browser,
  what the back button does given the page's answer (and its silence), and the
  update version comparison.
- **The shared address and server-list modules** keep their existing tests on
  the desktop side.
- **End to end on the emulator**, with Playwright's Android support driving the
  real WebView: first launch, joining by address (good, wrong and unreachable),
  sign-in, switching servers and staying signed in to both, the back button
  through modal → conversation → list → background, an outside link opening in
  the browser, the unreachable-server screen, and the old-WebView screen.

---

## Out of scope for this slice

- **Notifications** — slice 2, its own spec.
- **The mobile redesign** — slice 3, its own spec, with mockups.
- **Calls on a locked phone** (background audio, Android's ongoing-call
  notification, ringing like a phone call) — a later release.
- **iOS and the Play Store.**
- **Downloads.** The web client has nothing to download yet (no message
  attachments); saving files to the phone comes with attachments.
- **Deep links** (opening a channel or an invite from outside the app). The
  web app has no routes yet (`useMobileNav` is a boolean by design); invite
  links opening the app are their own piece of work.

## Risks

- **WebView on Android 8 phones** that never update it. Handled by refusing
  clearly (§1) rather than failing in ways nobody can diagnose.
- **Manufacturers' WebView differences.** Tested on the emulator; the first real
  phones are the owner's. Anything found there is a slice-1 bug, fixed before
  slice 2 starts.

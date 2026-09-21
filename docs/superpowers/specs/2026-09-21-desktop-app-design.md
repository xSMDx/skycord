# Windows desktop app — v0.20.0 design

**Status:** awaiting owner review. Roadmap items 5 and 5a.

## Decisions (owner, 2026-09-21)

| Question | Decision |
|---|---|
| Where the UI comes from | **The server's own web client.** The app is a thin Electron shell. |
| What v0.20.0 contains | **Foundation first:** shell, installer, instance picker, auto-update. Tray and notifications, unfocused push-to-talk, the designed screen-share picker and invite links follow as 0.20.x releases through the updater. |
| Where updates come from | **A public releases-only GitHub repo**, `xSMDx/skycord-desktop-releases`. The source repo stays private. |
| Code signing | **Unsigned for now.** Testers click "More info → Run anyway" once. Signing is a build-step change, added before a wide launch. |

Settled by the roadmap already: Electron, Windows first, one instance per install
(multi-instance is v0.21).

## How it works

```
first launch                 every launch after
┌──────────────────┐         ┌──────────────────────────────┐
│ instance picker  │ ──────▶ │ BrowserWindow loads          │
│ (local page)     │  saved  │ https://<chosen instance>/   │
└──────────────────┘         │ = that server's own client   │
                             └──────────────────────────────┘
```

**1. The instance picker** is a small page bundled in the app, not a web route.
Two choices: **skycord.xyz** (the hosted instance), or **your own server** — an
address field. Entering an address fetches `https://<address>/instance` (the
public, open-CORS profile added in v0.19.x) and shows the server's name, icon
and operator before you continue — you see whose server you are joining. An
address that does not answer as a Skycord instance is refused with a plain
reason. The choice is saved in the app's user data.

**2. The window** then loads the instance's own root URL. The web client already
addresses the API and the socket by relative path (`fetch('/…')`, `io('/')`),
so it works unchanged at whatever origin it is served from — and it is always
the version that server runs. No bundled client, so no version skew.

**3. The bridge.** A preload script exposes `window.skycordDesktop` through
`contextBridge`: the shell's version, the platform, and `changeInstance()`.
The web client feature-detects it. v0.20.0 uses it for exactly one thing: a
**"Switch server"** button in Settings › About this instance, shown only in the
app. Tray, notifications and push-to-talk extend this same bridge in 0.20.x.

**4. Auto-update** with `electron-updater`, GitHub provider pointed at the
releases repo. Checks on launch and every few hours, downloads in the
background, and offers "Restart to update". A GitHub Action builds the NSIS
installer on `windows-latest` from a version tag and publishes it to the
releases repo.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The only
  surface the page gets is the bridge.
- Navigation is pinned to the chosen instance's origin. A link to anywhere else
  opens in the system browser — and only `https:`/`http:` links do.
- Permissions (microphone, camera, notifications) are granted to the chosen
  origin only.
- **Screen share:** Electron refuses `getDisplayMedia` unless the app supplies a
  handler. v0.20.0 ships a minimal chooser — screens and windows from
  `desktopCapturer`, as a plain list — so sharing works on day one. The designed
  picker (roadmap 5.6) replaces it in 0.20.x.

## Self-hosted instances on plain HTTP

A LAN instance at `http://192.168.1.5` loads fine as a page, but the browser
engine only allows microphone and camera on a secure origin, and an `http:`
address is not one. Electron can mark a specific origin as secure, but only
before it starts. So choosing an `http:` instance saves it and relaunches the
app once, with that one origin treated as secure. `https:` instances need
nothing.

## Where the code lives

A `desktop/` folder in the main repo, with its own `package.json` (`electron`,
`electron-builder`, `electron-updater`) and its own tests. The only change in
the web client is the "Switch server" button.

## Out of scope for v0.20.0

Tray and notifications, unfocused push-to-talk, the designed screen-share
picker, invite links opening the app (all 0.20.x), switching between several
instances (v0.21), macOS and Linux builds, code signing.

## Needs the owner outside the code

- Creating the public repo `xSMDx/skycord-desktop-releases`.
- A GitHub token that can publish to it, saved as a secret in the source repo
  (I can't create accounts or tokens).

## Testing

Unit tests for the picker's address handling and the navigation and permission
rules. The shell is checked by running it: pick skycord.xyz, pick a
self-hosted `https` instance, pick an `http` LAN instance (relaunch, then voice
works), join a call, share a screen, receive an update.

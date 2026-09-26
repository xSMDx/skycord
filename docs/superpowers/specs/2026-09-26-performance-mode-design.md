# Performance mode — design

**Date:** 2026-09-26
**Status:** approved, not yet planned
**Goal:** cut what Skycord holds in memory, so the app stays usable on the old
machines this project exists for, and stop it growing over a long evening.

---

## Why

Crew feedback: Skycord uses a lot of memory and little CPU. Measured on the
owner's machine, the packaged app after a normal session:

| Process | Working set | Private |
|---|---|---|
| Renderer (the app) | 123 MB | 60 MB |
| Main | 112 MB | 72 MB |
| GPU | 109 MB | 107 MB |
| Renderer (the title bar alone) | 72 MB | 23 MB |
| Network service | 55 MB | 13 MB |
| **Total** | **471 MB** | **275 MB** |

The private column is what Task Manager shows by default, and matches the
100–300 MB people reported.

The largest in-app cause is retention: `src/composables/useMessages.ts` holds
`dmMessages`, `serverMessages` and `groupMessages` as plain records with no cap
and no eviction, so every channel visited keeps its whole loaded history for the
session. Since v0.19.0 history scrolls back forever, so an evening of scrolling
several channels only ever grows.

**50 MB is not reachable.** An empty Chromium renderer costs 50–80 MB by itself.
The target is a 30–40% cut and no growth.

## Non-goals

- Noise-cancellation models and per-app screen-share audio. Each gets its own
  spec; this one comes first because both of those spend resources and this
  gives us a way to measure them.
- Rewriting the message store. Eviction is added to it, not a replacement.
- Message-list virtualisation. A follow-up only if the harness shows the DOM,
  rather than retained data, is the cost.

---

## The setting

A new **Performance** page under Settings › App Settings, on the web and in the
app, with three levels and an Advanced section holding the individual switches.
Each level names what it costs in plain words rather than promising a number.

| | Full | Balanced | Light |
|---|---|---|---|
| History in memory | every channel visited | last 3 channels, 200 messages each | current channel only, 100 messages |
| GIFs, animated avatars | play | play on tap | play on tap |
| Images | browser default | capped cache | hard cap, dropped when hidden |
| Call tiles | as now | at most 4, 720p incoming | at most 2, 360p, video pauses when the window is hidden |
| Motion | full | reduced | off |
| Caches when hidden | as now | trimmed after 5 min | trimmed after 1 min |
| Title bar (app) | Skycord's | Skycord's | the plain Windows one |
| Graphics card (app, restart) | on | on | off |
| Engine heap (app, restart) | default | default | capped |

**Defaults.** Full, except that a machine with less than 6 GB of memory
(`os.totalmem()` in the app, `navigator.deviceMemory` on the web) is offered
Light once, in a dismissible line on the Performance page and nowhere else. The
app never switches levels by itself.

**Storage.** Per device, like Appearance. The web keeps it in `localStorage`.
The app also keeps it in its own store (`skycord.json`), because the
process-level switches are decided before any page loads; the page pushes the
level to the shell through the existing bridge whenever it changes.

**Restart.** The graphics card, the heap cap and the title bar only change on
restart. The page says which switches are waiting and offers "Restart now"; it
never restarts by itself.

---

## What each switch actually does

### Retention (the biggest win, no visible cost)

Eviction in `useMessages.ts`: a cap on messages per conversation, and a
least-recently-used cap on how many conversations are kept at all. Evicting a
conversation drops its array; re-entering refetches the newest page the way a
first visit does.

Three things must survive eviction, and each needs a test: an unsent draft, the
reading position when you come back, and the unread boundary. Drafts and
positions live outside the message arrays already; the spec's requirement is
that they keep working, not that they move.

### Media

- GIFs and animated avatars render a still frame and play when tapped. KLIPY
  already returns a static preview for every result; animated avatars get one
  frame drawn to a canvas once, swapped for the animation on tap.
- Image cache: `webFrame.clearCache()` in the renderer when the window has been
  hidden for the tier's time. **Not** `session.clearCache()`, which would throw
  away the HTTP cache the app depends on for fast loads.

### Calls

- A cap on tiles rendered at once; the rest become names in a row, not video.
- Incoming quality capped with LiveKit's `setVideoQuality` per remote track;
  `adaptiveStream` and `dynacast` are already on and stay on.
- Video pauses when the window is hidden (`document.visibilityState` in the
  page, window `hide`/`blur` in the shell). Audio never pauses.

### Motion

Reuses the existing reduce-motion path (`data-motion` in `tokens.css`,
`useAppearance.ts`). Balanced turns it on; Light also drops the crossfade
between channels. No new motion system.

### The shell

- **Title bar.** Light uses a standard Windows frame, which removes the second
  renderer entirely — worth 23 MB private and up to 72 MB working set. Full and
  Balanced keep Skycord's own bar, so the guarantee that no server page draws
  the chrome holds wherever the person has not traded it away deliberately.
- **Graphics card.** `app.disableHardwareAcceleration()` before ready, which
  removes the GPU process. Light says plainly that video may get worse.
- **Heap.** `--js-flags=--max-old-space-size=192` before ready, so the engine
  collects sooner instead of holding. 192 MB is the starting value: the harness
  walks it down until a long session starts collecting hard enough to be felt,
  and the spec's number is whatever survives that.
- **Chromium's low-end device mode** is tried and kept only if the harness says
  it earns its place.

---

## Architecture

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/composables/usePerformance.ts` | the level, the resolved switch values, persistence, the suggestion rule | storage only |
| `src/composables/useMessages.ts` (changed) | eviction: per-conversation cap, LRU across conversations | `usePerformance` |
| `src/composables/mediaPolicy.ts` | whether a GIF or animated avatar plays, and the image cache rule | `usePerformance` |
| call layer (`useVoice`, `voiceRoom`) | tile cap, incoming quality, pause on hidden | `usePerformance` |
| `src/components/settings/PerformancePage.vue` | the three levels, Advanced, the memory readout, the restart prompt | `usePerformance` |
| `desktop/src/perf.ts` | reads the stored level before ready; applies the graphics card, the heap, the window mode; trims caches on hide | the app's store |
| bridge (`desktopBridge.ts`, `preload.ts`) | page → shell when the level changes; shell → page for the real memory figures | — |

Everything reads one resolved object, so a switch is added in one place and
consumed by name. The page never asks "which level is this?"; it asks "may this
GIF play?".

## The harness, built first

`desktop/scripts/memory-probe.mjs`, Playwright driving the packaged app:

1. Launch with a scratch user-data directory, pointed at the local dev stack
   (`desk-api` and `desk-web`), never at a live server.
2. Sign in as the seeded test account, whose address and password the harness
   reads from a local, git-ignored `desktop/scripts/.probe.env` that the owner
   writes once. No credentials in the repo, in the script, or in chat.
3. Open six channels and scroll each back five pages.
4. Join a call with a fake media stream, stay two minutes, leave.
5. Idle, hidden, for twenty minutes.

It samples every process every ten seconds through `app.getAppMetrics()` and
writes a CSV plus a summary table, and runs at Full and at Light. It is a script
run by hand, not CI: it needs a display and a server.

## What "done" means

- **Light:** 170 MB private or less after the scripted session, and no growth
  beyond ±10% over an idle hour.
- **Balanced:** 220 MB private or less, with nothing visibly different in a call
  except the tile cap.
- **Full:** no regression against today's 275 MB.
- Any switch worth less than about 5 MB does not ship. The harness decides.

## What the page shows

The real figure, not a claim: in the app, the total across processes from
`app.getAppMetrics()`, refreshed while the page is open, and what the last
change saved on this machine. On the web only the JavaScript heap is knowable,
so the page says that is what it is showing.

## Risks

| Risk | Answer |
|---|---|
| Low-end device mode and heap caps can cost more than they save | Each is measured and dropped if it does |
| Eviction loses a draft or your place | Tests for both; eviction never touches the current conversation |
| Turning off the graphics card makes video worse | Only in Light, stated before choosing |
| A level silently changes behaviour people report as a bug | The page names every trade in words, and the readout shows what it bought |

## Testing

- **Unit:** the eviction policy (caps, LRU, current conversation never evicted),
  level → switches resolution, the migration for people who already have
  Appearance settings, and the suggestion rule.
- **Numbers:** the harness, at Full and Light, before and after.
- **By hand:** a real call on a low-memory machine at each level, and the
  restart path for the three switches that need one.

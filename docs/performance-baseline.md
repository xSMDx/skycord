# Performance baseline

Every number here was measured by `desktop/scripts/memory-probe.mjs`, which
launches the packaged shell against the local dev stack, signs in, opens the
channels it finds, scrolls each back five pages, joins a voice channel, and then
idles hidden for twenty minutes, sampling every process every ten seconds.

Run it with the dev stack up:

```bash
node desktop/scripts/memory-probe.mjs --label <name>
```

It writes `desktop/.probe/<name>.csv` (one row per sample: phase, totals, and
the per-process split) and prints a summary line. It refuses any origin that is
not localhost.

**Private is the number to watch.** It is what Task Manager shows by default,
and what the crew reported as 100–300 MB.

---

## Runs

| Date | Label | Commit | Client | Private | Working set |
|---|---|---|---|---|---|
| 2026-09-27 | `baseline` | `3c115e5` | dev server (Vite, unminified) | **401 MB** | 797 MB |

### 2026-09-27 · `baseline`

The scripted session, phase by phase:

| Phase | Private | Working set |
|---|---|---|
| Loaded | 182 MB | 413 MB |
| Signed in | 370 MB | 627 MB |
| Channels scrolled | 360–378 MB | 645 MB |
| In a call, everything open | 485 MB | 827 MB |
| After 20 minutes idle | **401 MB** | 797 MB |

Per process at the last sample (working set): browser 125, utility 127, and
renderers at 58, 82, 184, 94, 127.

Two things this run already says:

- **It does not shrink back.** Leaving the call and idling for twenty minutes
  gave back 84 MB of the 485 MB peak and settled 31 MB above the pre-call level.
  Nothing is released for conversations nobody is reading, which is what the
  eviction work addresses.
- **A call is the expensive moment**, worth 107 MB private over the
  channels-open state, before any of it is given back.

---

## A caveat that changes the targets

This run measured the **dev-server client**: unminified, source-mapped, with
Vite's HMR client attached. The owner's own installed app measured **275 MB
private / 471 MB working set** on the same machine, and that is the production
build.

So the spec's targets — Light at 170 MB private, Balanced at 220 — belong to a
production-build measurement, not to this one. Comparing a dev-build Light
against a production-build baseline would flatter the result.

**Task 8 therefore measures against a production build**, served by the API
process itself through `CLIENT_DIR` (the same mechanism the Windows app's new
port uses), with the harness pointed at the API's own origin. This run stays
here as the dev-build reference and as proof the harness works end to end.

---

## 2026-09-27 · the three levels, production build

Served by the API process from a built client (`CLIENT_DIR`), so these are the
production bundle, not the dev server. Same scripted session each time, cold
profile, twenty-minute idle.

| Level | Private | Working set | Processes |
|---|---|---|---|
| Full (dev-server run, for reference) | 401 MB | 797 MB | 7 |
| Full (production build) | *this run failed, exit 1 — re-run later at 398 MB* | — | — |
| Balanced | 396 MB | 1060 MB | 7 |
| **Light** | **236 MB** | 631 MB | 6 |

An earlier production Full run, before the harness was fixed, measured **399 MB
private / 800 MB working set**. Taking that as Full, Light saves **41%**, and
Balanced saves **almost nothing**.

**Since confirmed.** That 399 MB was a fallback from a run that failed, which
is a weak thing to rest a headline on. Two later production Full runs completed
and agree with it: **398 MB** (`prod2-max`, three channels) and **394 MB**
(`many-max`, twelve channels). The 41% stands on completed measurements now,
not on the pre-fix number.

### What this does and does not show

- **Light's saving is real and it is mostly the process-level switches.** Six
  processes against seven: the title-bar renderer is gone, and the heap ceiling
  holds the rest down. That is the tier that needs a restart.
- **Balanced is nearly free and nearly useless in this session.** 396 against
  399 MB. Every switch in it is an in-page trim, and this workload barely
  exercises them.
- **The workload is the problem, not necessarily the switches.** The test
  account's server has three channels, so eviction — the change aimed squarely
  at the growth the crew reported — has almost nothing to evict. A session that
  opens a dozen conversations and scrolls each back is what would show it. Until
  that runs, eviction is unproven, and nothing in the UI should claim it.
- **Neither target in the spec is met yet**: Light at 236 MB against 170, and
  Balanced at 396 against 220. The spec's targets were derived from a 275 MB
  idle baseline of the owner's own app; this scripted session, which joins a
  call, sits far above that on every level. Comparing the two directly is the
  mistake to avoid — the honest comparison is Light against Full in the same
  session, which is the 41%.

### Still owed before any switch is called earned

- ~~A Full run on the production build that completes~~ — done: `prod2-max`
  at 398 MB and `many-max` at 394 MB.
- ~~A session with a dozen conversations, to give eviction something to do~~ —
  done, and it showed eviction does not pay at this size. See below.
- ~~`disableHardwareAcceleration` measured on its own~~ — answered below: it is
  worth 135 MB, most of Light.

---

## 2026-09-27 · does eviction pay? No, not at this size

The earlier runs could not answer this: the probe account's server had three
channels, so there was nothing to evict. It now has a bench server of **12
channels with 120 messages each — 1,390 messages seeded** — and the scripted
session opens every one of them and scrolls each back five pages, which loads
essentially all of that history into memory at once.

| Session | Max | Light |
|---|---|---|
| 3 channels | 398 MB | 233 MB |
| **12 channels, 1,390 messages** | **394 MB** | **232 MB** |

**Holding a dozen conversations costs nothing measurable.** Max with twelve
channels open came in 4 MB *below* Max with three — inside the run-to-run
noise. Light's saving is the same 41% it was, and it is still the process-level
switches doing all of it.

### What that means for the eviction work

- **It does not save memory, and the plan's own rule says a switch worth under
  5 MB does not ship.** A message is a small JavaScript object; 1,390 of them
  are a rounding error beside a Chromium renderer. Nothing in the UI may claim
  that dropping conversations saves anything, because on this evidence it does
  not.
- **The code stays anyway, and unclaimed.** Before it, `useMessages` grew
  without any bound at all — every conversation ever opened, every page ever
  scrolled back, held until reload. An unbounded structure is a correctness
  problem whatever today's number says, and the cap is small, tested, and off
  entirely at Max.
- **The crew's report is still unexplained.** "It grows over hours" is real and
  it is not the message store. The next suspects are decoded images and GIFs,
  video, and Chromium's own baseline — the things Light's process switches
  happen to cut.

### What would actually settle it

1,390 messages is not a long-lived server. Months of real use is tens of
thousands, and the API's write limit of 120 a minute makes seeding that through
it impossible — an honest test means writing messages straight into MongoDB and
re-running this pair. Until someone does that, eviction is a bound, not a
saving.

---

## 2026-09-27 · the graphics card, priced on its own

The one switch left unaccounted for. `disableHardwareAcceleration` does not
remove the GPU process — it puts it in software mode — so how much of Light's
saving it actually buys was unknown. Measured as a matched pair: Light in every
respect, differing only in that switch, same scripted session, cold profile,
five-minute idle each.

| Light, graphics card | Private | Working set |
|---|---|---|
| **off** (software) | **217 MB** | 825 MB |
| on | 352 MB | 888 MB |

**135 MB private.** Where it sits, at the last sample:

| Process | Card off | Card on |
|---|---|---|
| GPU | 19 MB | **111 MB** |
| Utility (the third one, appears with the call) | 14 MB | **60 MB** |
| Renderer | 83 MB | 78 MB |
| Browser | 77 MB | 78 MB |

So it is the graphics stack and nothing else: 92 MB in the GPU process, 46 MB
in the utility that comes up with the call, and the renderer and browser
unchanged within noise.

### What that settles

- **The switch earns its place in Light many times over.** Light saves about
  162 MB over Max; 135 MB of that is this one line. Every other switch in Light
  — the title bar, the heap ceiling, the tile caps, eviction — shares the
  remaining 27 MB between them.
- **It is the honest headline for Light.** The page now says so rather than
  letting the tier's saving read as the sum of its in-page trims, which it is
  not.
- **Working set moves much less than private** — 63 MB against 135 MB — because
  a hardware GPU process's private bytes include driver allocations that never
  showed in its working set. Task Manager's default column is working set, so a
  user watching that will see roughly half the improvement this table reports.
  Private is still the right number to compare levels by; it is just not the
  number on their screen.
- **It is a trade, not a free win.** The drawing moves to the processor. This
  harness measures memory and says nothing about the CPU cost, which on an old
  machine is exactly the thing the user was trying to protect. Anyone who
  revisits this tier should measure frame times before widening the switch's
  reach.

### The earlier attempt, and why the idle is five minutes here

A first `light-gpu` run with the full twenty-minute idle died during the
scrolling phase and produced nothing. The `died` guard only covers `idle()`, so
the run hung rather than failing. Rather than extend the guard and spend another
fifty minutes, the pair above was re-run with a five-minute idle on **both**
sides — the comparison only needs the two to match, and these numbers are not
comparable with the twenty-minute runs above.

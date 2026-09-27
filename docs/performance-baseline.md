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
| Full (production build) | *run failed, exit 1* | — | — |
| Balanced | 396 MB | 1060 MB | 7 |
| **Light** | **236 MB** | 631 MB | 6 |

An earlier production Full run, before the harness was fixed, measured **399 MB
private / 800 MB working set**. Taking that as Full, Light saves **41%**, and
Balanced saves **almost nothing**.

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

- A Full run on the production build that completes.
- A session with a dozen conversations, to give eviction something to do.
- `disableHardwareAcceleration` measured on its own: it leaves a software GPU
  process alive, so its share of Light's saving is unknown.

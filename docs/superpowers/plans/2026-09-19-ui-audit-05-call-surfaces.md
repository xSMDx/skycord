# Call Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The call bar, the call stage and the call device flyout use tokens only, work in every theme, and stop using one red for two opposite meanings.

**Architecture:** Calls become a *media surface*: a dark room in every theme, the way a video player is, because video, screen shares and camera tiles are dark content that a white frame fights. Rather than a parallel set of "call" tokens, one scope in `tokens.css` — `[data-surface="media"]` under the light themes — re-declares the ordinary surface and text tokens at their dark values, so every rule inside the call bar keeps using `--text-1`, `--hover`, `--bg-floor` and gets the dark room. The flyout is a menu, teleported to `<body>`, and follows the theme like every other menu. Then the 53 literals in the three files map onto tokens, the reds split, and the colour guard loses its last deferred files.

**Tech Stack:** Vue 3 `<script setup>`, CSS custom properties, Vitest (node environment; the style guards read source).

**Source:** [inventory finding 5](../audits/2026-09-12-ui-ux-inventory.md) ("the call bar and call stage are dark-only") and finding 18, triaged "split them — red stays for the live broadcast, muted goes neutral"; [the slice index](./2026-09-12-ui-audit-00-slices.md) row 5.

## Global Constraints

- **Only tokens** in any rule touched. `src/styles/__tests__/noHardcodedColour.test.ts` fails on hex, `rgb()`/`rgba()` and named colours.
- **AA** for every text colour; **3:1** for icons and other graphical objects.
- **Muscle memory is binding:** nothing in the call UI moves or changes behaviour. Colour only.
- **Durations from the motion tokens; no transition on a layout property** — the existing guards `durationTokens.test.ts` and `noLayoutAnimation.test.ts` apply to every rule touched.
- **The accent stays the member's.** Nothing re-declares `--accent`, `--accent-*`, `--text-on-accent` or the mention tokens: the appearance picker sets them at runtime, and a scope that re-declared them would override the member's choice inside the call.
- **The owner reviews the result against real video** (Task 6): the media surface is the recommendation, and the one line that applies it (`data-surface="media"` on `.callbar`) is the one to change if the owner prefers the docked bar to follow the theme.

## Decided here, and why

| Question | Decision | Why |
|---|---|---|
| Should calls follow the theme? | **No — a media surface, dark in every theme.** | The audit: "a video tile genuinely *should* sit on a dark ground even in a light theme, so the answer is a 'media ground' token rather than blanket inversion." A call is a theatre of video; Discord keeps its call view dark in its light theme too, so the muscle memory agrees. |
| How? | **A scope, not a token family.** `[data-theme="light"] [data-surface="media"]` and the same for `light-dim` re-declare the 39 surface, text, state and shadow tokens the light themes override, at their dark values. | Every rule inside the call bar keeps its ordinary tokens. A parallel `--call-*` family would double the vocabulary and drift. The dark studio themes are untouched: AMOLED stays AMOLED in a call. |
| Muted | **Neutral** — a dark chip with a light glyph. | Owner's triage of finding 18: red stays for the live broadcast, muted goes neutral. |
| Live | **Stays `--danger`**, with `--text-on-danger` (ink, 4.99:1; white is 3.84:1, under AA for the 10px "LIVE"). | Owner's triage. |
| Controls that are "off" and Leave | **`--danger` fill with `--text-on-danger`.** | A control saying *your mic is off* is an alert, not a status dot; Discord's are red. The glyph follows the same measured ink the rest of the app now uses on this red. |
| Join and the green "on" state | `--green` + `--text-on-green` (ink 6.03:1; white 3.18:1 fails "Join Call" as text), and `--green-deep` + `--text-on-green-deep` (white, 4.94:1). Hovers get their own tokens, measured: `--green-hover` #1f9450 (ink 4.94:1), `--green-deep-hover` #1a6334 (white 7.30:1). | Same rule as `--danger` / `--danger-hover`. |
| Ground behind a tile, behind video | `--media-ground` #0b0b0f for a tile (which may show an avatar), `--letterbox` #000000 behind actual pixels (fullscreen). Both constant. | They are two roles today (#0b0b0f and #000). `--letterbox` also retires three ruled sites in the colour guard. |
| The flyout | **Follows the theme.** | It is a menu, teleported to `<body>`; every other menu follows the theme. |

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/styles/tokens.css` | Four tokens; the media scope | 1 |
| `src/styles/__tests__/mediaSurface.test.ts` | The scope restores every light-overridden token except the member's own; the new fills are measured | 1 |
| `src/components/voice/CallBar.vue` | `data-surface="media"`; 19 lines of literals | 2 |
| `src/components/voice/CallStage.vue` | 15 lines of literals | 3 |
| `src/components/voice/CallFlyout.vue` | 7 literals, themed | 4 |
| `src/styles/__tests__/noHardcodedColour.test.ts` | No deferred files; three ruled sites retired | 5 |
| `src/components/voice/CameraPreviewModal.vue`, `VideoTile.vue`, `VoiceVideoSettings.vue` | Letterbox black becomes `--letterbox` | 5 |

---

### Task 1: The media surface

**Files:** Modify `src/styles/tokens.css`. Create `src/styles/__tests__/mediaSurface.test.ts`.

**Produces:** `--media-ground`, `--letterbox`, `--green-hover`, `--green-deep-hover`; the attribute `data-surface="media"`, which any element can carry to become a dark room under the light themes.

- [ ] **Step 1: Failing test** — `src/styles/__tests__/mediaSurface.test.ts`:

```ts
/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// A call is a dark room in every theme: [data-surface="media"] re-declares,
// under each light theme, every token that theme overrides — at its dark
// value — so rules inside the call bar keep their ordinary tokens and get the
// dark room. If a light theme later overrides a new token and the scope is
// not taught it, something in a call quietly turns light. This fails first.
//
// The member's own colours are excluded on purpose: the appearance picker
// sets the accent at runtime, and re-declaring it here would override it.
const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const block = (selector: RegExp) => selector.exec(css)?.[1] ?? ''
const decls = (text: string) => Object.fromEntries(
  [...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))

const root = decls(block(/:root\s*\{([\s\S]*?)\n\}/))
const MEMBERS_OWN = /^--(accent|text-on-accent|mention|name-hover|time-token)/

const ratio = (a: string, b: string) => {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the media surface', () => {
  for (const theme of ['light', 'light-dim']) {
    it(`restores, under ${theme}, every token ${theme} overrides — at its dark value`, () => {
      const overridden = Object.keys(decls(block(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))))
        .filter(name => !MEMBERS_OWN.test(name))
      const scope = decls(block(new RegExp(`\\[data-theme="${theme}"\\] \\[data-surface="media"\\][^{]*\\{([\\s\\S]*?)\\n\\}`)))
      expect(overridden.length).toBeGreaterThan(30)
      const wrong = overridden.filter(name => scope[name] !== root[name])
        .map(name => `${name}: scope has ${scope[name] ?? 'nothing'}, :root has ${root[name]}`)
      expect(wrong).toEqual([])
    })
  }

  it('never re-declares the member\'s own colours', () => {
    const scope = block(/\[data-surface="media"\][^{]*\{([\s\S]*?)\n\}/)
    expect(Object.keys(decls(scope)).filter(n => MEMBERS_OWN.test(n))).toEqual([])
  })

  it('measures the new fills with the glyphs they carry', () => {
    expect(ratio(root['--green-hover'], root['--text-on-green'])).toBeGreaterThanOrEqual(4.6)
    expect(ratio(root['--green-deep-hover'], root['--text-on-green-deep'])).toBeGreaterThanOrEqual(4.6)
    expect(ratio(root['--media-ground'], root['--green'])).toBeGreaterThanOrEqual(3)
  })
})
```

Run: `npx vitest run src/styles/__tests__/mediaSurface.test.ts` — FAIL: no scope, no tokens.

- [ ] **Step 2: The tokens** — in `tokens.css`, directly after `--on-media` in the "Over arbitrary media" block, add:

```css
  /* The ground behind a call tile (which may show an avatar) and behind the
     pixels themselves. Constant in every theme, like the rest of this block:
     video is dark content, and a light frame fights it. */
  --media-ground: #0b0b0f;
  --letterbox:    #000000;
```

and after `--text-on-green-deep`:

```css
  /* Hover fills for the two greens, measured with the glyphs they carry:
     ink on #1f9450 is 4.94:1, white on #1a6334 is 7.30:1. */
  --green-hover:      #1f9450;
  --green-deep-hover: #1a6334;
```

- [ ] **Step 3: The scope** — at the end of `tokens.css`, add one block whose selector is `[data-theme="light"] [data-surface="media"], [data-theme="light-dim"] [data-surface="media"]`, declaring each of these at exactly its `:root` value (the test compares strings, so copy each value as `:root` writes it):

`--active-bg, --active-ring, --bg-chat, --bg-chatbar, --bg-chatbar-focus, --bg-deep, --bg-floor, --bg-input, --bg-panel, --bg-raised, --border, --danger-text, --divider, --focus-ring, --grabber, --green-text, --hover, --hover-strong, --icon, --press-veil, --seam, --shadow-drawer, --shadow-lg, --shadow-md, --shadow-sheet, --shadow-sm, --shadow-xs, --status-dnd, --status-offline, --status-online, --text-1, --text-2, --text-3, --text-faint, --text-strong, --track, --warning, --warning-text`

with a comment above it:

```css
/* ── The media surface ──────────────────────────────────────────────────────
   A call is a dark room in every theme, the way a video player is. Under the
   light themes an element with data-surface="media" gets back the dark values
   of every token those themes change, so the rules inside it keep their
   ordinary tokens. The dark studio themes are untouched: AMOLED stays AMOLED
   in a call. The member's accent is never re-declared here — the appearance
   picker sets it at runtime. mediaSurface.test.ts holds this list complete. */
```

`--icon` is `var(--text-3)` in `:root`; declare it as `var(--text-3)` here too, so it resolves against the scope's own `--text-3`.

- [ ] **Step 4:** `npx vitest run src/styles/` — PASS. `npm run typecheck`. Commit: `feat(theme): a media surface, dark in every theme, for calls`

---

### Task 2: The call bar

**Files:** Modify `src/components/voice/CallBar.vue`.

- [ ] **Step 1: Make it a media surface.** On the root element — `<div v-if="visible" ref="callbarRef" class="callbar" …>` (about line 406) — add `data-surface="media"`.

- [ ] **Step 2: The literals**, line by line (line numbers from `main` at 2d157b9; find each by its text):

| Now | Becomes |
|---|---|
| `box-shadow: 0 0 0 0 rgba(35,165,90,0);` (`.cb-av`) | `box-shadow: 0 0 0 0 transparent;` |
| `.cb-av.speaking { box-shadow: 0 0 0 3px #23a55a; }` | `.cb-av.speaking { box-shadow: 0 0 0 3px var(--green); }` |
| `.cb-mute` `background: #f23f43; color: #fff;` | `background: var(--bg-chatbar); color: var(--text-2);` — muted is neutral |
| `.cb-b` `background: transparent; color: #fff;` | `background: transparent; color: var(--text-strong);` |
| `.cb-b:hover:not(:disabled) { background: rgba(255,255,255,.08); }` | `… { background: var(--hover); }` |
| `.cb-b:focus-visible, .cb-chev:focus-visible { background: rgba(255,255,255,.16); }` | `… { background: var(--hover-strong); }` |
| `.cb-b.off { background: #f23f43; color: #fff; }` | `.cb-b.off { background: var(--danger); color: var(--text-on-danger); }` |
| `.cb-b.off:hover:not(:disabled) { background: #d83c3f; }` | `… { background: var(--danger-hover); color: var(--text-on-danger-hover); }` |
| `.cb-chev` `background: transparent; color: #b5bac1;` | `background: transparent; color: var(--text-2);` |
| `.cb-chev:hover:not(:disabled) { background: rgba(255,255,255,.08); color: #fff; }` | `… { background: var(--hover); color: var(--text-strong); }` |
| `.cb-split:hover:has(.cb-b:not(:disabled)) { background: rgba(255,255,255,.08); }` | `… { background: var(--hover); }` |
| `.cb-split.menuopen { background: rgba(255,255,255,.08); }` | `… { background: var(--hover); }` |
| `.cb-leave` `background: #f23f43; color: #fff;` | `background: var(--danger); color: var(--text-on-danger);` |
| `.cb-leave:hover { background: #d83c3f; }` | `.cb-leave:hover { background: var(--danger-hover); color: var(--text-on-danger-hover); }` |
| `.cb-join` `background: #23a55a; color: #fff; …` | `background: var(--green); color: var(--text-on-green); …` |
| `.cb-join:hover { background: #1f9450; … }` | `.cb-join:hover { background: var(--green-hover); … }` |
| `.cb-b.on { background: #248046; color: #fff; }` | `.cb-b.on { background: var(--green-deep); color: var(--text-on-green-deep); }` |
| `.cb-b.on:hover:not(:disabled) { background: #1a6334; }` | `… { background: var(--green-deep-hover); }` |
| `.callbar.is-fs { background: #000; … }` | `.callbar.is-fs { background: var(--letterbox); … }` |

The speaking ring stays `--green` rather than `--green-text`: inside the media surface the ground is dark in every theme, where `--green` measures 6.18:1 against `--media-ground` and the dark floor alike.

- [ ] **Step 3:** `npx vitest run src/` — the colour guard's deferred count for the call surfaces drops; everything else passes. `npm run typecheck`. Commit: `fix(call): the call bar is a media surface, and its colours are tokens`

---

### Task 3: The call stage

**Files:** Modify `src/components/voice/CallStage.vue`. It renders only inside `CallBar.vue`, so it inherits the media surface.

| Now | Becomes |
|---|---|
| `.s-av` `box-shadow: 0 0 0 0 rgba(35,165,90,0);` | `box-shadow: 0 0 0 0 transparent;` |
| `.s-av.speaking { box-shadow: 0 0 0 3px #23a55a; }` | `… 0 0 0 3px var(--green); }` |
| `.s-wave` `border: 2px solid rgba(88,101,242,.75);` | `border: 2px solid rgba(var(--accent-rgb), .75);` — the last of Discord's blurple |
| `.s-mute` `background: #f23f43; color: #fff; …` | `background: var(--bg-chatbar); color: var(--text-2); …` — muted is neutral |
| `.g-cell` `background: #0b0b0f; …` | `background: var(--media-ground); …` |
| `.g-cell.speaking { border-color: #23a55a; }` | `… { border-color: var(--green); }` |
| `.g-cell:hover` `box-shadow: inset 0 0 0 2px rgba(255,255,255,.22);` | `box-shadow: inset 0 0 0 2px var(--active-ring);` |
| `.g-av` `background: rgba(0,0,0,.35); color: #fff; …` | `background: var(--media-veil); color: var(--on-media); …` |
| `.g-wave` `border: 2px solid rgba(88,101,242,.75);` | `border: 2px solid rgba(var(--accent-rgb), .75);` |
| `.g-name` `background: rgba(0,0,0,.65); color: #fff; …` | `background: var(--media-veil-strong); color: var(--on-media); …` |
| `.g-fs` `background: rgba(0,0,0,.6); color: #fff;` | `background: var(--media-veil-strong); color: var(--on-media);` |
| `.g-fs:hover { background: rgba(0,0,0,.85); }` | `.g-fs:hover { background: var(--scrim); }` |
| `.g-cell.is-cell-fs { … background: #000; }` | `… background: var(--letterbox); }` |
| `.g-live` `background: #f23f43; color: #fff; …` | `background: var(--danger); color: var(--text-on-danger); …` — live stays red |
| `.g-mute` `background: #f23f43; color: #fff; …` | `background: var(--media-veil-strong); color: var(--on-media); …` — over video, muted is a neutral chip |

- [ ] **Step 1:** Apply the table.
- [ ] **Step 2:** `npx vitest run src/`, `npm run typecheck`. Commit: `fix(call): the stage's colours are tokens, and muted stops wearing live's red`

---

### Task 4: The device flyout

**Files:** Modify `src/components/voice/CallFlyout.vue`. It is a menu teleported to `<body>` and follows the theme.

| Now | Becomes |
|---|---|
| `.fly` `border: 1px solid rgba(255,255,255,.1);` | `border: 1px solid var(--border);` |
| `.fly` `box-shadow: 0 8px 32px rgba(0,0,0,.85);` | `box-shadow: var(--shadow-md);` |
| `.fly .fr-sep { … background: rgba(255,255,255,.08); … }` | `… background: var(--divider); …` |
| `.fly .fr-check { color: #23a55a; … }` | `… color: var(--green-text); …` |
| `.fly .fr-tog` `background: rgba(128,132,142,.5); …` | `background: var(--toggle-off); …` |
| `.fly .fr-tog.on { background: #23a55a; }` | `.fly .fr-tog.on { background: var(--accent); }` — every other switch in the app is the accent when on |
| `.fly .fr-tog` knob `background: #fff;` | `background: var(--toggle-knob);` |

- [ ] **Step 1:** Apply the table. `--green-text`, not `--green`, for the tick: it is a glyph on a themed surface, and `--green` fails 3:1 on the light ones.
- [ ] **Step 2:** Tests, typecheck. Commit: `fix(call): the device flyout follows the theme like every other menu`

---

### Task 5: The guard, finished

**Files:** Modify `src/styles/__tests__/noHardcodedColour.test.ts`, `src/components/voice/CameraPreviewModal.vue`, `src/components/voice/VideoTile.vue`, `src/components/voice/VoiceVideoSettings.vue`.

- [ ] **Step 1: Letterbox black is a token now.** `.cp-stage { background: #000 }`, `.vtile { background: #000 }` and `.vv-cambox { background: #000 }` become `var(--letterbox)`.
- [ ] **Step 2: The guard.** Delete `DEFERRED_FILES`, `DEFERRED_BASELINE`, `isDeferred` and the test "keeps the call surfaces at or below their deferred count until slice 5"; the main assertion filters only `isRuled`. Delete the three letterbox entries from `RULED` (their test "has no ruled site that no longer exists" would fail otherwise — which is the point of that test).
- [ ] **Step 3:** `npx vitest run src/` — the colour guard asserts zero outside the ruled sites, with no deferred files. Commit: `test(theme): no deferred files left — the whole app is on tokens`

---

### Task 6: See it, against real video (owner)

- [ ] **Step 1:** A voice call with two people, one camera on, one screen share, in `default`, `light` and `light-dim`. The call bar and stage are a dark room in all three; the rest of the app follows the theme around them.
- [ ] **Step 2:** Mute someone: their badge is a neutral chip, and the LIVE badge on a share is still red. Turn your own mic off: the button is red. Hover Join, a green "on" control and Leave.
- [ ] **Step 3:** Fullscreen a tile and the call: pure black behind the video.
- [ ] **Step 4:** The device flyout in a light theme: a light menu over the dark bar, like every other menu.
- [ ] **Step 5: The owner's call.** If the docked bar should follow the theme instead, remove `data-surface="media"` from `.callbar` and put it on `.cb-callstage` and the fullscreen state only; nothing else changes.
- [ ] **Step 6:** Tick findings 5 and 18 in the inventory.

---

## Self-review

**Coverage.** Finding 5 (dark-only call bar and stage) — Tasks 1–3. Finding 18 (one red, two meanings) — Tasks 2 and 3. The slice index's "full theming of the call bar and stage, and splitting the two reds" — Tasks 1–4. The guard's last deferred files — Task 5.

**Every literal is placed.** CallBar's 19 lines hold 25 literals, CallStage's 15 hold 21, CallFlyout's 7 hold 7: 53, the guard's deferred count.

**Placeholders.** None; each site's before and after is written out, and Task 1's scope list is the complete set the test checks.

**The risk worth naming.** The scope changes how every token reads inside the call bar under the light themes. A rule inside the call bar that meant "the app's theme" — there are none today, since the bar was built dark — would now read dark. Task 6 is where that shows.

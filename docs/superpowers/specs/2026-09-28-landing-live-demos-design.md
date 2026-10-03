# The landing page demonstrates itself — design

**Goal.** Every channel of skycord.xyz shows Skycord doing the thing it is
describing, driven by a simulated cursor, and the moment a real pointer enters
a demo it stops playing and becomes usable.

**Scope.** `landing/` only. The app is untouched. Two screen captures are taken
from the real app; nothing else leaves the landing directory.

---

## Why this exists

The page is already a Skycord server: guild rail, channel list, chat column,
member panel, composer. That concept is stronger than the reference sites it
was measured against — Discord's page plays videos *of* the product, Revolt's
shows a screenshot *of* the product, and this page can simply *be* it.

It does not cash that in. Every channel resolves to a bot avatar and a wall of
bullets. `#features` is ten embeds of four bullets each: forty bullets, no
pictures, nothing moving. An app-shaped frame sets an expectation of life, so
static content reads worse inside it than it would on an ordinary marketing
page.

The page is not inert, and the existing motion sets the standard the rest must
meet:

- a random `.vm` member in the Lounge gains `.speaking` every 2400ms, held for
  700–2200ms
- `#welcome` types its closing line in once per visit
- channels get `.arriving` for 900ms on switch

All three already gate on `REDUCE` (`prefers-reduced-motion`). The tokens are
the app's own — `--bg-chat`, `--accent`, `--on-accent` — with a real motion
scale: `--dur-1/2/3` at 120/180/240ms, `--ease-out: cubic-bezier(.32,.72,0,1)`.

What is missing is infrastructure. In 1563 lines there is no
`IntersectionObserver`, no `requestAnimationFrame`, two `@keyframes` and
twenty-two transitions. Everything below is additive.

## The rule

**A demo plays itself until you touch it. Then it is yours.**

| State | Cursor | Demo |
|---|---|---|
| Off-screen | absent | paused, no rAF |
| On-screen, untouched | ghost cursor drives it | loops |
| Real pointer inside | ghost fades out, 200ms | fully interactive |
| Real pointer leaves, 3s | ghost fades back in | resumes from rest |
| `prefers-reduced-motion` | never appears | renders end state, still interactive |

This is the argument against the reference pages: their sections are `.mp4`
files. A video cannot be clicked.

---

## 1. The ghost cursor

A single `<svg>` arrow, positioned in each demo's own coordinate space so the
demos stay responsive. Its motion quality is the whole illusion — a linear
tween to a target is the tell that reads as "animation" rather than "someone
using this".

**Movement is two-phase.** Human pointing is ballistic: a fast throw covering
roughly 70% of the distance, then a slower corrective settle. One eased tween
does not look like this.

| Phase | Distance | Duration | Curve |
|---|---|---|---|
| Ballistic | 70% | 60% of total | `--ease-out` |
| Corrective | 30% | 40% of total | `cubic-bezier(.25,.1,.25,1)` |

Total duration scales with distance, clamped 340–720ms. The path carries a
slight quadratic curve — perpendicular offset of ~8% of distance at the
midpoint — because straight lines read as robotic.

**Dwell before clicking: 200ms.** Target acquisition. Clicking on arrival is
the second-biggest tell.

**The click** is three things in order: the cursor scales to `.88` for 90ms,
the target gets a ripple and its genuine `:active` state, and only then does
the state change.

**At rest** the cursor micro-drifts (±2px, ~3s period) so it never looks
frozen, and it fades and scales from `.8` on enter and exit rather than
teleporting.

## 2. Six demos

`#features` drops from ten embeds to six demos. The four that are cut —
Groups & conversations, Channels & servers, Security & privacy, Quick
actions — become a compact two-column list below. They are table stakes; they
are not why anyone would switch.

| Demo | The cursor does | Shows |
|---|---|---|
| **Screen share** | Clicks share, picker opens, picks a window, tile goes **LIVE** | the picker shipped on this branch |
| **Voice & filtering** | Opens the filter menu, RNNoise → DeepFilterNet 3 | waveform visibly cleans up |
| **Themes** | Clicks swatches | **the whole page recolors** |
| **Older PC** | Flips Light mode | memory bar drops 41%, tiles to 360p |
| **Reactions** | Hovers a message, action bar slides in, picks an emoji | it pops in with a count, then a second arrives from someone else |
| **Connection** | Opens the debug panel | ping graph drawing continuously |

**Themes is the showstopper and is nearly free.** The shell is already driven
entirely by custom properties, so recoloring the live page is a variable swap
on `:root`, not a rebuild. No other landing page can do this, because no other
landing page *is* the product.

## 3. The ambient layer

The Lounge is on screen 100% of the time, in the corner of every channel. It
already lives; it should live more specifically.

- Speaking rings scale with a per-member fake amplitude envelope rather than
  toggling opacity, so the ring breathes instead of blinking
- Someone mutes and unmutes; a camera icon appears and later goes
- Conversation has turn-taking — two people do not start together, and the
  gaps vary — rather than a uniform 2400ms random pick

**The cat.** Eyes track the pointer, the real one and the ghost. Blink on a
loose interval. Something playful on click. It is cheap and it is the thing
people remember.

**Hover craft on every icon**: the rail squircle morph with tooltips, channel
hashes brightening, member avatars lifting.

## 4. Two real captures

The page contains no real pixels of the app. Two, where faithful recreation is
not worth the effort: the **big-screen call** with spotlighted streams, and the
**desktop share picker**. Everything else is markup we already own, which stays
crisp at any DPI, recolors with the theme, and never needs re-recording when
the UI changes.

## 5. Performance, and not cooking a laptop

**One demo runs at a time** — the most visible one, chosen by
`IntersectionObserver`. Everything else is paused with no rAF scheduled. Eight
concurrent loops on a page whose pitch is *kind to an older PC* would be a
poor joke.

Also paused on `document.hidden`, matching the existing Lounge loop.

Animation is confined to `transform` and `opacity`. No animated `width`,
`top`, or `box-shadow`.

## 6. Housekeeping

- `prefers-reduced-motion`: no cursor, demos render their end state, and stay
  interactive. Reduced motion is not reduced function.

## Where the code goes

Out of `index.html`, which is already 127KB, and into two siblings:

| File | Holds |
|---|---|
| `landing/demos.css` | demo stages, ghost cursor, hover craft |
| `landing/demos.js` | cursor engine, demo scripts, observer, takeover |

`index.html` keeps the shell, the channels and the existing scripts. The new
files are independently cacheable and can be worked on without touching a
1563-line document. The server is a static directory; no build step exists or
is added.

## What this is not

- Not a redesign. The shell, the tokens, the type and the copy stay.
- Not a video pipeline. Two still captures, no `.mp4`.
- Not a framework. Plain JS in the file's existing IIFE style, matching
  `var`/`$`/`$$` and the `REDUCE` guard already there.

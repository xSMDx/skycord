# Landing redesign: "Crew room" (design)

Date: 2026-11-14 · Branch `landing-redesign` · Surface `landing/index.html`

## Why
The owner finds skycord.xyz "a little boring" and pointed at fluxer.com for the energy
it should have: big, alive, the product shown at scale. The owner also wants Motion
(motion.dev) and Anime.js (animejs.com) in real use on the page. This is inspiration
from Fluxer, not a copy: Skycord keeps its name, copy voice, headphones mark, palette,
fonts, live demos and the system-aware download button.

## Approaches (owner picked A from mockups on 2026-11-14)
- **A · Crew room (picked).** Leads with voice, since Skycord is voice-first. A huge
  left-set headline over a live voice stage, then a coloured tile grid of the features
  with their live demos.
- B · Window stack: floating Skycord pieces that assemble on scroll. The most motion,
  the least content density, and a scroll-jacking risk on phones.
- C · Sky stage: a Sky-blue hero field with device frames. Closest to Fluxer, but it
  breaks the landing's dark-only rule and a white headline on Sky fails contrast.

## Goals
- First viewport: a headline at up to ~118 px, the lede, the CTA row (the `platformCta`
  download plus "Open in your browser") and the top of a live **voice stage**: a
  screen-share tile, speaking tiles with green rings, chat bubbles arriving, and a call
  control bar.
- Fluxer-grade energy, built from Skycord's own pieces: tactile pill buttons with a
  darker bottom edge, a feature-pill marquee, colour fields at page scale (feature
  tiles and the closing band), big true numbers, and depth on the stage.
- Motion and Anime.js are self-hosted, in real use, and off the critical path.

## Non-goals
- No new claims. Every number and feature on the page is already on the page, or in the
  changelog or PRODUCT.md (for example "40 releases in 20 weeks", "No ads, no upsell").
- No change to the changelog or roadmap pages beyond keeping the shared `site.css` and
  `site.js` classes they use (topbar, brand, cat, footer) working.
- No Motion or Anime.js in the web app. That is a later step, noted in the PR.

## Anti-goals (a failure even if it works)
- A page that hides content until a script runs, or blank when the libraries fail.
- Motion under `prefers-reduced-motion`. With reduce set, the libraries are not even
  loaded, and everything sits in its final state.
- Coloured glows or halos (DESIGN.md). Elevation stays a neutral shadow.
- Horizontal scroll at 360 px, touch targets under 44 px, or a heavy first paint.

## Page structure
1. **Top bar**: as now, with a tactile "Open Skycord" pill.
2. **Hero**: the headline (Chakra Petch 700) with "talk" in Sky; the lede and CTA row
   beside each other on desktop, stacked on a phone; the meta line in Fira Code. Then the
   voice stage, a large rounded panel. On desktop: a 2×2 screen-share tile plus four
   speaking tiles, with chat bubbles overlapping the edges and the control bar
   straddling the bottom edge. On a phone: the share tile on top and a 2×2 grid below.
3. **Feature marquee**: pills of shipped features with the mark between them. It pauses
   on hover, and under reduced motion it becomes a static wrapped row.
4. **Feature tiles** (`#features`): the eight current features with all their copy,
   ticks and live demos, laid out as a 12-column tile grid with varied spans. Grounds
   are Sky, accent-preset Green, Yellow and Pink tiles (ink text, for contrast), mixed
   with dark tiles. The demos stay dark app UI sitting on the colour. One column on a
   phone.
5. **Numbers strip**: three to four big true figures that count up (Anime.js): releases,
   weeks, platforms, and the one install command.
6. **Self-host**: the terminal, larger, with the command typed in (Anime.js) and a
   working Copy button.
7. **Closing band**: a Sky field with an ink headline, "Get your crew in one place.",
   and ink/white tactile CTAs (the `data-dl` and `data-web` swap still applies).
8. **Footer**: as now.

## Motion split
- **Anime.js 4.5.0** (timelines and sequencing): the hero intro timeline (headline
  words rise via `splitText`, then the lede and CTAs, then the stage rises and its tiles
  pop in with a stagger), the stage's ambient loop (speaking rings, bubbles arriving),
  the count-up of the numbers, and the terminal typing.
- **Motion 14.9.0** (scroll and springs): the stage's scroll-linked tilt (`scroll()`: it
  starts tipped back and flattens as it comes up, with a parallax drift on the bubbles),
  `inView` reveals of the tiles with a spring, and spring hover lift on the tiles
  (pointer-fine only). Press feedback stays instant, in CSS (DESIGN.md).
- Both are vendored as tree-shaken ES modules built once with esbuild from the pinned
  npm versions, with the recipe and licences in `landing/vendor/README.md`. Their file
  names carry the version, so they are immutable and need no `?v=` stamp. Our own module
  `site-motion.js` is stamped by `stamp-assets.mjs` like the other root assets. The
  libraries load as `type="module"` (deferred), with `modulepreload`, and only when
  reduced motion is off.
- Hero choreography hides its targets only under an `html.anim` class, set by a tiny
  inline head script when motion is allowed. A 2.5 s safety timer removes it if the
  module never runs.

## Constraints
DESIGN.md tokens and fonts; text on Sky is ink; 44 px targets; no horizontal scroll at
360 px; accessible names and focus kept; the stage is decorative (`aria-hidden`) except
the real buttons. Page weight is measured before (265 KB uncompressed) and after; the
target is under +40 KB gzipped for motion-allowed visitors and about +0 for reduced
motion.

## Left to the builder
Exact spans per tile, tile colour order, stat wording within the true facts, and
timings within DESIGN.md's motion bands (the marketing reveal tier is allowed up to
~620 ms).

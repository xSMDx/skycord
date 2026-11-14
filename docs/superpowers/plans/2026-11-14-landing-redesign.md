# Landing redesign "Crew room": implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `landing/index.html` as the approved "Crew room" design, with Motion and Anime.js self-hosted and in real use.

**Architecture:** A static site with no build step. Markup is in `index.html` and styles in `site.css` (shared with the changelog and roadmap) plus `demos.css`. `site.js` stays the classic script for everything that must work without motion. A new ES module, `site-motion.js`, imports two vendored, tree-shaken library builds from `landing/vendor/` and is the only place animation libraries are used.

**Tech Stack:** HTML, CSS, vanilla JS; Motion 14.9.0 and Anime.js 4.5.0 (MIT), bundled once with esbuild; checks run headless in Edge via playwright-core.

**Spec:** `docs/superpowers/specs/2026-11-14-landing-redesign-design.md`

## Global Constraints
- Tokens and fonts from DESIGN.md only; text on Sky (`#38b6f1`) and on accent-preset tiles is ink `#0e0f11`; no coloured glows.
- `prefers-reduced-motion: reduce` → the libraries are not loaded and every element sits in its final state.
- 44 px minimum touch targets; no horizontal scroll at 360 px; no console errors.
- No new claims: every figure and feature comes from the current page, the changelog or PRODUCT.md.
- `platformCta` (`[data-dl]`, `[data-dl-label]`, `[data-web]`) keeps working in the hero and the closing band.
- The changelog and roadmap still render, with their topbar, cat and footer.
- No third-party requests at runtime.

## Review Focus
1. A JS failure or blocked module → hero content must still be visible within 2.5 s (the `html.anim` safety timer).
2. Reduced motion turned on mid-visit → loops stop (listen for `change`).
3. A hidden tab → the hero loop and count-ups pause (`visibilitychange`), with no CPU burn off-screen (`IntersectionObserver`).
4. Narrow phones at 360 px → the stage, the tiles and the demos must not overflow.
5. Linux, Mac or Android visitors → the closing band's swapped buttons keep the primary styling.

All five are covered by the check script in Task 4.

---

### Task 1: Vendor the libraries

**Files:**
- Create: `landing/vendor/motion-14.9.0.js`, `landing/vendor/anime-4.5.0.js`, `landing/vendor/README.md`, `landing/vendor/LICENSE-motion.txt`, `landing/vendor/LICENSE-animejs.txt`
- Modify: `landing/stamp-assets.mjs` (header comment only: vendor files are versioned by name and deliberately unstamped)

**Interfaces:**
- Produces: `vendor/motion-14.9.0.js` exports `animate, scroll, inView, hover, spring`; `vendor/anime-4.5.0.js` exports `createTimeline, animate, stagger, splitText, utils`.

- [ ] Build each with `esbuild --bundle --minify --format=esm` from an entry that re-exports only the names above, using the pinned npm packages in the scratchpad.
- [ ] Verify: `node -e "import('./landing/vendor/motion-14.9.0.js')"` is not applicable (browser globals); instead, the Task 4 check asserts `window.__motionReady === true`. Record each file's raw and gzip size in the README.
- [ ] Commit `feat(landing): vendor tree-shaken Motion 14.9.0 and Anime.js 4.5.0`.

### Task 2: Markup and styles

**Files:**
- Modify: `landing/index.html` (hero, marquee, features grid, numbers, self-host, close), `landing/site.css`, `landing/demos.css` (tile-context fixes only), `landing/site.js` (remove `heroLife`; keep the rest)

**Interfaces:**
- Produces, for Task 3: `#stage` (the panel), `.st-tile[data-who]`, `.st-bubble`, `#stage-ctrl button[aria-pressed]`, `[data-split]` on the h1, `.tile` (feature tiles), `[data-count="40"]` numbers, `#term-cmd` (the terminal command text), and `html.anim` hidden states (CSS) for `.a-in` elements.

- [ ] Hero: the left-set h1 (`clamp(54px, 8.6vw, 118px)`), the lede, the CTA row and the meta line; the stage grid (desktop `repeat(4, 1fr)` with a 2×2 share tile; ≤760 px: the share tile full width and 2 columns). Static state: Ada and Rin speaking, two bubbles visible.
- [ ] Marquee of shipped-feature pills (CSS animation, paused on hover, `animation: none` + wrap under reduced motion).
- [ ] `#features` as a 12-column grid: Phone 12 (Sky), Screen 7 (dark) + Noise 5 (Green), Music 5 (Yellow) + Accent 7 (dark), Older PC 6 (dark) + Quick replies 6 (Pink), Network 12 (dark). Copy, ticks and demos are moved unchanged. One column at ≤900 px.
- [ ] Numbers strip: "40 releases", "20 weeks", "3 apps + the browser", "1 command to self-host".
- [ ] Self-host terminal (as now, larger) and the Sky closing band with ink headline.
- [ ] Tactile buttons: `box-shadow: 0 5px 0 <darker>`; on `:active` translateY(3px) and the shadow shrinks, with no transition.
- [ ] Inline head script: `if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { html.classList.add('anim'); setTimeout(() => html.classList.remove('anim'), 2500) }`. `site-motion.js` clears the timer via `window.__animTimer`.

### Task 3: `site-motion.js`

**Files:**
- Create: `landing/site-motion.js`; modify `landing/index.html` (`<link rel="modulepreload">` ×2, `<script type="module" src="site-motion.js">`)

**Interfaces:**
- Consumes: the Task 1 exports and the Task 2 hooks.

- [ ] Exit immediately under reduced motion (the module is also not requested: it is injected by the inline script only when motion is allowed).
- [ ] Anime.js `heroIntro()`: `splitText('[data-split]', { words: true })` words rise from `y: '0.6em', opacity: 0`, stagger 60 ms; then the lede, CTAs and meta; then the stage from `y: 40, opacity: 0`; tiles `scale: [.9, 1]`, stagger 70 ms; ~1.1 s total. Removes `html.anim` at the start.
- [ ] Anime.js `stageLoop()`: speaking rings via class toggles, and a new bubble every 4.6 s animated in with a timeline; it runs only while `#stage` is in view and the tab is visible.
- [ ] Anime.js `countUp(el)` on `inView`, and `typeCommand()` on `inView` for `#term-cmd`.
- [ ] Motion `scroll(animate('#stage', { rotateX: [16, 0], scale: [.94, 1] }), { target: stage, offset: ['start end', 'center center'] })`; bubbles drift `y` with the scroll.
- [ ] Motion `inView('.tile', …)` spring reveal (`y: [28, 0], opacity: [0, 1]`, `type: spring, bounce: .2, duration: .7`), once. Tiles stay visible if this never runs (they are hidden only under `html.anim` and revealed by the module).
- [ ] Motion `hover('.tile', …)` spring lift of 4 px (pointer-fine only).
- [ ] Set `window.__motionReady = true` when both are wired.

### Task 4: Verify, document, PR

- [ ] Headless check (scratchpad `check.cjs`): at 1280 and 375 px, with motion and with reduced motion. Assert no page errors, `scrollWidth <= innerWidth`, `__motionReady` (motion) / no vendor requests (reduce), h1 visible after 3 s with the module blocked, all buttons and links ≥ 44 px tall (CTA, nav pills, stage controls), and `/changelog/` and `/roadmap/` render entries. Screenshots at both widths.
- [ ] Weight: total bytes before (265,232) and after, raw and gzip, in the PR.
- [ ] Run the impeccable detector; fix the mechanical findings.
- [ ] Update DESIGN.md (the landing rows of "Two surfaces", the landing colour section, plus a "Landing motion" note on the library split).
- [ ] Commit with pathspecs; push; open the PR, including "Next: the same libraries in the web app" notes.

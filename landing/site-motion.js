/* ── The home page, moving ────────────────────────────────────────────
   Everything here is extra. The page is complete without this file; it
   runs only when the visitor allows motion (the inline script in <head>
   decides, and holds the hero still until this takes over).

   Two libraries, one job each, so they never fight over an element:
     Anime.js — anything sequenced: the hero's opening (the mini app
                assembling itself), the numbers counting, the command typing.
     Motion   — scroll and springs: the mini app standing up as it scrolls
                in, tiles springing in, the hover lift.
   The mini app's own states (channels, calls, settings) are CSS transitions
   driven by app-demo.js, so they work with or without this file.
   Both libraries are vendored in vendor/ (see vendor/README.md). */

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* Whatever happens, nothing stays hidden. Called on success, on failure,
   and if reduced motion is switched on mid-visit. */
function release() {
  clearTimeout(window.__animTimer);
  html.classList.remove('anim');
}
function unhideAll() {
  $$('[data-held]').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; el.removeAttribute('data-held'); });
  release();
}
/* Hold an element at its start state before the hold class goes, so the
   handover from CSS to script never shows a frame of the final layout. */
function hold(el) { el.style.opacity = '0'; el.setAttribute('data-held', ''); return el; }

if (!REDUCE.matches) {
  Promise.all([import('./vendor/anime-4.5.0.js'), import('./vendor/motion-14.9.0.js')])
    .then(([anime, motion]) => start(anime, motion))
    .catch((err) => { unhideAll(); console.warn('site-motion: running without motion', err); });
}

function start(anime, motion) {
  const { createTimeline, animate: aAnimate, stagger, splitText } = anime;
  const { animate: mAnimate, scroll, inView, hover, spring } = motion;
  const stops = [];   // teardown for reduced motion switched on later

  const h1 = $('[data-split]');
  const stage = $('#stage');
  if (!h1 || !stage) { release(); return; }

  /* Late: the 2.5 s safety timer already showed the page, and the visitor
     may be reading it. Never hide what is on screen to replay it — keep
     only the parts that add motion to a page already there (the loop,
     scroll, hover). */
  const late = !html.classList.contains('anim');
  const featureTiles = late ? [] : $$('#features .tile');

  /* ── Hero: the opening ─────────────────────────────────────────── */
  // The app assembles itself the way it loads: rail, then the channel
  // list, then the conversation.
  if (!late) {
    const words = splitText(h1, { words: { class: 'w' } }).words;
    words.forEach(hold);
    const intro = ['.hero .lede', '.hero-act', '.stage-wrap'].map((s) => hold($(s)));
    const rail = $$('.m-rail .ri, .m-rail .ri-divider', stage).map(hold);
    const rows = $$('.sb-header, .ch-group-label, .ch-item, .vc-occ, .user-panel', stage).map(hold);
    const talk = $$('.chat-header, .m-msgs .msg, .input-wrapper', stage).map(hold);
    featureTiles.forEach(hold);
    release();

    const tl = createTimeline({ defaults: { ease: 'outExpo', duration: 900 } })
      .add(words, { opacity: [0, 1], translateY: ['0.45em', '0em'], delay: stagger(55) }, 0)
      .add(intro[0], { opacity: [0, 1], translateY: [16, 0], duration: 700 }, 260)
      .add(intro[1], { opacity: [0, 1], translateY: [16, 0], duration: 700 }, 340)
      .add(intro[2], { opacity: [0, 1], translateY: [56, 0], duration: 1100 }, 380)
      .add(rail, { opacity: [0, 1], scale: [0.8, 1], duration: 600, delay: stagger(50) }, 560)
      .add(rows, { opacity: [0, 1], translateX: [-10, 0], duration: 600, delay: stagger(28) }, 640)
      .add(talk, { opacity: [0, 1], translateY: [10, 0], duration: 650, delay: stagger(70) }, 780);
    // Reduced motion switched on mid-intro jumps it to the end.
    stops.push(() => tl.complete());
    tl.then(() => {
      // Hand the elements back to CSS: the mini app's own transitions own
      // them from here.
      [...words, ...intro, ...rail, ...rows, ...talk].forEach((el) => {
        el.removeAttribute('data-held');
        if (el !== intro[2]) { el.style.transform = ''; el.style.opacity = ''; }
      });
    });
  }

  /* ── The stage settles as you scroll to it ─────────────────────────
     It starts tipped back, as if lying on the desk, and stands up as it
     reaches the middle of the screen. */
  // Wide screens only: on a phone the mini app is the thing you touch, and
  // a scaled-down stage would shrink its 48px tabs under the 44px minimum.
  if (matchMedia('(min-width: 761px)').matches) {
    stops.push(scroll(
      mAnimate(stage, { transform: ['rotateX(14deg) scale(.95)', 'rotateX(0deg) scale(1)'] }, { ease: 'linear' }),
      { target: stage, offset: ['start end', 'center center'] }
    ));
  }

  /* ── Feature tiles spring in, and lift under a pointer ───────────── */
  featureTiles.forEach((tile) => {
    stops.push(inView(tile, () => {
      mAnimate(tile, { opacity: [0, 1], transform: ['translateY(36px)', 'translateY(0px)'] },
        { type: spring, bounce: 0.18, duration: 0.8 })
        .then(() => tile.removeAttribute('data-held'));
    }, { amount: 0.12 }));
  });
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    stops.push(hover('#features .tile', (tile) => {
      mAnimate(tile, { transform: 'translateY(-4px)' }, { type: spring, bounce: 0.3, duration: 0.45 });
      return () => mAnimate(tile, { transform: 'translateY(0px)' }, { type: spring, bounce: 0.2, duration: 0.5 });
    }));
  }

  /* ── The numbers count up when they arrive ───────────────────────── */
  // Each figure starts at 0 now, not when it arrives, or it would show its
  // final value for a moment and then snap back. Screen readers read the
  // stable copy beside it (.sr-only), never the moving one.
  const nums = $('.numbers');
  if (nums && !late) {   // late: the real figures are already showing
    const counters = $$('[data-count]', nums).filter((el) => +el.dataset.count > 0);
    counters.forEach((el) => { el.textContent = '0'; });
    stops.push(inView(nums, () => {
      counters.forEach((el, i) => {
        const to = +el.dataset.count;
        const n = { v: 0 };
        aAnimate(n, { v: to, duration: 1400, delay: i * 140, ease: 'outExpo',
          onUpdate: () => { el.textContent = String(Math.round(n.v)); } });
      });
    }, { amount: 0.5 }));
  }

  /* ── The install command types itself, once ──────────────────────── */
  const cmd = $('#term-cmd');
  if (cmd && !late) {    // late: the command is already on screen, leave it
    // Cleared up front for the same reason as the numbers; the Copy button
    // and the .sr-only copy always carry the whole command.
    const full = cmd.textContent;
    cmd.textContent = '';
    stops.push(inView(cmd, () => {
      const n = { c: 0 };
      aAnimate(n, { c: full.length, duration: 1500, ease: 'linear',
        onUpdate: () => { cmd.textContent = full.slice(0, Math.round(n.c)); },
        onComplete: () => { cmd.textContent = full; } });
    }, { amount: 0.6 }));
  }

  /* ── Teardown if motion is switched off mid-visit ─────────────────── */
  REDUCE.addEventListener('change', () => {
    if (!REDUCE.matches) return;
    stops.forEach((s) => { try { typeof s === 'function' ? s() : s && s.stop && s.stop(); } catch (e) { /* already gone */ } });
    $$('#stage, #features .tile').forEach((el) => { el.style.transform = ''; });
    if (cmd) cmd.textContent = cmd.nextElementSibling.textContent;
    $$('[data-count]').forEach((el) => { el.textContent = el.dataset.count; });
    unhideAll();
  });

  window.__motionReady = true;
}

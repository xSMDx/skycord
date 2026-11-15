/* ── The home page, moving ────────────────────────────────────────────
   Everything here is extra. The page is complete without this file; it
   runs only when the visitor allows motion (the inline script in <head>
   decides, and holds the hero still until this takes over).

   Two libraries, one job each, so they never fight over an element:
     Anime.js — anything sequenced: the hero's opening (headline, then the
                scene, then the crew popping in), and the command typing.
     Motion   — scroll and springs: the working app standing up as it
                scrolls in, and the panels springing in.
   The working app's own states (channels, calls, settings) are CSS
   transitions driven by app-demo.js, and the characters are driven by the
   persona-icons engine (home.js), so both work with or without this file.
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
  const { animate: mAnimate, scroll, inView, spring } = motion;
  const stops = [];   // teardown for reduced motion switched on later

  const h1 = $('[data-split]');
  const stage = $('#stage');
  if (!h1 || !stage) { release(); return; }

  /* Late: the 2.5 s safety timer already showed the page, and the visitor
     may be reading it. Never hide what is on screen to replay it — keep
     only the parts that add motion to a page already there (scroll). */
  const late = !html.classList.contains('anim');
  const panels = late ? [] : $$('.c-panel');

  /* ── Hero: the opening ─────────────────────────────────────────── */
  if (!late) {
    const words = splitText(h1, { words: { class: 'w' } }).words;
    words.forEach(hold);
    const copy = ['.c-lede', '.c-hero .cta-row', '.c-meta'].map((s) => hold($(s)));
    const device = ['.c-mon', '.c-phone-in'].map((s) => hold($(s)));   // the phone's own tilt stays on its parent
    const crew = $$('.c-scene .pc').map(hold);
    panels.forEach(hold);
    release();

    const tl = createTimeline({ defaults: { ease: 'outExpo', duration: 900 } })
      .add(words, { opacity: [0, 1], translateY: ['0.45em', '0em'], delay: stagger(55) }, 0)
      .add(copy[0], { opacity: [0, 1], translateY: [16, 0], duration: 700 }, 260)
      .add(copy[1], { opacity: [0, 1], translateY: [16, 0], duration: 700 }, 340)
      .add(copy[2], { opacity: [0, 1], translateY: [12, 0], duration: 700 }, 420)
      .add(device[0], { opacity: [0, 1], translateY: [56, 0], duration: 1100 }, 300)
      .add(device[1], { opacity: [0, 1], translateY: [64, 0], duration: 1100 }, 460)
      .add(crew, { opacity: [0, 1], scale: [0.7, 1], duration: 800, delay: stagger(90) }, 700);
    // Reduced motion switched on mid-opening jumps it to the end.
    stops.push(() => tl.complete());
    tl.then(() => {
      [...words, ...copy, ...device, ...crew].forEach((el) => {
        el.removeAttribute('data-held');
        el.style.transform = ''; el.style.opacity = '';
      });
    });
  }

  /* ── The working app stands up as you scroll to it ─────────────────
     It starts tipped back, as if lying on the desk, and stands up as it
     reaches the middle of the screen. Wide screens only: on a phone it is
     the thing you touch, and a scaled-down stage would shrink its 48px
     tabs under the 44px minimum. */
  if (matchMedia('(min-width: 761px)').matches) {
    stops.push(scroll(
      mAnimate(stage, { transform: ['rotateX(14deg) scale(.95)', 'rotateX(0deg) scale(1)'] }, { ease: 'linear' }),
      { target: stage, offset: ['start end', 'center center'] }
    ));
  }

  /* ── Panels spring in as they arrive ───────────────────────────────── */
  panels.forEach((panel) => {
    stops.push(inView(panel, () => {
      mAnimate(panel, { opacity: [0, 1], transform: ['translateY(40px)', 'translateY(0px)'] },
        { type: spring, bounce: 0, duration: 0.7 })
        .then(() => { panel.removeAttribute('data-held'); panel.style.opacity = ''; panel.style.transform = ''; });
    }, { amount: 0.12 }));
  });

  /* ── The install command types itself, once ──────────────────────── */
  const cmd = $('#term-cmd');
  if (cmd && !late) {    // late: the command is already on screen, leave it
    // Cleared up front, or it would show whole for a moment and snap back;
    // the Copy button and the .sr-only copy always carry the whole command.
    const full = cmd.textContent;
    cmd.textContent = '';
    stops.push(inView(cmd, () => {
      const n = { c: 0 };
      aAnimate(n, { c: full.length, duration: 1500, ease: 'linear',
        onUpdate: () => { cmd.textContent = full.slice(0, Math.round(n.c)); },
        onComplete: () => { cmd.textContent = full; } });
    }, { amount: 0.6 }));
  }

  /* ── Printing ──────────────────────────────────────────────────────
     Paper has no scroll to reveal anything: the whole command goes in
     before the page is printed (home.css shows any panel still waiting). */
  window.addEventListener('beforeprint', () => {
    if (cmd) cmd.textContent = cmd.nextElementSibling.textContent;
  });

  /* ── Teardown if motion is switched off mid-visit ─────────────────── */
  REDUCE.addEventListener('change', () => {
    if (!REDUCE.matches) return;
    stops.forEach((s) => { try { typeof s === 'function' ? s() : s && s.stop && s.stop(); } catch (e) { /* already gone */ } });
    $$('#stage, .c-panel').forEach((el) => { el.style.transform = ''; });
    if (cmd) cmd.textContent = cmd.nextElementSibling.textContent;
    unhideAll();
  });

  window.__motionReady = true;
}

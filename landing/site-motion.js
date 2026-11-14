/* ── The home page, moving ────────────────────────────────────────────
   Everything here is extra. The page is complete without this file; it
   runs only when the visitor allows motion (the inline script in <head>
   decides, and holds the hero still until this takes over).

   Two libraries, one job each, so they never fight over an element:
     Anime.js — anything sequenced: the hero's opening, the voice stage's
                loop, the numbers counting, the command typing itself.
     Motion   — scroll and springs: the stage settling as it comes up,
                the bubbles drifting, tiles springing in, the hover lift.
   Both are vendored in vendor/ (see vendor/README.md). */

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

  /* ── Hero: the opening ─────────────────────────────────────────── */
  const words = splitText(h1, { words: { class: 'w' } }).words;
  words.forEach(hold);
  const intro = ['.hero .lede', '.hero-act', '.stage-wrap'].map((s) => hold($(s)));
  const tiles = $$('.st-tile', stage).map(hold);
  const slots = $$('.st-slot', stage);
  const bubbles = $$('.st-bubble', stage).map(hold);
  const ctrl = hold($('.st-ctrl', stage));
  const featureTiles = $$('#features .tile').map(hold);
  release();

  createTimeline({ defaults: { ease: 'outExpo', duration: 900 } })
    .add(words, { opacity: [0, 1], translateY: ['0.45em', '0em'], delay: stagger(55) }, 0)
    .add(intro[0], { opacity: [0, 1], translateY: [16, 0], duration: 700 }, 260)
    .add(intro[1], { opacity: [0, 1], translateY: [16, 0], duration: 700 }, 340)
    .add(intro[2], { opacity: [0, 1], translateY: [56, 0], duration: 1100 }, 380)
    .add(tiles, { opacity: [0, 1], scale: [0.9, 1], duration: 700, delay: stagger(60) }, 560)
    .add(ctrl, { opacity: [0, 1], duration: 500 }, 860)
    .add(bubbles, { opacity: [0, 1], scale: [0.86, 1], translateY: [10, 0], ease: 'outBack(1.6)', duration: 520, delay: stagger(180) }, 980)
    .then(() => {
      [...words, ...intro, ...tiles, ctrl, ...bubbles].forEach((el) => el.removeAttribute('data-held'));
      stops.push(stageLoop());
    });

  /* ── The stage settles as you scroll to it ─────────────────────────
     It starts tipped back, as if lying on the desk, and stands up as it
     reaches the middle of the screen. The bubbles drift a little faster
     than the stage, which is all the depth it needs. */
  stops.push(scroll(
    mAnimate(stage, { transform: ['rotateX(14deg) scale(.95)', 'rotateX(0deg) scale(1)'] }, { ease: 'linear' }),
    { target: stage, offset: ['start end', 'center center'] }
  ));
  slots.forEach((slot, i) => stops.push(scroll(
    mAnimate(slot, { transform: [`translateY(${i ? 40 : 28}px)`, `translateY(${i ? -40 : -28}px)`] }, { ease: 'linear' }),
    { target: stage, offset: ['start end', 'end start'] }
  )));

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
  const nums = $('.numbers');
  if (nums) {
    stops.push(inView(nums, () => {
      $$('[data-count]', nums).forEach((el, i) => {
        const to = +el.dataset.count;
        if (!to) return;
        const n = { v: 0 };
        el.textContent = '0';
        aAnimate(n, { v: to, duration: 1400, delay: i * 140, ease: 'outExpo',
          onUpdate: () => { el.textContent = String(Math.round(n.v)); } });
      });
    }, { amount: 0.5 }));
  }

  /* ── The install command types itself, once ──────────────────────── */
  const cmd = $('#term-cmd');
  if (cmd) {
    const full = cmd.textContent;
    stops.push(inView(cmd, () => {
      const n = { c: 0 };
      cmd.setAttribute('aria-label', full);     // the whole command, for anyone reading along
      aAnimate(n, { c: full.length, duration: 1500, ease: 'linear',
        onUpdate: () => { cmd.textContent = full.slice(0, Math.round(n.c)); },
        onComplete: () => { cmd.textContent = full; cmd.removeAttribute('aria-label'); } });
    }, { amount: 0.6 }));
  }

  /* ── Teardown if motion is switched off mid-visit ─────────────────── */
  REDUCE.addEventListener('change', () => {
    if (!REDUCE.matches) return;
    stops.forEach((s) => { try { typeof s === 'function' ? s() : s && s.stop && s.stop(); } catch (e) { /* already gone */ } });
    $$('#stage, .st-slot, #features .tile').forEach((el) => { el.style.transform = ''; });
    unhideAll();
  });

  window.__motionReady = true;

  /* ── The stage keeps talking ─────────────────────────────────────── */
  function stageLoop() {
    const people = $$('.st-tile:not(.st-share)', stage);
    const WHO = [
      { n: 'Ada', c: '#5865f2' }, { n: 'Max', c: '#23a55a' }, { n: 'Rin', c: '#eb459e' },
      { n: 'Jo', c: '#9b59b6' }, { n: 'Kai', c: '#e67e22' }
    ];
    const LINES = [
      'ok im in', 'two mins', 'brb kettle', 'who is dropping first', 'that was not my fault',
      'one more?', 'jo your mic is doing the thing', 'left at the bridge', 'nice', 'kai. the bridge.'
    ];
    let timers = [], running = false, turn = 0, lastLine = -1;

    function speak() {
      // Turn-taking: whoever is talking does not start again on top of themself.
      const quiet = people.filter((p) => !p.classList.contains('speaking') && p.dataset.who !== 'max');
      const p = quiet[Math.floor(Math.random() * quiet.length)];
      if (!p) return;
      p.classList.add('speaking');
      aAnimate($('.st-av', p), { scale: [1, 1.06, 1], duration: 520, ease: 'outQuad' });
      later(() => p.classList.remove('speaking'), 900 + Math.random() * 1800);
    }

    function post() {
      const slot = slots[turn++ % slots.length];
      const w = WHO[Math.floor(Math.random() * WHO.length)];
      let i = Math.floor(Math.random() * LINES.length);
      if (i === lastLine) i = (i + 1) % LINES.length;   // never the same line twice running
      lastLine = i;
      const old = $('.st-bubble', slot);
      const el = document.createElement('div');
      el.className = 'st-bubble';
      el.innerHTML = `<span class="st-av" style="--c:${w.c}">${w.n[0]}</span><p><b>${w.n}</b> ${LINES[i]}</p>`;
      el.style.opacity = '0';
      if (old) {
        old.classList.add('leaving');
        aAnimate(old, { opacity: 0, translateY: -10, scale: 0.96, duration: 180, ease: 'inQuad',
          onComplete: () => old.remove() });
      }
      slot.appendChild(el);
      aAnimate(el, { opacity: [0, 1], scale: [0.86, 1], translateY: [12, 0], duration: 520, delay: 120, ease: 'outBack(1.6)' });
    }

    function later(fn, ms) { const t = setTimeout(fn, ms); timers.push(t); return t; }
    function every(fn, ms) { const t = setInterval(fn, ms); timers.push(t); return t; }
    function run() { if (running) return; running = true; every(speak, 2200); every(post, 4600); }
    function stop() { running = false; timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; }

    // Only while someone can see it: on screen, in a visible tab.
    let onScreen = false;
    const io = new IntersectionObserver((e) => {
      onScreen = e[0].isIntersecting;
      onScreen && !document.hidden ? run() : stop();
    }, { threshold: 0.2 });
    io.observe(stage);
    const vis = () => (document.hidden || !onScreen ? stop() : run());
    document.addEventListener('visibilitychange', vis);

    return () => { stop(); io.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }
}

/* ── The page ──────────────────────────────────────────────────────────
   Scroll reveals, parallax, the sticky bar, the cat, and the ambient life
   inside the hero's product shot. Demos live in demos.js. */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.documentElement.classList.add('js');

  /* ── Reveal on scroll ───────────────────────────────────────────────
     Siblings that come into view together are staggered, because a row
     of things appearing at the same instant reads as a page repaint
     rather than as arrival. */
  (function reveals() {
    var items = $$('.reveal');
    if (!items.length) return;
    if (REDUCE.matches || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('seen'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      // Group what arrives in the same callback, top to bottom.
      var arriving = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      arriving.forEach(function (e, i) {
        e.target.style.setProperty('--d', Math.min(i, 4) * 60 + 'ms');
        e.target.classList.add('seen');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  })();

  /* ── Sticky bar gains its seam only once you have left the top ────── */
  (function stickyBar() {
    var bar = $('#topbar');
    if (!bar) return;
    var sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
    document.body.prepend(sentinel);
    new IntersectionObserver(function (e) {
      bar.classList.toggle('stuck', !e[0].isIntersecting);
    }).observe(sentinel);
  })();

  /* ── Parallax ───────────────────────────────────────────────────────
     Decorative only, so it is the first thing to go under reduced
     motion. Read scroll in the rAF, never in the listener. */
  (function parallax() {
    var els = $$('[data-par]');
    if (!els.length || REDUCE.matches) return;
    var ticking = false;
    function frame() {
      var y = window.scrollY;
      els.forEach(function (el) {
        el.style.transform = 'translate3d(0,' + (y * parseFloat(el.dataset.par)).toFixed(1) + 'px,0)';
      });
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(frame); }
    }, { passive: true });
    frame();
  })();

  /* ── The cat watches your cursor ────────────────────────────────── */
  window.SkycordCat = (function () {
    /* Looked up per call, not captured once: on the roadmap and changelog
       pages the top bar is injected on DOMContentLoaded, after this file
       has already run, so a captured list would be permanently empty and
       the cat silently dead. */
    function marks() { return $$('.brand-mark'); }

    function aim(cx, cy) {
      if (REDUCE.matches) return;
      marks().forEach(function (m) {
        var eyes = $('.eyes', m);
        if (!eyes) return;
        var r = m.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;   // off-screen: skip the work
        var dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var reach = Math.min(1, d / 300) * 13;             // in the 256 viewBox
        eyes.setAttribute('transform', 'translate(' + (dx / d * reach).toFixed(2) + ' ' + (dy / d * reach).toFixed(2) + ')');
      });
    }
    document.addEventListener('pointermove', function (e) { aim(e.clientX, e.clientY); }, { passive: true });

    // Delegated, for the same reason: the mark may not exist yet.
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      var m = a && $('.brand-mark', a);
      if (!m) return;
      m.classList.remove('boop'); void m.offsetWidth; m.classList.add('boop');
      setTimeout(function () { m.classList.remove('boop'); }, 440);
    });
    (function blink() {
      setTimeout(function () {
        var all = marks();
        if (all.length && !document.hidden && !REDUCE.matches) {
          all.forEach(function (m) { m.classList.add('blink'); });
          setTimeout(function () { all.forEach(function (m) { m.classList.remove('blink'); }); }, 200);
        }
        blink();
      }, 2800 + Math.random() * 5000);
    })();

    return { aim: aim };
  })();

  /* ── Copy the install command ───────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    navigator.clipboard.writeText(b.dataset.copy).then(function () {
      var label = $('span', b), was = label.textContent;
      b.classList.add('done');
      label.textContent = 'Copied';
      clearTimeout(b._t);
      b._t = setTimeout(function () { b.classList.remove('done'); label.textContent = was; }, 1800);
    }).catch(function () { /* nothing to do; the command is on screen */ });
  });

  /* ── The hero shot is alive ─────────────────────────────────────────
     Not a screenshot: someone is talking, and messages keep arriving.
     It is the first thing on the page, so it has to hold up. */
  (function heroLife() {
    if (REDUCE.matches) return;
    var members = $$('.w-vm');
    var msgs = $('#w-msgs');
    if (!members.length || !msgs) return;

    var running = false, timers = [];
    function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
    function clearAll() { timers.forEach(clearInterval); timers = []; }

    var WHO = [
      { n: 'Ada', c: '#5865f2', i: 'A' },
      { n: 'Max', c: '#23a55a', i: 'M' },
      { n: 'Kai', c: '#e67e22', i: 'K' }
    ];
    var LINES = [
      'ok im in', 'two mins', 'brb kettle', 'who is dropping first',
      'screen share is up', 'that was not my fault', 'one more?', 'lounge is open'
    ];
    var n = 0, lastLine = -1;

    function speak() {
      // Turn-taking: whoever spoke last does not go again immediately.
      var pool = members.filter(function (m) { return !m.classList.contains('speaking'); });
      if (!pool.length) return;
      var m = pool[Math.floor(Math.random() * pool.length)];
      m.classList.add('speaking');
      setTimeout(function () { m.classList.remove('speaking'); }, 800 + Math.random() * 1700);
    }

    function post() {
      var w = WHO[n++ % WHO.length];
      // Never the same line twice running — two people saying the exact
      // same thing back to back is the tell that it is generated.
      var i = Math.floor(Math.random() * LINES.length);
      if (i === lastLine) i = (i + 1) % LINES.length;
      lastLine = i;
      var el = document.createElement('div');
      el.className = 'w-msg new';
      el.innerHTML = '<span class="w-av" style="background:' + w.c + '">' + w.i + '</span>' +
        '<div><span class="w-who">' + w.n + '</span> <span class="w-t">now</span>' +
        '<p>' + LINES[i] + '</p></div>';
      msgs.appendChild(el);
      // Next frame, so the transition has a start value to move from.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { el.classList.remove('new'); });
      });
      while (msgs.children.length > 4) msgs.removeChild(msgs.firstElementChild);
    }

    function start() {
      if (running) return;
      running = true;
      every(speak, 2200);
      every(post, 4600);
    }
    function stop() { running = false; clearAll(); }

    new IntersectionObserver(function (e) {
      if (e[0].isIntersecting && !document.hidden) start(); else stop();
    }, { threshold: 0.2 }).observe($('#shot'));

    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
    REDUCE.addEventListener('change', function () { if (REDUCE.matches) stop(); });
  })();
})();

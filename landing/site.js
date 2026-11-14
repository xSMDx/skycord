/* ── The page ──────────────────────────────────────────────────────────
   Scroll reveals, parallax, the sticky bar, the cat and the install copy
   button: what works with or without motion. Demos live in demos.js; the
   home page's choreography lives in site-motion.js. */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.documentElement.classList.add('js');

  /* ── The download that fits this visitor ───────────────────────────
     The main button follows the visitor's system. Windows keeps the
     Windows app, and Linux gets the Linux one from the same releases. An
     Android phone gets the Android app instead. Where there is no app yet
     (Mac, ChromeOS, iPhone, iPad) the download goes and the browser
     becomes the main way in. With no script, or on
     a system it cannot name, the page stays as written: Windows first.
     Runs before the reveals, which keep these rows hidden until then, so
     the swap is never seen. Android is tested before Linux because its
     user agent says Linux too; an iPad asking for the desktop site calls
     itself a Macintosh, and only its touch points give it away. */
  (function platformCta() {
    var ua = navigator.userAgent || '';
    var os = /Android/i.test(ua) ? 'android'
      : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? 'ios'
      : /Windows/i.test(ua) ? 'windows'
      : /CrOS/i.test(ua) ? 'chromeos'
      : /Macintosh|Mac OS X/i.test(ua) ? 'mac'
      : /Linux|X11/i.test(ua) ? 'linux'
      : null;
    document.documentElement.setAttribute('data-os', os || 'unknown');
    if (!os || os === 'windows') return;
    $$('[data-dl]').forEach(function (a) {
      var label = $('[data-dl-label]', a);
      if (os === 'android') {
        a.href = 'https://github.com/xSMDx/skycord-android-releases/releases/latest';
        if (label) label.textContent = 'Download for Android (beta)';
        return;
      }
      // The desktop releases carry the Linux AppImage and .deb beside the
      // Windows installer, so the link stays; only the label changes.
      if (os === 'linux') {
        a.href = 'https://github.com/xSMDx/skycord-desktop-releases/releases/latest';
        if (label) label.textContent = 'Download for Linux';
        return;
      }
      // No app for this system: the browser button takes the download's place and weight.
      var web = a.parentNode && $('[data-web]', a.parentNode);
      if (web) { web.classList.remove('ghost'); web.classList.add('primary'); }
      a.parentNode.removeChild(a);
    });
  })();

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

  /* ── Pause the feature marquee ──────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.band-pause');
    if (!b) return;
    var on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Play the scrolling list' : 'Pause the scrolling list');
    b.closest('.band').classList.toggle('paused', on);
  });

  /* The hero's voice stage, and every other moving part of the home page,
     live in site-motion.js, which loads only when motion is allowed. */
})();

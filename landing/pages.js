/* ── Roadmap and changelog rendering ───────────────────────────────────
   Shared chrome (sprite, top bar, footer) plus whichever feed the page
   asks for. Content comes from content.js, which is lifted from the
   app-shell page so both stay in step. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var SPRITE =
    '<symbol id="i-mark" viewBox="0 0 256 256"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" d="M24,64a24,24,0,0,1,48,0H184a24,24,0,0,1,48,0v80a64,64,0,0,1-64,64H88a64,64,0,0,1-64-64Z"/><g class="eyes"><circle class="eye" cx="92" cy="140" r="13" fill="currentColor"/><circle class="eye" cx="164" cy="140" r="13" fill="currentColor"/></g></symbol>' +
    '<symbol id="i-chevron" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></symbol>';

  var BRAND =
    '<a class="brand" href="/" aria-label="Skycord">' +
      '<span class="brand-mark"><svg viewBox="0 0 256 256" aria-hidden="true">' +
        // Inlined, not <use>: shadow content is unreachable to both
        // querySelector and CSS, which silently kills the eye tracking.
        '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" d="M24,64a24,24,0,0,1,48,0H184a24,24,0,0,1,48,0v80a64,64,0,0,1-64,64H88a64,64,0,0,1-64-64Z"/>' +
        '<g class="eyes"><circle class="eye" cx="92" cy="140" r="13" fill="currentColor"/>' +
        '<circle class="eye" cx="164" cy="140" r="13" fill="currentColor"/></g></svg></span><b>Skycord</b>' +
    '</a>';

  function chrome(active) {
    // insertAdjacentHTML, not createElement('svg'): createElement makes an
    // HTML element called "svg" in the wrong namespace, and <use> then
    // resolves to nothing. Parsing markup puts it in the SVG namespace.
    document.body.insertAdjacentHTML('afterbegin',
      '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' + SPRITE + '</svg>');

    var links = [
      ['/#features', 'Features'], ['/#selfhost', 'Self-host'],
      ['/roadmap/', 'Roadmap'], ['/changelog/', 'Changelog'],
      ['https://github.com/xSMDx/skycord', 'Source']
    ];
    var bar = $('#topbar');
    if (bar) {
      bar.innerHTML = '<div class="shell bar">' + BRAND +
        '<nav class="links" aria-label="Sections">' +
          links.map(function (l) {
            return '<a href="' + l[0] + '"' + (l[1].toLowerCase() === active ? ' aria-current="page"' : '') + '>' + l[1] + '</a>';
          }).join('') +
        '</nav><a class="btn pill" href="https://app.skycord.xyz">Open Skycord</a></div>';
    }
    var foot = $('#foot');
    if (foot) {
      foot.innerHTML = '<div class="shell foot-in">' + BRAND +
        '<nav aria-label="Footer">' +
          '<a href="https://app.skycord.xyz">Open the app</a><a href="/#selfhost">Self-host</a>' +
          '<a href="/roadmap/">Roadmap</a><a href="/changelog/">Changelog</a>' +
          '<a href="https://github.com/xSMDx/skycord" rel="noopener">Source</a>' +
        '</nav><span class="foot-note">Built by SMD · AGPL</span></div>';
    }
  }

  /* ── Roadmap ─────────────────────────────────────────────────────── */
  var STAGES = [['now', 'Building now'], ['next', 'Next up'], ['idea', 'Being looked at'], ['shipped', 'Live now']];

  function renderRoadmap(host) {
    var data = window.SKYCORD_ROADMAP || [];
    host.innerHTML = STAGES.map(function (st) {
      var cards = data.filter(function (r) { return r.stage === st[0]; });
      if (!cards.length) return '';
      return '<section class="stage">' +
        '<h2 class="stage-title" data-stage="' + st[0] + '"><span class="dot"></span>' + st[1] + '</h2>' +
        '<div class="rm-grid">' + cards.map(function (r) {
          return '<article class="rm-card"><h3>' + r.title + '</h3><ul>' +
            r.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') +
          '</ul></article>';
        }).join('') + '</div></section>';
    }).join('');
  }

  /* ── Changelog ───────────────────────────────────────────────────── */
  var KIND = { add: 'Added', imp: 'Improved', fix: 'Fixed' };

  function renderChangelog(host) {
    var data = window.SKYCORD_RELEASES || [];
    host.innerHTML = data.map(function (r, n) {
      var id = 'rel-' + n, open = n === 0;
      return '<article class="rel">' +
        '<div class="rel-top"><span class="ver">' + r.v + '</span>' +
        '<span class="rel-title">' + r.title + '</span>' +
        '<span class="rel-date">' + r.date + (r.time ? ' · ' + r.time : '') + '</span></div>' +
        '<button class="rel-toggle" type="button" aria-expanded="' + open + '" aria-controls="' + id + '">' +
          '<span>' + (open ? 'Hide' : 'Show') + ' ' + r.items.length + ' change' + (r.items.length === 1 ? '' : 's') + '</span>' +
          '<svg aria-hidden="true"><use href="#i-chevron"/></svg>' +
        '</button>' +
        '<ul class="changes" id="' + id + '"' + (open ? '' : ' hidden') + '>' +
          r.items.map(function (c) {
            return '<li><span class="kind ' + c[0] + '">' + KIND[c[0]] + '</span><span>' + c[1] + '</span></li>';
          }).join('') +
        '</ul></article>';
    }).join('');

    host.addEventListener('click', function (e) {
      var b = e.target.closest('.rel-toggle');
      if (!b) return;
      var list = document.getElementById(b.getAttribute('aria-controls'));
      var open = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!open));
      list.hidden = open;
      var n = list.children.length;
      $('span', b).textContent = (open ? 'Show' : 'Hide') + ' ' + n + ' change' + (n === 1 ? '' : 's');
    });
  }

  function mount() {
    var rm = $('#roadmap-feed'), cl = $('#changelog-feed');
    chrome(rm ? 'roadmap' : 'changelog');
    if (rm) renderRoadmap(rm);
    if (cl) renderChangelog(cl);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

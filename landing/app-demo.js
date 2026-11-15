/* ── The mini app ──────────────────────────────────────────────────────
   State for the working Skycord in the hero: servers, channels, the
   composer, joining and leaving a call, mute / deafen / camera / share,
   and a settings modal with real tabs. Also the gliding indicator under
   every segmented control on the page.

   Plain script, no libraries: it works with reduced motion (states still
   change, nothing travels) and if the animation libraries never load. The
   transitions themselves are CSS (mini.css), so every one of them can be
   interrupted mid-way. Ambient life — people talking, messages arriving —
   runs only when motion is allowed, on screen, in a visible tab. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── Gliding indicators ─────────────────────────────────────────── */
  // The indicator takes its new size at once, then glides there on
  // transform alone (FLIP): it starts drawn where it visually is now —
  // mid-glide included, so a fast second click retargets smoothly — scaled
  // to the old size, and settles at scale 1. No width or height animates.
  function place(ind, el, instant) {
    if (!ind || !el || !el.offsetWidth) return;
    var x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
    var was = ind.offsetWidth, glide = !instant && was && !REDUCE.matches && ind.animate;
    if (glide) {
      var m = new DOMMatrix(getComputedStyle(ind).transform);
      var x0 = m.e, y0 = m.f, w0 = was * m.a, h0 = ind.offsetHeight * m.d;
    }
    if (ind._glide) ind._glide.cancel();
    ind.style.width = w + 'px';
    ind.style.height = h + 'px';
    ind.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (!glide || (x0 === x && y0 === y && w0 === w && h0 === h)) return;
    ind._glide = ind.animate([
      { transform: 'translate(' + x0 + 'px,' + y0 + 'px) scale(' + (w0 / w) + ',' + (h0 / h) + ')' },
      { transform: 'translate(' + x + 'px,' + y + 'px)' }
    ], { duration: 240, easing: 'cubic-bezier(.32,.72,0,1)' });
  }
  // Every segmented control on the page (the demos' and the mini app's):
  // the selected fill glides instead of blinking from one option to the next.
  var segs = $$('.seg').map(function (seg) {
    var ind = document.createElement('i');
    ind.className = 'seg-ind'; ind.setAttribute('aria-hidden', 'true');
    seg.insertBefore(ind, seg.firstChild);
    seg.classList.add('glide');
    var sync = function (instant) { place(ind, $('.seg-b.on', seg), instant); };
    new MutationObserver(function () { sync(false); }).observe(seg, { subtree: true, attributes: true, attributeFilter: ['class'] });
    sync(true);
    return sync;
  });
  window.addEventListener('resize', function () { segs.forEach(function (s) { s(true); }); placeTabs(true); placeSetInd(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { segs.forEach(function (s) { s(true); }); placeTabs(true); });

  var mini = $('#mini');
  if (!mini) return;

  /* ── Data: who, where, what was said ────────────────────────────── */
  var P = {
    ada: { n: 'Ada', c: '#5865f2' }, max: { n: 'Max', c: '#23a55a' }, kai: { n: 'Kai', c: '#e67e22' },
    rin: { n: 'Rin', c: '#eb459e' }, jo: { n: 'Jo', c: '#9b59b6' }
  };
  var SERVERS = {
    crew:  { name: 'The Crew',    text: ['general', 'gaming'],    voice: 'lounge' },
    owls:  { name: 'Night Owls',  text: ['books', 'late-night'],  voice: 'study' },
    fives: { name: 'Five-a-side', text: ['matchday', 'lineups'],  voice: 'pitch' }
  };
  var VIEWS = {
    general:  { topic: 'evenings, mostly', msgs: [['kai', 'anyone up for a round'], ['max', 'im in, joining the lounge'], ['ada', 'two secs, putting the kettle on']] },
    gaming:   { topic: 'clips and complaints', msgs: [['jo', 'new patch is out'], ['kai', 'they nerfed my whole personality'], ['rin', 'good'], ['max', 'lounge tonight?']] },
    books:    { topic: 'one chapter a week', msgs: [['rin', 'finished chapter 4'], ['ada', 'no spoilers, im on 2'], ['jo', 'the lighthouse bit though']] },
    'late-night': { topic: 'quiet hours', msgs: [['jo', 'anyone else awake'], ['rin', 'always'], ['ada', 'tea and one more episode']] },
    matchday: { topic: 'thursdays, 7pm', msgs: [['max', 'pitch is booked'], ['kai', 'who has the bibs'], ['jo', 'me. washed. mostly']] },
    lineups:  { topic: 'who plays where', msgs: [['ada', 'keeper rota is up'], ['max', 'not me again']] },
    lounge:   { voice: true, label: 'Lounge', people: ['ada', 'kai', 'max', 'rin', 'jo'], muted: ['max'], share: 'kai' },
    study:    { voice: true, label: 'Study Room', people: ['rin', 'ada'], muted: [], share: null },
    pitch:    { voice: true, label: 'Pitch side', people: [], muted: [], share: null }
  };
  var REPLIES = ['ha', 'same', 'on my way', 'say that in the lounge', 'welcome back', 'who is this', 'big if true', 'kettle is on', 'noted', 'fair'];
  var AMBIENT = ['brb', 'ok im in', 'two mins', 'who is dropping first', 'that was not my fault', 'one more?', 'jo your mic is doing the thing', 'nice', 'left at the bridge'];

  var S = { server: 'crew', view: 'general', call: null, muted: false, deaf: false, cam: false, share: false, seen: { general: 1 } };

  var side = $('#m-side'), channels = $('#m-channels'), serverName = $('#m-server-name');
  var textView = $('#m-text'), voiceView = $('#m-voice'), msgs = $('#m-msgs'), typing = $('#m-typing');
  var form = $('#m-form'), input = $('#m-input');
  var headIc = $('#m-head-ic use'), headName = $('#m-head-name'), headTopic = $('#m-head-topic'), headCount = $('#m-head-count');
  var tabs = $('#m-tabs'), tabInd = $('.m-tab-ind', tabs);
  var cbStage = $('#m-cb-stage'), share = $('#m-share'), shareWho = $('#m-share-who');
  var modal = $('#m-modal'), setNav = $('#m-set-nav'), setInd = $('.m-set-ind', setNav);

  function av(cls, who, you) {
    var p = you ? { n: 'you', c: 'var(--accent)' } : P[who];
    return '<span class="' + cls + '" style="--c:' + p.c + '">' + (you ? 'Y' : p.n[0]) + '</span>';
  }
  function now() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function people(v) { var l = VIEWS[v].people.slice(); if (S.call === v) l.push('you'); return l; }
  function flash(el) {   // a quiet crossfade for text that changes in place
    if (!el || REDUCE.matches || !el.animate) return;
    el.animate([{ opacity: 0, transform: 'translateY(-2px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.32,.72,0,1)' });
  }

  /* ── Channel list ───────────────────────────────────────────────── */
  function occList(v) {
    return people(v).map(function (w) {
      var you = w === 'you', d = VIEWS[v];
      return '<li class="vc-occ' + (you ? ' you' : '') + (!you && d.muted.indexOf(w) > -1 ? ' muted' : '') + '" data-who="' + w + '">' +
        av('vc-av', w, you) + (you ? 'you' : P[w].n) +
        (!you && d.share === w ? '<span class="vc-live">LIVE</span>' : '') +
        ((!you && d.muted.indexOf(w) > -1) || (you && (S.muted || S.deaf)) ? '<svg class="vc-ic" aria-label="muted"><use href="#i-mic-off"/></svg>' : '') +
        '</li>';
    }).join('');
  }
  function renderSide() {
    var sv = SERVERS[S.server];
    serverName.textContent = sv.name;
    channels.innerHTML = '<div class="ch-group-label">Text channels</div>' +
      sv.text.map(function (c) {
        return '<button class="ch-item' + (c === S.view || S.seen[c] ? '' : (c === 'gaming' || c === 'late-night' ? ' unread' : '')) + '" type="button" data-ch="' + c + '"' + (c === S.view ? ' aria-current="true"' : '') + '><svg aria-hidden="true"><use href="#i-hash"/></svg>' + c + '</button>';
      }).join('') +
      '<div class="ch-group-label">Voice channels</div>' +
      '<button class="ch-item voice" type="button" data-ch="' + sv.voice + '"' + (sv.voice === S.view ? ' aria-current="true"' : '') + '><svg aria-hidden="true"><use href="#i-volume"/></svg>' + VIEWS[sv.voice].label + '</button>' +
      '<ul class="vc-list" data-occ="' + sv.voice + '">' + occList(sv.voice) + '</ul>';
  }
  function renderTabs() {
    var sv = SERVERS[S.server];
    var list = sv.text.concat(sv.voice);
    $$('.m-tab', tabs).forEach(function (t) { t.remove(); });
    var gear = $('.m-tab-gear', tabs);
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'm-tab'; b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.ch = c;
      b.setAttribute('aria-selected', String(c === S.view));
      b.textContent = VIEWS[c].voice ? VIEWS[c].label : '# ' + c;
      tabs.insertBefore(b, gear);
    });
  }
  function placeTabs(instant) { place(tabInd, $('.m-tab[aria-selected="true"]', tabs), instant); }
  function markCurrent() {
    $$('.ch-item', channels).forEach(function (b) {
      var on = b.dataset.ch === S.view;
      if (on) { b.setAttribute('aria-current', 'true'); b.classList.remove('unread'); } else b.removeAttribute('aria-current');
    });
    $$('.m-tab', tabs).forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.ch === S.view)); });
    placeTabs(false);
  }

  /* ── Views ──────────────────────────────────────────────────────── */
  function msgHtml(m, i, you) {
    var w = m[0];
    return '<div class="msg' + (you ? ' you' : '') + '" style="--stagger:' + (i * 35) + 'ms">' + av('msg-av', w, you) +
      '<div class="msg-body"><span class="msg-name">' + (you ? 'you' : P[w].n) + '</span><span class="msg-ts">' + (m[2] || ('21:0' + (2 + i))) + '</span><p></p></div></div>';
  }
  function renderMsgs(v) {
    var list = VIEWS[v].msgs;
    msgs.innerHTML = list.map(function (m, i) { return msgHtml(m, i, m[0] === 'you'); }).join('');
    $$('.msg p', msgs).forEach(function (p, i) { p.textContent = list[i][1]; });   // text, never HTML
  }
  function post(who, text, view) {
    view = view || S.view;
    var you = who === 'you';
    VIEWS[view].msgs.push([who, text, now()]);
    if (VIEWS[view].msgs.length > 12) VIEWS[view].msgs.shift();
    if (view !== S.view || VIEWS[view].voice) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = msgHtml([who, text, now()], 0, you);
    var el = wrap.firstChild;
    $('p', el).textContent = text;
    msgs.appendChild(el);
    while (msgs.children.length > 9) msgs.removeChild(msgs.firstElementChild);
  }
  function renderCall(v) {
    var d = VIEWS[v];
    cbStage.innerHTML = people(v).map(function (w) {
      var you = w === 'you', muted = you ? (S.muted || S.deaf) : d.muted.indexOf(w) > -1;
      return '<div class="cb-tile' + (you ? ' you' : '') + (muted ? ' muted' : '') + '" data-who="' + w + '">' +
        '<span class="cb-av" style="--c:' + (you ? 'var(--accent)' : P[w].c) + '">' + (you ? 'Y' : P[w].n[0]) +
        '<span class="cb-mute"><svg aria-hidden="true"><use href="#i-mic-off"/></svg></span></span>' +
        '<span class="cb-name">' + (you ? 'you' : P[w].n) + '</span></div>';
    }).join('');
    syncShare();
  }
  function syncShare() {
    var v = S.call && VIEWS[S.call], who = S.share ? 'you' : (v && v.share);
    share.hidden = !who;
    share.classList.toggle('yours', who === 'you');
    if (who) shareWho.textContent = who === 'you' ? 'you' : P[who].n;
  }
  function header() {
    var d = VIEWS[S.view];
    headIc.setAttribute('href', d.voice ? '#i-volume' : '#i-hash');
    headName.textContent = d.voice ? d.label : S.view;
    headTopic.textContent = d.voice ? '' : d.topic;
    headTopic.hidden = !!d.voice;
    headCount.hidden = !d.voice;
    if (d.voice) headCount.textContent = people(S.view).length + ' in voice';
    flash(headName.parentNode);
  }
  function show(v) {
    var wasVoice = VIEWS[S.view] && VIEWS[S.view].voice;
    S.view = v;
    S.seen[v] = 1;
    var d = VIEWS[v];
    if (d.voice) {
      if (S.call !== v) join(v);
      textView.hidden = true;
      voiceView.hidden = false;
      renderCall(v);
    } else {
      voiceView.hidden = true;
      if (textView.hidden || wasVoice) textView.hidden = false;
      renderMsgs(v);
      input.placeholder = 'Message #' + v;   // the app's own wording
    }
    header();
    markCurrent();
  }

  /* ── Calls ──────────────────────────────────────────────────────── */
  function join(v) {
    S.call = v;
    mini.classList.add('in-call');
    $('#m-vcp-where').textContent = VIEWS[v].label + ' / ' + SERVERS[serverOf(v)].name;
    var vcp = $('#m-vcp'); vcp.removeAttribute('aria-hidden'); $('button', vcp).tabIndex = 0;
    refreshOcc();
  }
  function leave() {
    var was = S.call;
    if (!was) return;
    S.call = null; S.share = false; S.cam = false;
    mini.classList.remove('in-call');
    var vcp = $('#m-vcp'); vcp.setAttribute('aria-hidden', 'true'); $('button', vcp).tabIndex = -1;
    sync();
    // The "you" row leaves quickly; the rest of the list stays put.
    var row = $('.vc-occ.you', channels);
    if (row && row.animate && !REDUCE.matches) {
      row.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-8px)' }], { duration: 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
        .onfinish = refreshOcc;
    } else refreshOcc();
    if (VIEWS[S.view].voice) show(SERVERS[S.server].text[0]);
  }
  function serverOf(v) { for (var k in SERVERS) if (SERVERS[k].voice === v || SERVERS[k].text.indexOf(v) > -1) return k; }
  function refreshOcc() {
    var ul = $('.vc-list', channels);
    if (!ul) return;
    var v = ul.dataset.occ;
    // Keep existing rows (so only a newcomer animates in), add or drop the rest.
    var want = people(v), have = $$('.vc-occ', ul).map(function (li) { return li.dataset.who; });
    if (want.join() === have.join()) { syncOccIcons(); return; }
    ul.innerHTML = occList(v);
  }
  function syncOccIcons() {
    var row = $('.vc-occ.you', channels);
    if (!row) return;
    var ic = $('.vc-ic', row), m = S.muted || S.deaf;
    if (m && !ic) row.insertAdjacentHTML('beforeend', '<svg class="vc-ic" aria-label="muted"><use href="#i-mic-off"/></svg>');
    if (!m && ic) ic.remove();
  }
  function sync() {
    var m = S.muted || S.deaf;
    $$('[data-act="mute"]', mini).forEach(function (b) { b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', m ? 'Unmute' : 'Mute'); });
    $$('[data-act="deafen"]', mini).forEach(function (b) { b.setAttribute('aria-pressed', String(S.deaf)); b.setAttribute('aria-label', S.deaf ? 'Undeafen' : 'Deafen'); });
    $$('[data-act="cam"]', mini).forEach(function (b) { b.setAttribute('aria-pressed', String(S.cam)); });
    $$('[data-act="share"]', mini).forEach(function (b) { b.setAttribute('aria-pressed', String(S.share)); });
    mini.classList.toggle('deafened', S.deaf);
    var tile = $('.cb-tile.you', cbStage);
    if (tile) tile.classList.toggle('muted', m);
    syncOccIcons();
    syncShare();
  }

  /* ── Server rail ────────────────────────────────────────────────── */
  var swapT;
  function switchServer(id) {
    if (id === S.server || !SERVERS[id]) return;
    $$('.ri[data-server-btn]', mini).forEach(function (b) {
      if (b.dataset.serverBtn === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    var badge = $('.ri[data-server-btn="' + id + '"] .ri-badge', mini);
    if (badge) badge.classList.add('gone');
    S.server = id;
    var first = SERVERS[id].text[0];
    // Out quickly, in on the house curve.
    side.classList.add('out');
    clearTimeout(swapT);
    swapT = setTimeout(function () {
      S.view = first;
      renderSide(); renderTabs();
      side.classList.remove('out');
      show(first);
      placeTabs(true);
    }, REDUCE.matches ? 0 : 140);
  }

  /* ── Settings modal ─────────────────────────────────────────────── */
  var lastFocus = null, closeT;
  function placeSetInd(instant) { place(setInd, $('.m-set-tab[aria-selected="true"]', setNav), instant); }
  function openSettings(from) {
    lastFocus = from || document.activeElement;
    clearTimeout(closeT);
    modal.classList.remove('closing');
    modal.hidden = false;
    placeSetInd(true);
    segs.forEach(function (s) { s(true); });
    $('.m-set-tab[aria-selected="true"]', setNav).focus({ preventScroll: true });
  }
  function closeSettings() {
    if (modal.hidden) return;
    modal.classList.add('closing');
    closeT = setTimeout(function () { modal.hidden = true; modal.classList.remove('closing'); }, REDUCE.matches ? 0 : 140);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function pickTab(tab) {
    $$('.m-set-tab', setNav).forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
    $$('.m-page', modal).forEach(function (p) { p.hidden = p.dataset.page !== tab.dataset.page; });
    placeSetInd(false);
    segs.forEach(function (s) { s(true); });
  }

  /* ── Wiring ─────────────────────────────────────────────────────── */
  mini.addEventListener('click', function (e) {
    var t = e.target;
    var sb = t.closest('[data-server-btn]'); if (sb) return switchServer(sb.dataset.serverBtn);
    var ch = t.closest('[data-ch]'); if (ch) { if (ch.dataset.ch !== S.view) show(ch.dataset.ch); return; }
    var tab = t.closest('.m-set-tab'); if (tab) return pickTab(tab);
    var seg = t.closest('.mini .seg-b');
    if (seg) {
      $$('.seg-b', seg.parentNode).forEach(function (b) { b.classList.toggle('on', b === seg); });
      if (seg.dataset.themePick) mini.dataset.mtheme = seg.dataset.themePick;
      if (seg.dataset.density) mini.dataset.density = seg.dataset.density;
      return;
    }
    if (t === modal) return closeSettings();
    var act = t.closest('[data-act]'); if (!act) return;
    switch (act.dataset.act) {
      case 'mute': if (S.deaf) { S.deaf = false; S.muted = false; } else S.muted = !S.muted; sync(); break;
      case 'deafen': S.deaf = !S.deaf; sync(); break;
      case 'cam': S.cam = !S.cam; sync(); break;
      case 'share': S.share = !S.share; sync(); break;
      case 'leave': leave(); break;
      case 'settings': openSettings(act); break;
      case 'close': closeSettings(); break;
    }
  });

  input.addEventListener('input', function () { form.classList.toggle('has-text', !!input.value.trim()); });
  var replyT = [];
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    post('you', text);
    input.value = ''; form.classList.remove('has-text');
    // Somebody answers, the way they do.
    var view = S.view, crew = Object.keys(P), who = crew[Math.floor(Math.random() * crew.length)];
    replyT.forEach(clearTimeout);
    replyT = [
      setTimeout(function () { if (S.view === view) { $('span', typing).textContent = P[who].n + ' is typing…'; typing.classList.add('on'); } }, 700),
      setTimeout(function () { typing.classList.remove('on'); post(who, REPLIES[Math.floor(Math.random() * REPLIES.length)], view); }, 1900)
    ];
  });

  // Keyboard: arrows move along a tab list; Escape closes; Tab stays in the modal.
  mini.addEventListener('keydown', function (e) {
    if (!modal.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeSettings(); return; }
      if (e.key === 'Tab') {
        var f = $$('button:not([tabindex="-1"]), input', modal).filter(function (el) { return el.offsetParent !== null; });
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      var cur = e.target.closest('.m-set-tab');
      if (cur && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
        e.preventDefault();
        var all = $$('.m-set-tab', setNav), i = all.indexOf(cur), step = /Down|Right/.test(e.key) ? 1 : -1;
        var next = all[(i + step + all.length) % all.length];
        pickTab(next); next.focus();
      }
    }
  });

  /* ── Ambient life: only when motion is allowed and someone can see it ─ */
  var timers = [], running = false, onScreen = false;
  function speakTick() {
    var v = S.call || SERVERS[S.server].voice;
    var who = people(v).filter(function (w) { return w !== 'you' && VIEWS[v].muted.indexOf(w) < 0; });
    if (!who.length) return;
    var w = who[Math.floor(Math.random() * who.length)];
    var rows = $$('.vc-occ[data-who="' + w + '"], .cb-tile[data-who="' + w + '"]', mini);
    if (rows.some(function (r) { return r.classList.contains('speaking'); })) return;
    rows.forEach(function (r) { r.classList.add('speaking'); });
    timers.push(setTimeout(function () { rows.forEach(function (r) { r.classList.remove('speaking'); }); }, 900 + Math.random() * 1600));
  }
  function chatTick() {
    if (document.activeElement === input || !modal.hidden) return;   // never talk over someone typing
    var v = S.view;
    if (VIEWS[v].voice) return;
    var crew = Object.keys(P), w = crew[Math.floor(Math.random() * crew.length)];
    post(w, AMBIENT[Math.floor(Math.random() * AMBIENT.length)]);
  }
  function hush() { $$('.speaking', mini).forEach(function (el) { el.classList.remove('speaking'); }); }
  function run() {
    if (running || REDUCE.matches) return;
    running = true;
    // The rings lit in the still picture go out on their own turn.
    Array.prototype.slice.call(mini.querySelectorAll(".speaking")).forEach(function (el) { timers.push(setTimeout(function () { el.classList.remove("speaking"); }, 600 + Math.random() * 1200)); });
    timers.push(setInterval(speakTick, 2100), setInterval(chatTick, 8200));
  }
  function stop() { running = false; timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = []; hush(); }
  new IntersectionObserver(function (e) { onScreen = e[0].isIntersecting; onScreen && !document.hidden ? run() : stop(); }, { threshold: 0.25 }).observe(mini);
  document.addEventListener('visibilitychange', function () { document.hidden || !onScreen ? stop() : run(); });
  REDUCE.addEventListener('change', function () { REDUCE.matches ? stop() : (onScreen && !document.hidden && run()); });

  // First paint: keep the static markup (no flash), but take ownership.
  renderTabs();
  placeTabs(true);
  sync();
  window.SkycordMini = { show: show, state: S };
})();

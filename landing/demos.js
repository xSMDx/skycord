/* ── Live demos ────────────────────────────────────────────────────────
   A simulated cursor uses the product until a real pointer arrives, then
   it withdraws and the demo is ordinary UI. One demo runs at a time. */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');
  var STOP = {};
  var cat = window.SkycordCat || { aim: function () {} };

  /* ── Easing ─────────────────────────────────────────────────────────
     A real solver, not an approximation: motion quality is the whole
     illusion, and an eyeballed curve is visible. */
  function bezier(x1, y1, x2, y2) {
    function A(a, b) { return 1 - 3 * b + 3 * a; }
    function B(a, b) { return 3 * b - 6 * a; }
    function C(a)    { return 3 * a; }
    function calc(t, a, b)  { return ((A(a, b) * t + B(a, b)) * t + C(a)) * t; }
    function slope(t, a, b) { return 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i, s;
      for (i = 0; i < 6; i++) {
        s = slope(t, x1, x2);
        if (s === 0) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      return calc(t, y1, y2);
    };
  }
  var easeThrow  = bezier(0.23, 1, 0.32, 1);     // the site's --ease-out
  var easeSettle = bezier(0.25, 0.1, 0.25, 1);

  /* Pointing is ballistic: a fast throw covering most of the gap, then a
     slow correction. A single eased tween is the tell that it is fake. */
  var THROW_T = 0.60, THROW_S = 0.70;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ── A demo ───────────────────────────────────────────────────────── */
  function Demo(el, script) {
    this.el = el;
    this.script = script;
    this.gen = 0;
    this.active = false;
    this.held = false;
    this.visible = false;
    this.bow = 1;
    this.scale = 1;
    this.motion = null;
    this.raf = 0;
    this.pos = { x: 30, y: 30 };
    this.onFrame = null;            // demos with canvases hook in here

    this.ghost = document.createElement('div');
    this.ghost.className = 'gcursor';
    this.ghost.setAttribute('aria-hidden', 'true');
    this.ghost.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5.5 2.5 19 13.2h-6.4l-3.4 8z" fill="#fff" stroke="#0a0b0d" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    el.appendChild(this.ghost);

    var self = this;
    el.addEventListener('pointerenter', function () { self.hold(); });
    el.addEventListener('pointerleave', function () { self.release(); });
  }

  Demo.prototype.home = function () { return { x: 28, y: this.el.clientHeight - 28 }; };

  Demo.prototype.at = function (sel, ox, oy) {
    var t = typeof sel === 'string' ? $(sel, this.el) : sel;
    if (!t) return null;
    var a = t.getBoundingClientRect(), b = this.el.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2 + (ox || 0), y: a.top - b.top + a.height / 2 + (oy || 0), el: t };
  };

  Demo.prototype.paint = function () {
    var t = performance.now() / 1000;
    // A resting cursor still drifts; a pinned one reads as an image.
    var dx = this.motion ? 0 : Math.sin(t * 1.7) * 1.6;
    var dy = this.motion ? 0 : Math.cos(t * 1.3) * 1.6;
    this.ghost.style.transform = 'translate3d(' + (this.pos.x + dx) + 'px,' + (this.pos.y + dy) + 'px,0) scale(' + this.scale + ')';
    if (this.ghost.classList.contains('in')) {
      var b = this.el.getBoundingClientRect();
      cat.aim(b.left + this.pos.x, b.top + this.pos.y);
    }
  };

  Demo.prototype.loop = function () {
    var self = this;
    if (!this.active) return;
    if (this.motion) {
      var m = this.motion;
      var t = Math.min(1, (performance.now() - m.t0) / m.total);
      var s = t < THROW_T
        ? THROW_S * easeThrow(t / THROW_T)
        : THROW_S + (1 - THROW_S) * easeSettle((t - THROW_T) / (1 - THROW_T));
      var u = 1 - s;
      this.pos.x = u * u * m.fx + 2 * u * s * m.cx + s * s * m.tx;
      this.pos.y = u * u * m.fy + 2 * u * s * m.cy + s * s * m.ty;
      if (t >= 1) { this.motion = null; m.done(); }
    }
    this.paint();
    if (this.onFrame) this.onFrame();
    this.raf = requestAnimationFrame(function () { self.loop(); });
  };

  Demo.prototype.moveTo = function (x, y) {
    var self = this, fx = this.pos.x, fy = this.pos.y;
    var dx = x - fx, dy = y - fy, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1.5) { this.pos.x = x; this.pos.y = y; return Promise.resolve(); }
    var nx = -dy / d, ny = dx / d, bow = d * 0.08 * this.bow;
    this.bow = -this.bow;                       // alternate, so paths never repeat
    return new Promise(function (done) {
      self.motion = {
        fx: fx, fy: fy, tx: x, ty: y,
        cx: (fx + x) / 2 + nx * bow, cy: (fy + y) / 2 + ny * bow,
        t0: performance.now(),
        total: Math.min(720, Math.max(340, 300 + d * 0.62)),
        done: done
      };
    });
  };

  Demo.prototype.to = function (sel, ox, oy) {
    var p = this.at(sel, ox, oy);
    return p ? this.moveTo(p.x, p.y) : Promise.resolve();
  };

  /* Three things in order, and the order is what sells it: the cursor
     dips, the target answers, then state changes. */
  Demo.prototype.click = function (sel, ox, oy) {
    var self = this, p = this.at(sel, ox, oy);
    if (!p) return Promise.resolve();
    this.scale = 0.88;
    var r = document.createElement('span');
    r.className = 'ripple';
    r.style.left = p.x + 'px';
    r.style.top = p.y + 'px';
    this.el.appendChild(r);
    setTimeout(function () { r.remove(); }, 480);
    return sleep(90).then(function () { self.scale = 1; return p.el; });
  };

  Demo.prototype.start = function () {
    if (this.active || this.held || REDUCE.matches) return;
    this.active = true;
    this.pos = this.home();
    this.ghost.classList.add('in');
    this.loop();
    this.play();
  };
  Demo.prototype.stop = function () {
    this.active = false; this.gen++; this.motion = null;
    cancelAnimationFrame(this.raf);
    this.ghost.classList.remove('in');
  };
  Demo.prototype.hold = function () { this.held = true; clearTimeout(this.releaseT); this.stop(); };
  Demo.prototype.release = function () {
    var self = this;
    this.held = false;
    clearTimeout(this.releaseT);
    this.releaseT = setTimeout(function () { if (!self.held && self.visible) self.start(); }, 3000);
  };

  Demo.prototype.play = function () {
    var self = this, mine = this.gen;
    function guard() { if (mine !== self.gen || !self.active) throw STOP; }
    function step(fn, ms) {
      return Promise.resolve().then(function () { guard(); return fn(); })
        .then(function () { return sleep(ms || 0); }).then(guard);
    }
    var api = {
      el: this.el,
      demo: this,
      to:    function (s, ox, oy) { return step(function () { return self.to(s, ox, oy); }, 0); },
      dwell: function (ms)        { return step(function () {}, ms == null ? 200 : ms); },
      click: function (s, ox, oy) { return step(function () { return self.click(s, ox, oy); }, 0); },
      run:   function (fn, ms)    { return step(fn, ms); }
    };
    (function cycle() {
      self.script(api)
        .then(function () { guard(); return sleep(1500); })
        .then(function () { guard(); cycle(); })
        .catch(function (e) { if (e !== STOP) throw e; });
    })();
  };

  /* Chain a list of [selector, action] steps — every script is this shape. */
  function chain(a, steps) {
    return steps.reduce(function (p, s) { return p.then(s); }, Promise.resolve());
  }
  function tap(a, sel, after, wait) {
    return function () {
      return a.to(sel).then(function () { return a.dwell(200); })
        .then(function () { return a.click(sel); })
        .then(function () { return a.run(after || function () {}, wait == null ? 900 : wait); });
    };
  }

  /* ── Canvas helper ─────────────────────────────────────────────────── */
  function fitCanvas(c) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = c.clientWidth || 520, h = c.clientHeight || 90;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function tokenColor(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /* ── Demo: screen share ────────────────────────────────────────────── */
  function shareSetUp(el) {
    var picker = $('.sh-picker', el), tile = $('.sh-tile', el);
    var btn = $('.sh-btn', el), state = $('.sh-state', el);
    function open(v) { picker.dataset.open = String(v); }
    function pick(kind) {
      $$('.sh-opt', el).forEach(function (o) { o.classList.toggle('picked', o.dataset.pick === kind); });
      tile.dataset.live = 'true';
      btn.classList.add('live');
      state.textContent = kind === 'screen' ? 'sharing Screen 1' : 'sharing ' + (kind === 'game' ? 'Skyrunner' : 'Browser');
      open(false);
    }
    function reset() {
      open(false); tile.dataset.live = 'false'; btn.classList.remove('live');
      state.textContent = 'not sharing';
      $$('.sh-opt', el).forEach(function (o) { o.classList.remove('picked'); });
    }
    el._open = open; el._pick = pick; el._reset = reset;
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-sh="open"]')) return open(picker.dataset.open !== 'true');
      var o = e.target.closest('.sh-opt');
      if (o) pick(o.dataset.pick);
    });
  }
  function shareScript(a) {
    var el = a.el;
    return chain(a, [
      function () { return a.run(function () { el._reset(); }, 400); },
      tap(a, '[data-sh="open"]', function () { el._open(true); }, 700),
      tap(a, '.sh-opt[data-pick="game"]', function () { el._pick('game'); }, 2400)
    ]);
  }

  /* ── Demo: voice / noise filtering ─────────────────────────────────── */
  var NF = {
    off: { noise: 1.0,  label: 'a lot of clatter' },
    rnn: { noise: 0.42, label: 'some clatter' },
    dfn: { noise: 0.06, label: 'almost nothing' }
  };
  function voiceSetUp(el) {
    var c = $('#wave-c', el), note = $('#nf-level', el);
    var target = NF.rnn.noise, current = target, t = 0;
    function set(mode) {
      $$('.seg-b', el).forEach(function (b) { b.classList.toggle('on', b.dataset.nf === mode); });
      target = NF[mode].noise;
      note.textContent = NF[mode].label;
    }
    el._set = set;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-nf]');
      if (b) set(b.dataset.nf);
    });
    el._frame = function () {
      var f = fitCanvas(c), ctx = f.ctx, w = f.w, h = f.h, mid = h / 2;
      current += (target - current) * 0.06;         // ease toward the new level
      t += 0.055;
      ctx.clearRect(0, 0, w, h);
      var accent = tokenColor('--accent', '#38b6f1');
      ctx.lineWidth = 2; ctx.strokeStyle = accent; ctx.beginPath();
      for (var x = 0; x <= w; x += 2) {
        // Voice: a steady low-frequency shape. Noise: fast jitter on top.
        var voice = Math.sin(x * 0.035 + t) * 0.5 + Math.sin(x * 0.011 - t * 0.6) * 0.5;
        var noise = (Math.sin(x * 1.7 + t * 9) + Math.sin(x * 3.1 - t * 6)) * 0.5;
        var y = mid + voice * mid * 0.46 + noise * mid * 0.52 * current;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.16; ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = accent; ctx.fill(); ctx.globalAlpha = 1;
    };
  }
  function voiceScript(a) {
    var el = a.el;
    return chain(a, [
      function () { return a.run(function () { el._set('off'); }, 1500); },
      tap(a, '[data-nf="rnn"]', function () { el._set('rnn'); }, 1600),
      tap(a, '[data-nf="dfn"]', function () { el._set('dfn'); }, 2400)
    ]);
  }

  /* ── Demo: music ───────────────────────────────────────────────────── */
  /* A music channel in a call: tune in, add a song with /play, jump ahead,
     skip. The clock is real time, kept by the demo itself rather than the
     ghost's frames, so the song keeps playing while someone is using it. */
  var SONGS = {
    'night drive':  { title: 'Night Drive',  artist: 'Lumen',   len: 198, hue: 232 },
    'paper planes': { title: 'Paper Planes', artist: 'Halcyon', len: 171, hue: 168 },
    'low tide':     { title: 'Low Tide',     artist: 'Marlowe', len: 220, hue: 18 },
    'golden hour':  { title: 'Golden Hour',  artist: 'Sunroom', len: 204, hue: 40 }
  };
  /* Anything else typed after /play becomes a song too — named as typed,
     with a length and colour of its own that stay the same each time. */
  function songFor(name) {
    var key = name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (SONGS[key]) return SONGS[key];
    var h = 7;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return {
      title: key.replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }),
      artist: 'from your library', len: 140 + h % 120, hue: h % 360
    };
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
  }
  function musicSetUp(el) {
    var cover = $('.mu-cover', el), title = $('.mu-title', el), artist = $('.mu-artist', el);
    var seek = $('.mu-seek', el), fill = $('.mu-fill', el), cur = $('.mu-cur', el), dur = $('.mu-dur', el);
    var tune = $('[data-mu="tune"]', el), prevB = $('[data-mu="prev"]', el), skipB = $('[data-mu="skip"]', el);
    var who = $('.mu-who-t', el), list = $('.mu-queue', el);
    var note = $('.mu-note', el), form = $('.mu-chat', el), input = $('.mu-input', el);
    var s = { now: null, by: '', t0: 0, queue: [], history: [], tuned: false };

    function position() { return s.now ? Math.min(s.now.len, (performance.now() - s.t0) / 1000) : 0; }
    function startAt(sec) { s.t0 = performance.now() - sec * 1000; }

    function drawTime() {
      var p = position(), len = s.now ? s.now.len : 1;
      cur.textContent = clock(p);
      fill.style.transform = 'scaleX(' + (s.now ? p / len : 0) + ')';
      seek.setAttribute('aria-valuenow', String(Math.floor(p)));
      seek.setAttribute('aria-valuetext', s.now ? clock(p) + ' of ' + clock(len) : 'nothing playing');
    }
    function row(entry) {
      var li = document.createElement('li'), dot = document.createElement('span');
      var name = document.createElement('span'), by = document.createElement('em');
      dot.className = 'mu-dot';
      dot.style.setProperty('--hue', entry.t.hue);
      name.textContent = entry.t.title;
      by.textContent = entry.by === 'you' ? 'added by you' : entry.by;
      if (entry.by === 'you') li.classList.add('mine');
      if (entry.fresh) { li.classList.add('fresh'); entry.fresh = false; }
      li.appendChild(dot); li.appendChild(name); li.appendChild(by);
      return li;
    }
    var drawn = null;
    function draw() {
      var n = s.now;
      // A new song starts the bar from nothing; it must not sweep backwards
      // across the old one's progress to get there.
      if (n !== drawn) {
        drawn = n;
        fill.style.transition = 'none';
        fill.style.transform = 'scaleX(0)';
        void fill.offsetWidth;
        fill.style.transition = '';
      }
      el.dataset.playing = String(!!n);
      el.dataset.tuned = String(s.tuned);
      title.textContent = n ? n.title : 'Nothing playing';
      artist.textContent = n ? n.artist : 'Type /play and a song to start';
      cover.style.setProperty('--hue', n ? n.hue : 220);
      dur.textContent = clock(n ? n.len : 0);
      seek.setAttribute('aria-valuemax', String(n ? n.len : 0));
      tune.setAttribute('aria-pressed', String(s.tuned));
      tune.textContent = s.tuned ? 'Listening' : 'Tune in';
      who.textContent = (s.tuned ? 'You, Max and Kai are' : 'Max and Kai are') + ' listening';
      prevB.disabled = !n && !s.history.length;
      skipB.disabled = !n;
      list.textContent = '';
      if (!s.queue.length) {
        var empty = document.createElement('li');
        empty.className = 'mu-empty';
        empty.textContent = 'Nothing queued — /play adds a song';
        list.appendChild(empty);
      }
      s.queue.forEach(function (e) { list.appendChild(row(e)); });
      drawTime();
    }
    /* parts alternate plain and bold. Built from text nodes: a song name is
       whatever the visitor typed. */
    function say(parts) {
      note.textContent = '';
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Only you can see this';
      note.appendChild(tag);
      parts.forEach(function (p, i) {
        var n = document.createElement(i % 2 ? 'b' : 'span');
        n.textContent = p;
        note.appendChild(n);
      });
      note.classList.remove('in'); void note.offsetWidth; note.classList.add('in');
    }

    function play(name, by) {
      var t = songFor(name);
      if (!s.now) { s.now = t; s.by = by; startAt(0); say(['Playing ', t.title, ' for everyone in the call']); }
      else { s.queue.push({ t: t, by: by, fresh: true }); say(['Added ', t.title, ' to the queue']); }
      draw();
    }
    function skip(ended) {
      if (!s.now) return say(['Nothing is playing']);
      s.history.push({ t: s.now, by: s.by });
      var next = s.queue.shift();
      if (next) { s.now = next.t; s.by = next.by; startAt(0); if (!ended) say(['Skipped to ', next.t.title, ' for everyone']); }
      else { s.now = null; if (!ended) say(['That was the last song in the queue']); }
      draw();
    }
    /* Back a song, or to the start of this one — the app's rule: after
       three seconds, previous means "again". */
    function prev() {
      if (s.now && position() > 3) return seekTo(0);
      var back = s.history.pop();
      if (!back) return seekTo(0);
      if (s.now) s.queue.unshift({ t: s.now, by: s.by });
      s.now = back.t; s.by = back.by; startAt(0);
      draw();
    }
    function seekTo(frac) {
      if (!s.now) return;
      seek.classList.add('jump');
      startAt(Math.max(0, Math.min(0.99, frac)) * s.now.len);
      drawTime();
      setTimeout(function () { seek.classList.remove('jump'); }, 340);
    }
    function setTuned(v) { s.tuned = v; draw(); }

    function command(text) {
      var line = text.trim();
      if (!line) return;
      var m = /^\/(\S+)\s*(.*)$/.exec(line);
      if (!m) return say(['This box takes commands here — try ', '/play golden hour']);
      var cmd = m[1].toLowerCase(), arg = m[2].trim();
      if (cmd === 'play' || cmd === 'p') return arg ? play(arg, 'you') : say(['Name a song: ', '/play low tide']);
      if (cmd === 'skip' || cmd === 's' || cmd === 'next') return skip();
      if (cmd === 'prev' || cmd === 'previous' || cmd === 'back') return prev();
      if (cmd === 'stop') {
        if (!s.now) return say(['Nothing is playing']);
        s.now = null; s.queue = []; draw();
        return say(['Stopped the music for everyone']);
      }
      if (cmd === 'seek') {
        var t = /^(?:(\d+):)?(\d{1,2})$/.exec(arg);
        if (!s.now) return say(['Nothing is playing']);
        if (!t) return say(['Say where: ', '/seek 1:30']);
        var to = (t[1] ? Number(t[1]) * 60 : 0) + Number(t[2]);
        seekTo(to / s.now.len);
        return say(['Moved to ', clock(position()), ' for everyone']);
      }
      if (cmd === 'np' || cmd === 'nowplaying') {
        return s.now ? say(['', s.now.title, ' by ' + s.now.artist + ', ' + clock(position()) + ' of ' + clock(s.now.len)])
                     : say(['Nothing is playing']);
      }
      if (cmd === 'queue' || cmd === 'q') {
        return s.queue.length
          ? say(['Up next: ', s.queue.map(function (e) { return e.t.title; }).join(', ')])
          : say(['The queue is empty']);
      }
      if (cmd === 'join') { setTuned(true); return say(['Listening to ', 'In this call']); }
      if (cmd === 'leave') { setTuned(false); return say(['Stopped listening']); }
      say(['Try ', '/play', ', ', '/skip', ', ', '/seek 1:30', ' or ', '/queue']);
    }

    function reset() {
      s.tuned = false; s.history = [];
      s.now = SONGS['night drive']; s.by = 'Max';
      s.queue = [{ t: SONGS['paper planes'], by: 'Kai' }, { t: SONGS['low tide'], by: 'Max' }];
      startAt(42);
      input.value = '';
      form.classList.remove('typing');
      note.textContent = '';
      draw();
    }

    /* Its own clock, on its own observer: a song that only moved while the
       ghost was driving would stop the moment a visitor took over. */
    var timer = 0;
    function tick() {
      if (s.now && position() >= s.now.len) skip(true);
      else drawTime();
    }
    function run(on) { clearInterval(timer); timer = on ? setInterval(tick, 250) : 0; }
    new IntersectionObserver(function (entries) {
      el.dataset.visible = String(entries[0].isIntersecting);
      run(entries[0].isIntersecting && !document.hidden);
    }).observe(el);
    document.addEventListener('visibilitychange', function () {
      run(!document.hidden && el.dataset.visible === 'true');
    });

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mu]');
      if (!b) return;
      if (b.dataset.mu === 'tune') setTuned(!s.tuned);
      else if (b.dataset.mu === 'prev') prev();
      else if (b.dataset.mu === 'skip') skip();
    });
    seek.addEventListener('pointerdown', function (e) {
      var r = seek.getBoundingClientRect();
      seekTo((e.clientX - r.left) / r.width);
    });
    seek.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
      if (!s.now || (!d && e.key !== 'Home')) return;
      e.preventDefault();
      startAt(e.key === 'Home' ? 0 : Math.max(0, Math.min(s.now.len - 1, position() + d)));
      drawTime();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      command(input.value);
      input.value = '';
    });

    el._reset = reset;
    el._tune = setTuned;
    el._play = play;
    el._skip = function () { skip(); };
    el._seekTo = seekTo;
    el._type = function (v) { input.value = v; };
    el._typing = function (v) { form.classList.toggle('typing', v); };
    el._send = function () { command(input.value); input.value = ''; };
    reset();
  }
  function musicScript(a) {
    var el = a.el, line = '/play golden hour';
    var typing = line.split('').map(function (ch, i) {
      return function () { return a.run(function () { el._type(line.slice(0, i + 1)); }, ch === ' ' ? 110 : 55); };
    });
    // Where 72% of the way along the bar is, from its centre, measured when
    // the cursor gets there rather than when the loop starts.
    function along() { return $('.mu-seek', el).clientWidth * 0.22; }
    return chain(a, [
      function () { return a.run(function () { el._reset(); }, 900); },
      tap(a, '[data-mu="tune"]', function () { el._tune(true); }, 1100),
      function () { return a.to('.mu-input', -70, 0); },
      function () { return a.dwell(160); },
      function () { return a.click('.mu-input', -70, 0); },
      function () { return a.run(function () { el._typing(true); }, 260); }
    ].concat(typing, [
      function () { return a.dwell(380); },
      function () { return a.run(function () { el._send(); el._typing(false); }, 1700); },
      function () { return a.to('.mu-seek', along(), 0); },
      function () { return a.dwell(200); },
      function () { return a.click('.mu-seek', along(), 0); },
      function () { return a.run(function () { el._seekTo(0.72); }, 1500); },
      tap(a, '[data-mu="skip"]', function () { el._skip(); }, 2400)
    ]));
  }

  /* ── Demo: themes ──────────────────────────────────────────────────── */
  var THEMES = [
    { id: 'sky',    name: 'Sky',    accent: '#38b6f1', hover: '#31a0d4', text: '#5bc3f3', rgb: '56, 182, 241',  on: '#0e0f11' },
    { id: 'ember',  name: 'Ember',  accent: '#f0913a', hover: '#d97d2b', text: '#f4a961', rgb: '240, 145, 58',  on: '#1a1206' },
    { id: 'violet', name: 'Violet', accent: '#a06ef5', hover: '#8b57e0', text: '#b98ff8', rgb: '160, 110, 245', on: '#0f0a1a' },
    { id: 'mint',   name: 'Mint',   accent: '#3ecf8e', hover: '#33b47a', text: '#5fdba5', rgb: '62, 207, 142',  on: '#06150e' },
    { id: 'rose',   name: 'Rose',   accent: '#f2607e', hover: '#d9506c', text: '#f5839a', rgb: '242, 96, 126',  on: '#1a070c' }
  ];
  function applyTheme(t) {
    var s = document.documentElement.style;
    s.setProperty('--accent', t.accent);
    s.setProperty('--accent-hover', t.hover);
    s.setProperty('--accent-text', t.text);
    s.setProperty('--accent-rgb', t.rgb);
    s.setProperty('--on-accent', t.on);
    $$('.sw').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.theme === t.id)); });
    var n = $('#sw-current');
    if (n) n.textContent = t.name;
  }
  function themesSetUp(el) {
    var box = $('.swatches', el);
    box.innerHTML = THEMES.map(function (t) {
      return '<button class="sw" type="button" data-theme="' + t.id + '" style="--sw:' + t.accent +
             '" aria-pressed="' + (t.id === 'sky') + '" aria-label="' + t.name + '"></button>';
    }).join('');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.sw');
      if (b) applyTheme(THEMES.filter(function (t) { return t.id === b.dataset.theme; })[0]);
    });
  }
  function themesScript(a) {
    return chain(a, ['ember', 'violet', 'mint', 'rose', 'sky'].map(function (id) {
      return tap(a, '.sw[data-theme="' + id + '"]', function () {
        applyTheme(THEMES.filter(function (t) { return t.id === id; })[0]);
      }, 950);
    }));
  }

  /* ── Demo: performance mode ────────────────────────────────────────── */
  var PERF = {
    max:      { mem: 612, bar: 1,    tiles: '9 at 720p', gpu: 'on' },
    balanced: { mem: 470, bar: 0.77, tiles: '4 at 480p', gpu: 'on' },
    light:    { mem: 361, bar: 0.59, tiles: '2 at 360p', gpu: 'off' }
  };
  function perfSetUp(el) {
    var bar = $('#mem-bar', el), num = $('#mem-n', el);
    var tiles = $('#perf-tiles', el), gpu = $('#perf-gpu', el);
    var anim = null;
    function set(mode) {
      var p = PERF[mode];
      $$('.seg-b', el).forEach(function (b) { b.classList.toggle('on', b.dataset.perf === mode); });
      bar.style.transform = 'scaleX(' + p.bar + ')';
      tiles.textContent = p.tiles;
      gpu.textContent = p.gpu;
      // Count the number rather than snapping it — the drop is the point.
      var from = parseInt(num.textContent, 10) || p.mem, t0 = performance.now();
      cancelAnimationFrame(anim);
      (function tick(now) {
        var k = Math.min(1, ((now || performance.now()) - t0) / 520);
        num.textContent = Math.round(from + (p.mem - from) * easeSettle(k));
        if (k < 1) anim = requestAnimationFrame(tick);
      })();
    }
    el._set = set;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-perf]');
      if (b) set(b.dataset.perf);
    });
  }
  function perfScript(a) {
    var el = a.el;
    return chain(a, [
      function () { return a.run(function () { el._set('max'); }, 1300); },
      tap(a, '[data-perf="light"]', function () { el._set('light'); }, 2600),
      tap(a, '[data-perf="balanced"]', function () { el._set('balanced'); }, 1800)
    ]);
  }

  /* ── Demo: reactions ───────────────────────────────────────────────── */
  function reactionsSetUp(el) {
    var list = $('.rx-list', el), msg = $('.rx-msg', el);
    function add(emoji, mine) {
      var chip = $('.rx-chip[data-e="' + emoji + '"]', list);
      if (chip) {
        var n = $('.n', chip);
        n.textContent = String(Number(n.textContent) + 1);
        n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump');
        if (mine) chip.classList.add('mine');
        return;
      }
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rx-chip pop' + (mine ? ' mine' : '');
      chip.dataset.e = emoji;
      chip.innerHTML = emoji + ' <span class="n">1</span>';
      list.appendChild(chip);
      setTimeout(function () { chip.classList.remove('pop'); }, 400);
    }
    el._add = add;
    el._hot = function (v) { msg.classList.toggle('hot', v); };
    el._reset = function () { list.innerHTML = ''; msg.classList.remove('hot'); };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.rx-act');
      if (b) return add(b.dataset.emoji, true);
      var c = e.target.closest('.rx-chip');
      if (c) add(c.dataset.e, true);
    });
    el.addEventListener('pointerover', function () { msg.classList.add('hot'); });
    el.addEventListener('pointerleave', function () { msg.classList.remove('hot'); });
  }
  function reactionsScript(a) {
    var el = a.el;
    return chain(a, [
      function () { return a.run(function () { el._reset(); }, 350); },
      function () { return a.to('.rx-msg p'); },
      function () { return a.run(function () { el._hot(true); }, 450); },
      tap(a, '.rx-act[data-emoji="😄"]', function () { el._add('😄', true); }, 1100),
      function () { return a.run(function () { el._add('😄', false); }, 850); },
      function () { return a.run(function () { el._add('🔥', false); }, 1300); },
      function () { return a.run(function () { el._hot(false); }, 400); }
    ]);
  }

  /* ── Demo: connection ──────────────────────────────────────────────── */
  function netSetUp(el) {
    var c = $('#net-c', el), pill = $('#net-pill', el);
    var pingN = $('#net-ping', el), lossN = $('#net-loss', el);
    var dbg = $('.net-debug', el);
    var data = [], last = 26, tick = 0;
    for (var i = 0; i < 90; i++) data.push(24 + Math.random() * 6);

    el._debug = function (v) { dbg.dataset.open = String(v); };
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-net="debug"]')) el._debug(dbg.dataset.open !== 'true');
    });

    el._frame = function () {
      // Sampling is throttled to ~15/sec; drawing is not, so a single
      // call still paints. (Under reduced motion this runs exactly once,
      // and an early return here left the graph blank.)
      if (tick++ % 4 === 0) {
        // A walk with the occasional spike: flat noise reads as fake.
        last += (26 - last) * 0.08 + (Math.random() - 0.5) * 4;
        if (Math.random() < 0.02) last += 18 + Math.random() * 26;
        last = Math.max(12, Math.min(95, last));
        data.push(last); if (data.length > 90) data.shift();

        var avg = data.reduce(function (s, v) { return s + v; }, 0) / data.length;
        var loss = Math.max(0, (avg - 30) / 40);
        pingN.textContent = Math.round(last);
        lossN.textContent = loss.toFixed(1);
        pill.className = 'net-pill' + (avg > 52 ? ' poor' : avg > 34 ? ' fair' : '');
        pill.textContent = avg > 52 ? 'poor' : avg > 34 ? 'fair' : 'good';
      }

      var f = fitCanvas(c), ctx = f.ctx, w = f.w, h = f.h;
      ctx.clearRect(0, 0, w, h);
      var accent = tokenColor('--accent', '#38b6f1');
      // Gridlines, so the numbers have somewhere to sit.
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
      for (var g = 1; g < 3; g++) {
        ctx.beginPath(); ctx.moveTo(0, h * g / 3); ctx.lineTo(w, h * g / 3); ctx.stroke();
      }
      ctx.beginPath();
      data.forEach(function (v, i) {
        var x = i / (data.length - 1) * w;
        var y = h - Math.min(1, v / 100) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.globalAlpha = 0.14; ctx.fillStyle = accent; ctx.fill(); ctx.globalAlpha = 1;
    };
  }
  function netScript(a) {
    var el = a.el;
    return chain(a, [
      function () { return a.run(function () { el._debug(false); }, 2600); },
      tap(a, '[data-net="debug"]', function () { el._debug(true); }, 3200),
      tap(a, '[data-net="debug"]', function () { el._debug(false); }, 900)
    ]);
  }

  /* ── Registry ──────────────────────────────────────────────────────── */
  var KINDS = {
    share:     { setUp: shareSetUp,     script: shareScript },
    voice:     { setUp: voiceSetUp,     script: voiceScript },
    music:     { setUp: musicSetUp,     script: musicScript },
    themes:    { setUp: themesSetUp,    script: themesScript },
    perf:      { setUp: perfSetUp,      script: perfScript },
    reactions: { setUp: reactionsSetUp, script: reactionsScript },
    net:       { setUp: netSetUp,       script: netScript }
  };

  function mount() {
    var nodes = $$('.demo[data-demo]');
    if (!nodes.length) return;

    var demos = [];
    nodes.forEach(function (el) {
      var kind = KINDS[el.dataset.demo];
      if (!kind) return;
      kind.setUp(el);
      var d = new Demo(el, kind.script);
      if (el._frame) d.onFrame = el._frame;
      demos.push(d);
    });

    if (REDUCE.matches) {
      // End state, no cursor, still interactive. Reduced motion is not
      // reduced function — everything below stays clickable.
      var rx = $('.demo[data-demo="reactions"]');
      if (rx) { rx._add('😄', true); rx._add('😄', false); rx._add('🔥', false); }
      var sh = $('.demo[data-demo="share"]');
      if (sh) sh._pick('game');
      var mu = $('.demo[data-demo="music"]');
      if (mu) { mu._tune(true); mu._play('golden hour', 'you'); }
      demos.forEach(function (d) { if (d.el._frame) d.el._frame(); });
      return;
    }

    /* One at a time — the most visible. Six concurrent rAF loops on a
       page that sells being kind to an older PC would be a poor joke. */
    var ratios = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var d = demos.filter(function (x) { return x.el === e.target; })[0];
        if (d) { d.visible = e.isIntersecting; ratios.set(d, e.intersectionRatio); }
      });
      pick();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    demos.forEach(function (d) { io.observe(d.el); });

    function pick() {
      var best = null, bestR = 0;
      demos.forEach(function (d) {
        var r = ratios.get(d) || 0;
        if (r > bestR) { bestR = r; best = d; }
      });
      demos.forEach(function (d) { if (d !== best && d.active) d.stop(); });
      if (best && bestR > 0.35 && !best.active && !best.held && !document.hidden) best.start();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) demos.forEach(function (d) { if (d.active) d.stop(); });
      else pick();
    });
    window.addEventListener('resize', pick, { passive: true });
    REDUCE.addEventListener('change', function () {
      if (REDUCE.matches) demos.forEach(function (d) { d.stop(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

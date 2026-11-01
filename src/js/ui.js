/* ORIONPAD ui: DOM, motion, polling. Core logic lives in core.js (OP). */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  root.classList.add('js');
  var reg = JSON.parse(doc.getElementById('register').textContent);
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return mqReduce.matches; }
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var DASH = '—';

  /* ---------- scroll progress ---------- */
  var bar = $('#progress i'), progQueued = false;
  function progress() {
    progQueued = false;
    var h = root.scrollHeight - window.innerHeight;
    bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, window.scrollY / h) : 0) + ')';
  }
  function queueProgress() { if (!progQueued) { progQueued = true; requestAnimationFrame(progress); } }

  /* ---------- spotlight ---------- */
  doc.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------- damped spring reveal ---------- */
  function springIn(node, delay) {
    if (reduced()) { node.style.opacity = '1'; return; }
    var K = 170, C = 17, M = 1, x = 1, v = 0, last = 0, t0 = 0, started = false;
    node.style.opacity = '0';
    setTimeout(function () {
      function frame(t) {
        if (!started) { started = true; last = t; t0 = t; }
        var rem = Math.min(0.1, (t - last) / 1000); last = t;
        while (rem > 0) { var h = Math.min(rem, 1 / 240), a = (-K * x - C * v) / M; v += a * h; x += v * h; rem -= h; }
        var done = (Math.abs(x) < 0.0015 && Math.abs(v) < 0.01) || t - t0 > 1500;
        if (done) { node.style.opacity = '1'; node.style.transform = ''; return; }
        node.style.opacity = String(Math.max(0, Math.min(1, 1 - x)));
        node.style.transform = 'translateY(' + (x * 30).toFixed(2) + 'px) scale(' + (1 - x * 0.03).toFixed(4) + ')';
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }, delay);
  }
  function setupReveal() {
    var items = $$('[data-reveal]');
    if (!('IntersectionObserver' in window)) { items.forEach(function (n) { n.style.opacity = '1'; }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var sibs = $$(':scope > [data-reveal]', e.target.parentNode), i = Math.max(0, sibs.indexOf(e.target));
        springIn(e.target, Math.min(i, 6) * 80);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (n) { io.observe(n); });
  }

  /* ---------- parallax: pointer + scroll ---------- */
  var layers = $$('[data-depth]'), px = 0, py = 0, cx = 0, cy = 0, hero = $('.hero'), heroOn = true, rafP = 0;
  function parallaxFrame() {
    rafP = 0;
    if (reduced() || !heroOn) return;
    cx += (px - cx) * 0.08; cy += (py - cy) * 0.08;
    var sy = window.scrollY;
    layers.forEach(function (n) {
      var d = parseFloat(n.getAttribute('data-depth')) || 0;
      n.style.transform = 'translate3d(' + (cx * d * 18).toFixed(2) + 'px,' + (cy * d * 18 - sy * d * 0.08).toFixed(2) + 'px,0)';
    });
    if (Math.abs(px - cx) > 0.002 || Math.abs(py - cy) > 0.002) rafP = requestAnimationFrame(parallaxFrame);
  }
  function kickParallax() { if (!rafP && !reduced()) rafP = requestAnimationFrame(parallaxFrame); }
  doc.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    px = (e.clientX / window.innerWidth - 0.5) * 2; py = (e.clientY / window.innerHeight - 0.5) * 2; kickParallax();
  }, { passive: true });
  if ('IntersectionObserver' in window && hero) new IntersectionObserver(function (es) { heroOn = es[0].isIntersecting; kickParallax(); }).observe(hero);
  window.addEventListener('scroll', function () { queueProgress(); kickParallax(); }, { passive: true });
  window.addEventListener('resize', queueProgress);

  /* ---------- copy ---------- */
  var live = $('#live');
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var ta = el('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; doc.body.appendChild(ta); ta.select();
      try { doc.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } doc.body.removeChild(ta);
    });
  }
  doc.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    var label = $('.ca-copy', b) || b, prev = label.textContent;
    copyText(b.getAttribute('data-copy')).then(function () {
      b.classList.add('is-copied'); label.textContent = 'Copied'; live.textContent = 'Contract copied';
      setTimeout(function () { b.classList.remove('is-copied'); label.textContent = prev; }, 1600);
    }, function () { label.textContent = 'Press Ctrl+C'; setTimeout(function () { label.textContent = prev; }, 1600); });
  });

  /* ---------- number cells: count-up with a flash on change ---------- */
  function setNum(cell, value, fmt, flashTarget) {
    var prev = cell._v;
    cell._v = value;
    if (value === null || prev === undefined || prev === null || reduced() || prev === value) {
      cell.textContent = fmt(value);
      if (prev !== undefined && prev !== null && value !== null && prev !== value && !reduced()) flash(flashTarget || cell, value > prev);
      return;
    }
    flash(flashTarget || cell, value > prev);
    var t0 = performance.now(), dur = 600, from = prev;
    cancelAnimationFrame(cell._raf);
    (function step(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      cell.textContent = fmt(from + (value - from) * e);
      if (p < 1) cell._raf = requestAnimationFrame(step); else cell.textContent = fmt(value);
    })(t0);
  }
  function flash(n, up) {
    n.classList.remove('flash-up', 'flash-dn'); void n.offsetWidth; n.classList.add(up ? 'flash-up' : 'flash-dn');
  }

  /* ---------- board ---------- */
  var rowsEl = $('#rows'), footEl = $('#board-foot'), tabs = $$('.tab'), qEl = $('#q');
  var sortMode = 'trending', filter = '', model = null, failed = false, rowEls = {}, firstPaint = true;

  function logoNode(r) {
    var l = el('span', 'logo' + (r.own ? ' logo--own' : ''));
    var src = r.own ? 'brand/orionpad-logo.png' : r.image;
    function letter() { l.textContent = (r.symbol || r.name || '?').charAt(0).toUpperCase(); }
    if (src && /^(https:\/\/|brand\/)/.test(src) && !(r.own && r.pending)) {
      var im = el('img'); im.alt = ''; im.width = 40; im.height = 40; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer';
      im.onerror = function () { l.textContent = ''; letter(); }; im.src = src; l.appendChild(im);
    } else if (r.own) { var im2 = el('img'); im2.alt = ''; im2.width = 40; im2.height = 40; im2.src = 'brand/orionpad-logo.png'; l.appendChild(im2); }
    else letter();
    return l;
  }
  function makeRow(r, key) {
    var link = !r.own && r.id && model && model.slug;
    var rowTag = link ? 'a' : 'div';
    var n = el(rowTag, 'row' + (r.own ? ' row--own' : '')); n.setAttribute('role', 'listitem');
    if (link) { n.href = 'https://www.geckoterminal.com/' + model.slug + '/pools/' + String(r.id).replace(/^[a-z]+_/, ''); n.target = '_blank'; n.rel = 'noopener noreferrer'; }
    n.setAttribute('data-key', key);
    var rank = el('span', 'row-rank'), tok = el('span', 'row-tok'), nm = el('span', 'row-name');
    nm.appendChild(el('b', null, r.name)); nm.appendChild(el('small', null, r.pending ? '' : (r.symbol + (r.quote ? ' / ' + r.quote : ''))));
    var sub = el('span', 'row-sub'); nm.appendChild(sub);
    tok.appendChild(logoNode(r)); tok.appendChild(nm);
    var price = el('span', 'cell price'), ch = el('span', 'cell'), chg = el('span', 'chg'), vol = el('span', 'cell hide-s vol'), liq = el('span', 'cell hide-s liq');
    ch.appendChild(chg);
    n.appendChild(rank); n.appendChild(tok); n.appendChild(price); n.appendChild(ch); n.appendChild(vol); n.appendChild(liq);
    n._p = { rank: rank, price: price, chg: chg, vol: vol, liq: liq, sub: sub, name: nm.firstChild, small: nm.children[1] };
    return n;
  }
  function paintRow(n, r, rank) {
    var p = n._p;
    p.rank.textContent = String(rank);
    p.name.textContent = r.name; p.small.textContent = r.pending ? '' : (r.symbol + (r.quote ? ' / ' + r.quote : ''));
    setNum(p.price, r.price, OP.fmtPrice, p.price);
    setNum(p.vol, r.volume, OP.fmtCompact, p.vol); setNum(p.liq, r.liquidity, OP.fmtCompact, p.liq);
    p.sub.textContent = OP.fmtCompact(r.volume) + ' vol · ' + OP.fmtCompact(r.liquidity) + ' liq';
    var c = r.change, cell = p.chg;
    var prev = cell._v;
    setNum(cell, c, OP.fmtPct, null);
    cell.className = 'chg' + (c === null || c === 0 ? '' : c > 0 ? ' up' : ' dn');
    if (c !== null && c !== 0) cell.setAttribute('aria-label', (c > 0 ? 'up ' : 'down ') + Math.abs(c).toFixed(2) + ' percent');
    else cell.removeAttribute('aria-label');
    void prev;
  }
  function currentModel() {
    if (model) return model;
    var ca = OP.caOf(reg), own = ca ? OP.ownRowFromPool(null, ca) : OP.ownRowPlaceholder(), rows = [];
    for (var i = 0; i < 9; i++) rows.push({ id: 'x' + i, name: DASH, symbol: DASH, quote: '', price: null, change: null, volume: null, liquidity: null, image: '', trades: 0, blank: true });
    return { own: own, rows: rows, slug: null };
  }
  function renderBoard() {
    var m = currentModel(), list = OP.sortRows(m.rows, sortMode);
    if (filter) { var f = filter.toLowerCase(); list = list.filter(function (r) { return (r.name + ' ' + r.symbol).toLowerCase().indexOf(f) > -1; }); }
    var ordered = [{ key: 'own', r: m.own }].concat(list.map(function (r, i) { return { key: r.blank ? 'blank' + i : (r.address || r.id), r: r }; }));
    if (firstPaint) { rowsEl.textContent = ''; firstPaint = false; }
    $$('.row--sk', rowsEl).forEach(function (n) { n.remove(); });
    var keep = {};
    ordered.forEach(function (o, i) {
      var n = rowEls[o.key];
      if (!n) { n = rowEls[o.key] = makeRow(o.r, o.key); n.style.setProperty('--i', String(i)); if (!o.r.own) n.classList.add('in'); }
      keep[o.key] = 1; paintRow(n, o.r, i + 1);
      if (rowsEl.children[i] !== n) rowsEl.insertBefore(n, rowsEl.children[i] || null);
    });
    Object.keys(rowEls).forEach(function (k) { if (!keep[k]) { rowEls[k].remove(); delete rowEls[k]; } });
    if (!list.length && filter) { if (!$('.empty', rowsEl)) rowsEl.appendChild(el('p', 'empty', 'Nothing on the board matches that.')); }
    else { var em = $('.empty', rowsEl); if (em) em.remove(); }
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('is-on', x === t); x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
      sortMode = t.getAttribute('data-sort'); renderBoard();
    });
  });
  qEl.addEventListener('input', function () { filter = qEl.value.trim(); renderBoard(); });

  /* ---------- tiles, pulse, ticker ---------- */
  function setText(id, t) { var n = $(id); if (n.textContent !== t) n.textContent = t; }
  function renderSummary() {
    if (!model) return;
    var s = OP.summarize(model.rows);
    setNum($('#t-count'), s.count, function (v) { return v === null ? DASH : String(Math.round(v)); });
    setText('#t-top', s.top ? s.top.symbol : DASH); setText('#t-top-s', s.top ? OP.fmtPct(s.top.change) + ' over 24h' : '24h change');
    setNum($('#t-vol'), s.volume, OP.fmtCompact);
    function card(n, r, v) { setText('#p' + n + '-t', r ? r.symbol : DASH); setText('#p' + n + '-v', r ? v : DASH); }
    card(1, s.top, s.top ? OP.fmtPct(s.top.change) : '');
    card(2, s.most, s.most ? OP.fmtCompact(s.most.volume) + ' traded' : '');
    card(3, s.depth, s.depth ? OP.fmtCompact(s.depth.liquidity) + ' deep' : '');
    card(4, s.busy, s.busy ? s.busy.trades.toLocaleString('en-US') + ' trades' : '');
  }
  var tickerEl = $('#ticker'), tickerKey = '';
  function renderTicker() {
    if (!model) return;
    var items = (OP.caOf(reg) && model.own && model.own.price !== null ? [model.own] : []).concat(model.rows);
    var key = items.map(function (r) { return r.symbol; }).join('|');
    if (key !== tickerKey) {
      tickerKey = key; tickerEl.textContent = '';
      for (var c = 0; c < 2; c++) items.forEach(function (r) {
        var t = el('span', 'tick'); t.setAttribute('data-sym', r.symbol);
        t.appendChild(el('b', null, r.symbol)); t.appendChild(el('span', 'tv')); t.appendChild(el('span', 'tc'));
        if (c) t.setAttribute('aria-hidden', 'true');
        tickerEl.appendChild(t);
      });
    }
    items.forEach(function (r) {
      $$('[data-sym="' + CSS.escape(r.symbol) + '"]', tickerEl).forEach(function (t) {
        $('.tv', t).textContent = OP.fmtPrice(r.price);
        var c = $('.tc', t); c.textContent = OP.fmtPct(r.change); c.className = 'tc ' + (r.change !== null && r.change < 0 ? 'dn' : 'up');
      });
    });
  }

  /* ---------- status + polling ---------- */
  var pill = $('#status'), pillText = $('#status-text');
  function setStatus(kind) {
    pill.className = 'pill' + (kind === 'live' ? ' is-live' : kind === 'connecting' ? '' : ' is-warn');
    pillText.textContent = { live: 'Live', connecting: 'Connecting', retry: 'Retrying', offline: 'Offline' }[kind];
  }
  var slugState = { slug: null }, attempt = 0, timer = 0, inflight = false;
  function schedule(ms) { clearTimeout(timer); if (!doc.hidden) timer = setTimeout(poll, ms); }
  async function poll() {
    if (doc.hidden || inflight) return;
    inflight = true;
    try {
      var m = await OP.loadBoard(function (u, o) { return fetch(u, o); }, reg, slugState, function (a, b) { console.log(a, b); });
      model = m; failed = false; attempt = 0; setStatus('live');
      footEl.hidden = true;
      var firstOk = !renderBoard._done; renderBoard._done = true;
      renderBoard(); renderSummary(); renderTicker();
      if (firstOk) live.textContent = 'Board loaded';
      schedule(60000);
    } catch (err) {
      attempt++; failed = true;
      setStatus(model ? 'retry' : 'offline');
      footEl.hidden = false;
      footEl.textContent = model ? 'The feed is not answering. Showing the last good board while we retry.' : 'The feed is not answering. Retrying shortly.';
      renderBoard();
      schedule(OP.backoffDelay(attempt - 1, 3000, 120000));
    } finally { inflight = false; }
  }
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) { clearTimeout(timer); return; }
    poll();
  });

  /* ---------- boot ---------- */
  setStatus('connecting');
  progress();
  setupReveal();
  /* paint the reserved own row at once; skeletons fill rows 2-10 until data lands */
  (function paintReserved() {
    rowsEl.textContent = '';
    firstPaint = false;
    var m = currentModel(), n = makeRow(m.own, 'own'); rowEls.own = n; paintRow(n, m.own, 1); rowsEl.appendChild(n);
    for (var i = 1; i < 10; i++) {
      var r = el('div', 'row row--sk'); r.appendChild(el('span', 'sk sk--l'));
      var t = el('span', 'row-tok'); t.appendChild(el('span', 'sk sk--c')); t.appendChild(el('span', 'sk sk--l')); r.appendChild(t);
      r.appendChild(el('span', 'sk sk--r')); r.appendChild(el('span', 'sk sk--r')); r.appendChild(el('span', 'sk sk--r hide-s')); r.appendChild(el('span', 'sk sk--r hide-s'));
      rowsEl.appendChild(r);
    }
  })();
  poll();
})();

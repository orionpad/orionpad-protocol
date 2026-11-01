/* ORIONPAD core: pure logic, no DOM. Loaded in the page and under node (vm) by the gates. */
var OP = (function () {
  'use strict';
  var ADDR = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
  var EVM_LOWER = /^0x[0-9a-f]{40}$/;
  var API = 'https://api.geckoterminal.com/api/v2', SLUG = 'robinhood';
  var ACCEPT = { accept: 'application/json;version=20230302' };

  /* ---- register ---- */
  function rec(reg, key) { return (reg && reg.records && reg.records[key]) || { state: 'absent' }; }
  function isStated(r) { return !!r && r.state === 'stated'; }
  function caOf(reg) {
    var r = rec(reg, 'ca');
    return isStated(r) && EVM_LOWER.test(String(r.value || '').toLowerCase()) ? String(r.value).toLowerCase() : null;
  }
  function handleOf(url) {
    try { var p = new URL(url).pathname.split('/').filter(Boolean); return p.length ? p[0] : null; } catch (e) { return null; }
  }
  function socialModel(reg, key) {
    var r = rec(reg, key);
    if (!isStated(r) || !r.url) return { key: key, label: r.label || key, inert: true };
    return { key: key, label: r.label || key, inert: false, href: r.url, handle: handleOf(r.url) };
  }
  /* an inert record must carry neither value nor url */
  function inertViolations(reg) {
    var bad = [];
    Object.keys(reg.records).forEach(function (k) {
      var r = reg.records[k];
      if (r.state !== 'stated' && ('value' in r || 'url' in r)) bad.push(k);
    });
    return bad;
  }

  /* ---- address gate: match against the stated registry, never blanket-reject 0x hex ---- */
  function statedAddresses(reg) {
    var out = {};
    Object.keys(reg.records).forEach(function (k) {
      var r = reg.records[k];
      if (!isStated(r)) return;
      ['value', 'url', 'rpc'].forEach(function (f) {
        (String(r[f] || '').match(ADDR) || []).forEach(function (a) { out[a.toLowerCase()] = k; });
      });
    });
    return out;
  }
  function scanAddresses(text, reg, opts) {
    var stated = statedAddresses(reg), ca = caOf(reg), found = [], unmatched = [];
    (String(text).match(ADDR) || []).forEach(function (a) {
      var l = a.toLowerCase();
      found.push(l);
      if (ca && l === ca && opts && opts.caExempt) return;
      if (!stated[l]) unmatched.push(l);
    });
    return { found: found, unmatched: unmatched, ok: unmatched.length === 0 };
  }

  /* ---- numbers ---- */
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function fmtPrice(n) {
    if (n === null) return '—';
    if (n === 0) return '$0.00';
    var a = Math.abs(n);
    if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a >= 1) return '$' + n.toFixed(2);
    if (a >= 0.01) return '$' + n.toFixed(4);
    var s = n.toPrecision(3);
    if (/e/.test(s)) s = n.toFixed(12);
    return '$' + s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }
  function fmtCompact(n) {
    if (n === null) return '—';
    if (n === 0) return '$0';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(a >= 1 ? 0 : 2);
  }
  function fmtPct(n) {
    if (n === null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /* ---- backoff: 2s, 4s, 8s ... capped ---- */
  function backoffDelay(attempt, base, cap) {
    base = base || 2e3; cap = cap || 120000;
    return Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function getJSON(f, url) {
    var res = await f(url, { headers: ACCEPT });
    if (!res.ok) { var e = new Error('http ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  async function withRetry(fn, tries, wait) {
    var last;
    for (var i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (e && e.status === 400) throw e;
        if (i < tries - 1) await (wait || sleep)(backoffDelay(i, 1500));
      }
    }
    throw last;
  }

  /* ---- pools ---- */
  function indexIncluded(inc) {
    var map = {};
    (inc || []).forEach(function (t) { if (t.type === 'token') map[t.id] = t.attributes || {}; });
    return map;
  }
  function poolToRow(pool, tokens) {
    var a = pool.attributes || {}, rel = pool.relationships || {};
    var b = tokens[(rel.base_token && rel.base_token.data && rel.base_token.data.id) || ''] || {};
    var q = tokens[(rel.quote_token && rel.quote_token.data && rel.quote_token.data.id) || ''] || {};
    var tx = (a.transactions && a.transactions.h24) || {};
    return {
      id: pool.id,
      address: String(b.address || '').toLowerCase(),
      name: b.name || String(a.name || '').split(' / ')[0] || '—',
      symbol: b.symbol || String(a.name || '').split(' / ')[0] || '?',
      quote: q.symbol || '',
      image: b.image_url || '',
      price: num(a.base_token_price_usd),
      change: num(a.price_change_percentage && a.price_change_percentage.h24),
      volume: num(a.volume_usd && a.volume_usd.h24),
      liquidity: num(a.reserve_in_usd),
      trades: (tx.buys || 0) + (tx.sells || 0)
    };
  }
  function boardRows(resp, reg, limit) {
    var ca = caOf(reg), tokens = indexIncluded(resp && resp.included), seen = {}, out = [];
    ((resp && resp.data) || []).forEach(function (p) {
      var r = poolToRow(p, tokens);
      if (ca && (r.address === ca)) return;          /* dedup against own token */
      var key = r.address || r.id;
      if (seen[key]) return; seen[key] = 1;
      out.push(r);
    });
    return out.slice(0, limit || 9);
  }
  function pickBestPool(resp) {
    var tokens = indexIncluded(resp && resp.included), best = null;
    ((resp && resp.data) || []).forEach(function (p) {
      var r = poolToRow(p, tokens), v = r.volume === null ? -1 : r.volume;
      if (!best || v > best.v) best = { v: v, row: r };
    });
    return best ? best.row : null;
  }
  /* row #1: reserved placeholder when CA is absent, real pool data when stated */
  function ownRowPlaceholder() {
    return { own: true, pending: true, name: '· · · · ·', symbol: '', price: 0, change: 0, volume: 0, liquidity: 0, image: '' };
  }
  function ownRowFromPool(row, ca) {
    if (!row) return { own: true, pending: false, name: 'ORIONPAD', symbol: 'ORIONPAD', address: ca, price: null, change: null, volume: null, liquidity: null, logo: true };
    row.own = true; row.pending = false; row.logo = true; row.address = ca; return row;
  }
  function ownRowUrl(reg) {
    var ca = caOf(reg); if (!ca) return null;
    return API + '/networks/' + SLUG + '/tokens/' + ca + '/pools?include=base_token,quote_token&page=1';
  }
  function trendingUrl() {
    return API + '/networks/' + SLUG + '/trending_pools?include=base_token,quote_token&page=1';
  }

  /* one refresh: trending (+ own pools when CA stated). Keeps nothing; caller keeps last good. */
  async function loadBoard(f, reg, state, log, wait) {
    var trending = await withRetry(function () { return getJSON(f, trendingUrl()); }, 2, wait);
    var rows = boardRows(trending, reg, 9);
    var own = ownRowPlaceholder(), ca = caOf(reg);
    if (ca) {
      var raw = null;
      try { raw = await getJSON(f, ownRowUrl(reg)); } catch (e) { raw = { error: String(e && e.message) }; }
      if (log) { log('[ORIONPAD] own token raw response', raw); }
      var best = raw && raw.data ? pickBestPool(raw) : null;
      if (log) { log('[ORIONPAD] own pool candidates', ((raw && raw.data) || []).map(function (p) { return { id: p.id, vol: p.attributes && p.attributes.volume_usd && p.attributes.volume_usd.h24 }; })); }
      own = ownRowFromPool(best, ca);
    }
    return { slug: SLUG, own: own, rows: rows, trendingRaw: trending };
  }

  function summarize(rows) {
    var top = null, vol = 0, depth = null, busy = null, most = null;
    rows.forEach(function (r) {
      if (r.change !== null && (!top || r.change > top.change)) top = r;
      if (r.volume !== null) { vol += r.volume; if (!most || r.volume > most.volume) most = r; }
      if (r.liquidity !== null && (!depth || r.liquidity > depth.liquidity)) depth = r;
      if (!busy || r.trades > busy.trades) busy = r;
    });
    return { top: top, volume: vol, depth: depth, busy: busy, most: most, count: rows.length };
  }
  function sortRows(rows, mode) {
    var k = { gainers: 'change', volume: 'volume', liquidity: 'liquidity' }[mode];
    if (!k) return rows.slice();
    return rows.slice().sort(function (a, b) { return (b[k] === null ? -Infinity : b[k]) - (a[k] === null ? -Infinity : a[k]); });
  }

  return {
    rec: rec, isStated: isStated, caOf: caOf, socialModel: socialModel, inertViolations: inertViolations,
    statedAddresses: statedAddresses, scanAddresses: scanAddresses, handleOf: handleOf,
    num: num, fmtPrice: fmtPrice, fmtCompact: fmtCompact, fmtPct: fmtPct, backoffDelay: backoffDelay,
    boardRows: boardRows, pickBestPool: pickBestPool, ownRowPlaceholder: ownRowPlaceholder,
    ownRowFromPool: ownRowFromPool, ownRowUrl: ownRowUrl, trendingUrl: trendingUrl, loadBoard: loadBoard,
    summarize: summarize, sortRows: sortRows, withRetry: withRetry
  };
})();
if (typeof module !== 'undefined') module.exports = OP;

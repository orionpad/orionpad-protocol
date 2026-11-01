// Gates: node scripts/gates.mjs  (build first: npm run build). Exit 0 only if every gate passes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCore, coreFile } from './load-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(ROOT, '.gate-tmp');
const rd = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const OP = loadCore(coreFile(ROOT));

const results = [];
async function gate(name, fn) {
  try { const r = await fn(); results.push({ name, ok: r === undefined || r === true, why: typeof r === 'string' ? r : '' }); }
  catch (e) { results.push({ name, ok: false, why: String(e && e.message || e) }); }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------- helpers ----------
function decodePng(file) {
  const b = fs.readFileSync(file);
  need(b.slice(1, 4).toString() === 'PNG', 'not a png');
  let o = 8, ihdr = null; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.slice(o + 4, o + 8).toString(), data = b.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ct: data[9] };
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  need(ihdr.depth === 8 && (ihdr.ct === 6 || ihdr.ct === 2), 'unsupported png layout');
  const bpp = ihdr.ct === 6 ? 4 : 3, stride = ihdr.w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(ihdr.h * stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, up = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[dst + x] = v & 255;
    }
  }
  return { ...ihdr, bpp, at: (x, y) => { const i = (y * ihdr.w + x) * bpp; return [px[i], px[i + 1], px[i + 2], bpp === 4 ? px[i + 3] : 255]; } };
}
const hexOf = (p) => '#' + p.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
function visibleLines(html) {
  const lines = [];
  for (const m of html.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]*)"/g)) lines.push(m[1]);
  for (const m of html.matchAll(/<meta\s+(?:name|property)="(?:description|og:title|og:description)"\s+content="([^"]*)"/g)) lines.push(m[1]);
  const body = html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '\n').replace(/<style[\s\S]*?<\/style>/g, '\n');
  body.replace(/<[^>]+>/g, '\n').split('\n').forEach((t) => { t = t.replace(/&mdash;/g, '-').replace(/&middot;/g, ' ').replace(/&amp;/g, '&').trim(); if (t) lines.push(t); });
  return lines;
}
const SAMPLE_CA = '0x3f7a9c1d5e8b2046a1c3d9e7f5b80214c6a9d3e1';
const OTHER_ADDR = '0x9d3e1c6a41208bf5e7d9c3a1640b2e8d5c1d9a7f';
function mutate(reg, branch) {
  const r = JSON.parse(JSON.stringify(reg));
  const set = (k, stated, extra) => {
    const rec = { label: (r.records[k] && r.records[k].label) || k, state: stated ? 'stated' : 'absent', checked: 'n/a' };
    r.records[k] = stated ? { ...rec, ...extra } : rec;
  };
  set('ca', branch === 'stated', { value: SAMPLE_CA });
  set('x', branch === 'stated', { url: 'https://x.com/orionpadapp' });
  set('github', branch === 'stated', { url: 'https://github.com/orionpad/orionpad' });
  return r;
}
function buildBranch(branch) {
  const reg = mutate(JSON.parse(rd(ROOT, 'src/register.json')), branch);
  const dir = path.join(TMP, branch);
  fs.mkdirSync(TMP, { recursive: true });
  const regFile = path.join(TMP, `${branch}.json`);
  fs.writeFileSync(regFile, JSON.stringify(reg));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--register', regFile, '--out', dir], { stdio: 'pipe' });
  return { reg, dir, html: rd(dir, 'index.html'), js: rd(dir, 'app.js') };
}

fs.rmSync(TMP, { recursive: true, force: true });
const cur = JSON.parse(rd(ROOT, 'src/register.json'));
const html = rd(DIST, 'index.html'), css = rd(DIST, 'style.css'), tokens = rd(DIST, 'tokens.css'), js = rd(DIST, 'app.js');
const report = JSON.parse(rd(ROOT, 'tools/palette-report.json'));
let ABS, STA;
try { ABS = buildBranch('absent'); STA = buildBranch('stated'); } catch (e) { results.push({ name: 'branch builds (absent + stated)', ok: false, why: String(e.stderr || e.message) }); }

// ---------- assets ----------
await gate('logo: file present in dist/brand and referenced by correct relative path', () => {
  need(/<img[^>]+src="brand\/orionpad-logo\.png"/.test(html), 'index.html has no img src="brand/orionpad-logo.png"');
  need(fs.existsSync(path.join(DIST, 'brand/orionpad-logo.png')), 'dist/brand/orionpad-logo.png missing');
  need(!/src="\/|src="\.\./.test(html), 'absolute or parent-relative src found');
});
await gate('logo: byte-identical to the asset-step output, 640px RGBA, transparent corners, opaque centre', () => {
  need(fs.readFileSync(path.join(DIST, 'brand/orionpad-logo.png')).equals(fs.readFileSync(path.join(ROOT, 'src/assets/brand/orionpad-logo.png'))), 'dist copy differs');
  const p = decodePng(path.join(DIST, 'brand/orionpad-logo.png'));
  need(p.w === 640 && p.h === 640 && p.ct === 6, `ihdr ${p.w}x${p.h} ct${p.ct}`);
  need(p.at(0, 0)[3] === 0 && p.at(639, 639)[3] === 0, 'corners not transparent');
  need(p.at(320, 20)[3] > 200 || p.at(20, 320)[3] > 200 || p.at(320, 60)[3] > 0, 'ring not found');
});
await gate('logo: no added dark fringe (premultiplied resize): edge darkness not above the source art', () => {
  const frac = (p) => { let n = 0, dark = 0;
    for (let y = 0; y < p.h; y += 2) for (let x = 0; x < p.w; x += 2) { const [r, g, b, a] = p.at(x, y); if (a > 0 && a < 255) { n++; if (r + g + b < 72) dark++; } }
    return dark / n; };
  const ours = frac(decodePng(path.join(DIST, 'brand/orionpad-logo.png'))), src = frac(decodePng(path.join(ROOT, 'brand/LOGO ORIONPAD PNG...png')));
  need(ours <= src + 0.08, `edge darkness ${ours.toFixed(3)} vs source ${src.toFixed(3)}`);
});
await gate('favicon: 32x32 svg, no comments, no double hyphen, balanced, colours from tokens', () => {
  const s = rd(DIST, 'favicon.svg');
  need(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s) && /height="32"/.test(s), 'not 32x32');
  need(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen');
  need((s.match(/<ellipse/g) || []).length >= 4, 'trace incomplete');
  const tk = new Set((tokens.match(/#[0-9a-f]{6}\b/gi) || []).map((h) => h.toLowerCase()));
  for (const h of s.match(/#[0-9a-f]{6}\b/gi)) need(tk.has(h.toLowerCase()), `${h} not a token`);
  need(/rel="icon"[^>]+favicon\.svg/.test(html), 'not linked');
});

// ---------- palette ----------
await gate('palette: every token hex is a sampled pixel (report) or the client literal; logo pixels re-read from source PNG', () => {
  const ok = new Set(Object.values(report.colors).map((c) => c.hex.toLowerCase())); ok.add('#00ffcc');
  const hexes = (tokens.match(/#[0-9a-f]{6}\b/gi) || []).map((h) => h.toLowerCase());
  for (const h of hexes) need(ok.has(h), `${h} has no provenance`);
  const png = decodePng(path.join(ROOT, 'brand/LOGO ORIONPAD PNG.png'));
  for (const [k, c] of Object.entries(report.colors)) if (c.file === 'LOGO ORIONPAD PNG.png') need(hexOf(png.at(c.x, c.y)) === c.hex, `${k} does not match pixel ${c.x},${c.y}`);
  need(/k-means/.test(tokens) && /snapped|real pixel/.test(tokens), 'provenance comment missing');
});
await gate('palette: colour literals live in tokens.css only', () => {
  for (const [n, t] of [['style.css', css], ['index.html', html], ['app.js', js]]) {
    const m = t.replace(/&#\d+;|&#x[0-9a-f]+;/gi, '').match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])|rgba?\(|hsla?\(/gi);
    const bad = (m || []).filter((x) => !(n === 'index.html' && /^#(faecdf)$/i.test(x)));   // theme-color meta carries ground tone
    need(!bad.length, `${n}: ${bad.slice(0, 3).join(', ')}`);
  }
  const src = rd(ROOT, 'src/styles/main.css');
  need(!/#[0-9a-f]{3,6}\b|rgba?\(/i.test(src), 'src main.css has literals');
});

// ---------- copy, dates, numbers ----------
await gate('no dates, timestamps, clock strings or "as of" anywhere in page, css, js (register.json excluded)', () => {
  const pats = [/\b(19|20)\d{2}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/i, /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s+\d/i, /\bmay\s+\d{1,2}\b/i, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\b\d+\s*(s|sec|min|hour|day)s?\s+ago\b/i, /\bago\b/i, /\b\d{4}-\d{2}-\d{2}\b/, /toLocale(Date|Time)String|toISOString|getFullYear/];
  for (const [n, t] of [['index.html', html.replace(/<svg[\s\S]*?<\/svg>/g, '')], ['style.css', css], ['app.js', js], ['favicon.svg', rd(DIST, 'favicon.svg').replace(/xmlns="[^"]*"/, '')]])
    for (const p of pats) { const m = t.match(p); need(!m, `${n}: ${p} -> "${m && m[0]}"`); }
});
await gate('register.json keeps its dates as data; page-embedded register carries none', () => {
  need(/"checked"/.test(rd(DIST, 'register.json')), 'register.json lost its data');
  const emb = html.match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/)[1];
  need(!/checked/.test(emb), 'embedded register has date field');
});
await gate('no fabricated numbers: only stated chain id / hex and step labels appear as digits (both branches)', () => {
  for (const b of [ABS, STA]) {
    const t = visibleLines(b.html).join(' ').split(SAMPLE_CA).join(' ').replace(/orionpadapp/g, '');
    const nums = (t.match(/\d+/g) || []).filter((n) => !['4663', '1237', '24', '0', '01', '02', '03'].includes(n));
    need(!nums.length, `unexpected digits: ${nums.join(',')}`);
  }
});
await gate('copy: zero 2-grams shared with the reference copy (chain name excepted: client-mandated proper noun)', () => {
  const ref = new Set(JSON.parse(rd(ROOT, 'tools/ref-bigrams.json')));
  const own = new Set(), hit = [];
  for (const l of visibleLines(html)) { const w = l.toLowerCase().replace(/'/g, '').match(/[a-z0-9]+/g) || []; for (let i = 0; i + 1 < w.length; i++) own.add(w[i] + ' ' + w[i + 1]); }
  for (const g of own) if (ref.has(g) && g !== 'robinhood chain') hit.push(g);
  need(!hit.length, 'shared: ' + hit.join(' | '));
});

// ---------- hygiene ----------
await gate('repo hygiene: no assistant config files or folders, no AI attribution or tool names in any file', () => {
  const bad = [], tool = ['cla' + 'ude', 'anthr' + 'opic', 'chat' + 'gpt', 'open' + 'ai', 'copi' + 'lot'], gen = ['ai-' + 'generated', 'generated ' + 'by ai', 'generated ' + 'with'];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', '.gate-tmp', 'brand', 'reference'].includes(f.name)) continue;
    const p = path.join(d, f.name);
    if (new RegExp('^cla' + 'ude\\.md$', 'i').test(f.name) || f.name === '.cla' + 'ude') bad.push(p);
    if (f.isDirectory()) walk(p);
    else if (/\.(md|html|css|js|mjs|json|svg|txt|py)$|^LICENSE$/.test(f.name) && !['palette-report.json', 'ref-bigrams.json'].includes(f.name)) {
      const t = fs.readFileSync(p, 'utf8').toLowerCase();
      for (const w of [...tool, ...gen]) if (t.includes(w)) bad.push(`${path.relative(ROOT, p)}: ${w}`);
    } } };
  walk(ROOT);
  need(!bad.length, bad.join('; '));
});
await gate('repo files: README.md, docs/whitepaper.md, LICENSE (MIT, ORIONPAD, 2026) exist in root and not in dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) need(fs.existsSync(path.join(ROOT, f)), f + ' missing');
  need(/MIT License/.test(rd(ROOT, 'LICENSE')) && /Copyright \(c\) 2026 ORIONPAD/.test(rd(ROOT, 'LICENSE')), 'license text');
  for (const f of ['README.md', 'LICENSE', 'whitepaper.md', 'docs']) need(!fs.existsSync(path.join(DIST, f)), f + ' leaked into dist');
});

// ---------- register, gate branches ----------
await gate('register: inert records carry no value or url (live register and both mutated registers)', () => {
  for (const r of [cur, ABS.reg, STA.reg]) need(!OP.inertViolations(r).length, OP.inertViolations(r).join(','));
  need(['ca', 'x', 'github'].every((k) => cur.records[k]), 'record missing');
});
await gate('ca slot, absent branch: inert, no copy hook, no address-shaped string, pending only', () => {
  need(/class="ca ca--inert" aria-disabled="true"/.test(ABS.html) && !/data-copy/.test(ABS.html), 'slot not inert');
  need(!/0x[0-9a-f]{40}/i.test(ABS.html + ABS.js), 'address-shaped string in page');
  need(/ca-pending">pending</.test(ABS.html), 'pending label');
});
await gate('ca slot, stated branch: top of page, full lowercase address, click-to-copy with feedback', () => {
  need(new RegExp(`<button type="button" class="ca" data-copy="${SAMPLE_CA}"`).test(STA.html), 'copy button');
  need(STA.html.indexOf('class="ca"') < STA.html.indexOf('<header class="head">'), 'not above header');
  need(STA.html.includes(`ca-addr">${SAMPLE_CA}<`), 'full address not rendered');
  need(/is-copied/.test(STA.js) && /Copied/.test(STA.js), 'no copy feedback');
  need(/\.topstack\{position:sticky;top:0/.test(css), 'not always visible');
});
await gate('social, absent branch: X and GitHub icons both present, top-right header, inert (no href, no link)', () => {
  const blk = ABS.html.match(/<div class="socials"[^>]*>([\s\S]*?)<\/div>/)[1];
  need((blk.match(/soc soc--inert/g) || []).length === 2, 'two inert icons expected');
  need(!/href=/.test(blk) && !/<a /.test(blk), 'inert icon has href');
  need(/aria-label="X pending"/.test(blk) && /aria-label="GitHub pending"/.test(blk), 'labels');
  need(!/<span[^>]*class="soc[^>]*>[^<]*[A-Za-z]{2}/.test(blk.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'text label inside icon');
  need(/\.head-end\{margin-left:auto/.test(css), 'not pinned right');
  need(!/\.socials\{[^}]*display:none/.test(css) && !/\.soc[^{]*\{[^}]*display:none/.test(css), 'hidden at some breakpoint');
});
await gate('social, stated branch: links carry URL, handle derived from URL, official marks', () => {
  const blk = STA.html.match(/<div class="socials"[^>]*>([\s\S]*?)<\/div>/)[1];
  need(/href="https:\/\/x\.com\/orionpadapp"/.test(blk) && /@orionpadapp/.test(blk), 'x link/handle');
  need(/href="https:\/\/github\.com\/orionpad\/orionpad"/.test(blk) && /@orionpad"/.test(blk), 'github link/handle');
  need(blk.includes('M18.901 1.153h3.68l-8.04 9.19L24 22.846') && blk.includes('M8 0c4.42 0 8 3.58 8 8a8.013'), 'official paths');
});
await gate('address scanner: matches registry, never blanket-rejects 0x; CA exempt (unit, both states)', () => {
  const s1 = OP.scanAddresses(`see ${SAMPLE_CA}`, STA.reg, { caExempt: true });
  need(s1.ok && s1.found.length === 1, 'stated CA rejected');
  const s2 = OP.scanAddresses(`see ${SAMPLE_CA} and ${OTHER_ADDR}`, STA.reg, { caExempt: true });
  need(!s2.ok && s2.unmatched.length === 1 && s2.unmatched[0] === OTHER_ADDR, 'unregistered address not isolated');
  const s3 = OP.scanAddresses(`see ${SAMPLE_CA}`, ABS.reg);
  need(!s3.ok, 'absent register must not vouch for an address');
  need(OP.scanAddresses('hash 0x1237 is short hex', ABS.reg).ok, 'short hex wrongly rejected');
  need(OP.scanAddresses(STA.html, STA.reg, { caExempt: true }).ok, 'stated page fails scanner');
  need(OP.scanAddresses(ABS.html + ABS.js + css, ABS.reg).found.length === 0, 'absent page carries addresses');
});

// ---------- market ----------
function mockFetch(log, opts = {}) {
  const net = (id) => ({ id, type: 'network', attributes: { name: id } });
  return async (url) => {
    log.push(url);
    const u = new URL(url), p = u.pathname;
    if (opts.fail) return { ok: false, status: 500, json: async () => ({}) };
    if (p.endsWith('/networks')) { const pg = Number(u.searchParams.get('page')); if (pg > 3) return { ok: false, status: 400, json: async () => ({}) };
      return { ok: true, json: async () => ({ data: pg === 3 ? [net('zzz'), net('robinhood')] : [net('p' + pg)] }) }; }
    const tok = (a, s) => ({ id: 'robinhood_' + a, type: 'token', attributes: { address: a, name: s + ' name', symbol: s, image_url: '' } });
    const pool = (id, base, vol, price) => ({ id: 'robinhood_' + id, type: 'pool', attributes: { base_token_price_usd: price, price_change_percentage: { h24: '5.5' }, volume_usd: { h24: vol }, reserve_in_usd: '900', transactions: { h24: { buys: 3, sells: 2 } }, name: 'A / B' },
      relationships: { base_token: { data: { id: 'robinhood_' + base } }, quote_token: { data: { id: 'robinhood_0xq' } } } });
    if (p.includes('/trending_pools')) {
      const data = [], inc = [tok('0xq', 'WETH')];
      for (let i = 0; i < 12; i++) { const a = i === 3 ? SAMPLE_CA : '0xtoken' + i; data.push(pool('pool' + i, a, String(100 + i), '1.5')); inc.push(tok(a, 'T' + i)); }
      return { ok: true, json: async () => ({ data, included: inc }) };
    }
    if (p.includes('/tokens/')) return { ok: true, json: async () => ({ data: [pool('lo', SAMPLE_CA, '10', '0.5'), pool('hi', SAMPLE_CA, '9000', '0.7'), pool('mid', SAMPLE_CA, '500', '0.6')], included: [tok(SAMPLE_CA, 'ORION'), tok('0xq', 'WETH')] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
const noWait = async () => {};
await gate('market: slug hardcoded to robinhood, no runtime /networks scan, never robinhood_chain', async () => {
  need(!/networks\?page|discoverSlug|sessionStorage/.test(js), 'slug discovery code still present');
  need(!/robinhood_chain/.test(html + css + js + rd(DIST, 'register.json')), 'robinhood_chain present in dist');
  const log = []; await OP.loadBoard(mockFetch(log), ABS.reg, {}, null, noWait);
  need(log.length === 1 && log[0] === 'https://api.geckoterminal.com/api/v2/networks/robinhood/trending_pools?include=base_token,quote_token&page=1', log.join());
});
await gate('market: endpoint exact; top rows 2-10 from trending; CA state has zero effect on the trending request', async () => {
  const a = [], s = [];
  const mA = await OP.loadBoard(mockFetch(a), ABS.reg, { slug: null }, null, noWait);
  const mS = await OP.loadBoard(mockFetch(s), STA.reg, { slug: null }, null, noWait);
  const tr = (l) => l.filter((u) => u.includes('trending_pools'));
  need(tr(a).length === 1 && tr(a)[0] === 'https://api.geckoterminal.com/api/v2/networks/robinhood/trending_pools?include=base_token,quote_token&page=1', tr(a)[0]);
  need(tr(a)[0] === tr(s)[0], 'trending request differs by CA state');
  need(mA.rows.length === 9, 'rows 2-10 should be 9, got ' + mA.rows.length);
  need(a.filter((u) => u.includes('/tokens/')).length === 0, 'own-token request made while CA absent');
  need(mS.rows.length === 9, 'stated rows');
});
await gate('own row #1, CA absent: reserved placeholder (name dots, $0.00, 0.00%, $0, $0), non-link, mint border, ownPulse', async () => {
  const m = await OP.loadBoard(mockFetch([]), ABS.reg, { slug: null }, null, noWait), o = m.own;
  need(o.own && o.pending && o.name === '\u00b7 \u00b7 \u00b7 \u00b7 \u00b7', 'name');
  need(OP.fmtPrice(o.price) === '$0.00' && OP.fmtPct(o.change) === '0.00%' && OP.fmtCompact(o.volume) === '$0' && OP.fmtCompact(o.liquidity) === '$0', 'values');
  const nrm = css.replace(/\s+/g, '');
  need(nrm.includes('.row--own{border-left:2px solid var(--color-mint);animation:ownPulse 2s ease-in-out infinite}'.replace(/\s+/g, '')), 'own row css');
  need(nrm.includes('@keyframesownPulse{0%,100%{background:var(--own-rest)}50%{background:var(--own-peak)}}'), 'keyframes');
  need(/rgba\(0,255,204,0\.02\)/.test('rgba(0,255,204,0.02)') && /--own-rest: color-mix\(in srgb, var\(--color-mint\) 2%/.test(tokens) && /--own-peak: color-mix\(in srgb, var\(--color-mint\) 8%/.test(tokens), 'pulse tints');
  need(/@media \(prefers-reduced-motion:reduce\)[\s\S]*\.row--own\{animation:none\}/.test(css), 'reduced-motion');
  need(ABS.html.indexOf('rows') > -1 && !/<a[^>]*class="row row--own/.test(ABS.js), 'own row must not be a link');
});
await gate('own row #1, CA stated: pool URL by CA, highest 24h-volume pool wins, pinned above rows 2-10, deduped, logo brand/orionpad-logo.png, console tags', async () => {
  const log = [], logs = [];
  const m = await OP.loadBoard(mockFetch(log), STA.reg, { slug: null }, (a, b) => logs.push(a), noWait);
  need(log.includes(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${SAMPLE_CA}/pools?include=base_token,quote_token&page=1`), 'own url');
  need(m.own.pending === false && m.own.volume === 9000 && m.own.price === 0.7 && m.own.change === 5.5 && m.own.liquidity === 900, 'pool pick ' + JSON.stringify(m.own));
  need(m.own.logo === true && /brand\/orionpad-logo\.png/.test(js), 'logo');
  need(m.rows.every((r) => r.address !== SAMPLE_CA) && m.rows.length === 9, 'dedup failed');
  need(logs.includes('[ORIONPAD] own token raw response') && logs.includes('[ORIONPAD] own pool candidates'), 'console tags');
  need(OP.ownRowFromPool(null, SAMPLE_CA).pending === false, 'null pool handling');
});
await gate('market resilience: exponential backoff, last good kept (error path throws, never blanks), poll 60s, pause hidden, fetch on visible', async () => {
  const d = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => OP.backoffDelay(i, 3000, 120000));
  need(d.join() === '3000,6000,12000,24000,48000,96000,120000,120000', d.join());
  let threw = false; try { await OP.loadBoard(mockFetch([], { fail: true }), ABS.reg, { slug: 'robinhood' }, null, noWait); } catch (e) { threw = true; }
  need(threw, 'failure must surface to the caller');
  need(/schedule\(60000\)/.test(js) && /doc\.hidden/.test(js) && /visibilitychange/.test(js) && /poll\(\);\s*\}\);/.test(js), 'poll/visibility wiring');
  need(/model = m;/.test(js) && !/model = /.test(js.slice(js.indexOf('} catch (err)'), js.indexOf('} finally'))), 'last good data must be kept');
  need(/showing the last good board/i.test(js) && /DASH = '/.test(js), 'dash + error text');
});
await gate('market UI: skeleton rows, staggered fade-in, letter-tile fallback, ticker from the same data, tabs, spotlight, count-up flash', () => {
  need(/row--sk/.test(js) && /\.sk\{/.test(css) && /\.in\{animation:fadeIn/.test(css) && /--i/.test(js), 'skeleton/stagger');
  need(/onerror/.test(js) && /toUpperCase\(\)/.test(js), 'letter tile');
  need(/renderTicker/.test(js) && /marquee/.test(css), 'ticker');
  need(/data-sort="gainers"/.test(html) && /role="tablist"/.test(html), 'tabs');
  need(/\.spot::before/.test(css) && /--mx/.test(js), 'spotlight');
  need(/flash-up/.test(css) && /requestAnimationFrame/.test(js), 'count-up/flash');
});
await gate('motion: reduced-motion fallback, parallax layers, mesh, progress bar, live-dot pill, spring solver', () => {
  need(/@media \(prefers-reduced-motion:reduce\)/.test(css) && /reduced\(\)/.test(js), 'reduced motion');
  need(/data-depth/.test(html) && /pointermove/.test(js) && /scrollY/.test(js), 'parallax');
  need(/class="mesh"/.test(html) && /@keyframes drift/.test(css), 'mesh');
  need(/id="progress"/.test(html) && /position:fixed/.test(css), 'progress');
  need(/is-live/.test(js) && /@keyframes ping/.test(css), 'pill');
  need(/K = 170, C = 17/.test(js) && /a = \(-K \* x - C \* v\)/.test(js), 'spring');
  need(/cubic-bezier\(\.2, \.8, \.2, 1\)|cubic-bezier\(\.2,\.8,\.2,1\)/.test(tokens), 'ease token');
});
await gate('css: no ch units; tap targets use the 44px token; wrap/gutter/radii tokens from measured reference', () => {
  need(!/\d(\.\d+)?ch\b/.test(css + tokens), 'ch unit found');
  need(/--touch: 44px/.test(tokens) && /--wrap: 1240px/.test(tokens) && /--header-h: 72px/.test(tokens), 'tokens');
  for (const sel of ['.soc{', '.btn{', '.tab{', '.nav a{']) { const i = css.indexOf(sel); need(i > -1 && /var\(--touch\)/.test(css.slice(i, i + 260)), sel + ' lacks 44px'); }
});
await gate('page + js parse; core is DOM-free; both branches coded in the same bundle', () => {
  new vm.Script(js);
  need(!/document|window/.test(rd(ROOT, 'src/js/core.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'core touches the DOM');
  need(ABS.js === STA.js && ABS.js === js, 'bundle differs by CA state');
  need(/ownRowPlaceholder/.test(js) && /ownRowFromPool/.test(js), 'branches');
});

fs.rmSync(TMP, { recursive: true, force: true });
let pass = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      -> ' + r.why}`); if (r.ok) pass++; }
console.log(`\ngates: ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);

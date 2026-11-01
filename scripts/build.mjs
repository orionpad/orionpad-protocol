// Static build: src/ -> dist/. No dependencies.
// Usage: node scripts/build.mjs [--register <file>] [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? path.resolve(process.argv[i + 1]) : d; };
const OUT = arg('--out', path.join(ROOT, 'dist'));
const REG = arg('--register', path.join(ROOT, 'src/register.json'));
const SRC = path.join(ROOT, 'src');

import { loadCore, coreFile } from './load-core.mjs';
const OP = loadCore(coreFile(ROOT));
const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  github: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>'
};

// ---- register-driven fragments (state read from the record at build time, never assumed)
const ca = OP.caOf(reg);
const caBar = ca
  ? `<button type="button" class="ca" data-copy="${ca}" aria-label="Copy contract address"><span class="ca-label">Contract</span><span class="ca-addr">${ca}</span><span class="ca-copy">Copy</span></button>`
  : `<div class="ca ca--inert" aria-disabled="true"><span class="ca-label">Contract</span><span class="ca-pending">pending</span></div>`;
const heroCa = ca
  ? `<button type="button" class="btn btn--ghost" data-copy="${ca}">Copy contract</button>`
  : `<span class="btn btn--inert" aria-disabled="true">Contract pending</span>`;
const soc = (key) => {
  const m = OP.socialModel(reg, key);
  return m.inert
    ? `<span class="soc soc--inert" role="img" aria-label="${esc(m.label)} pending">${ICON[key]}</span>`
    : `<a class="soc" href="${esc(m.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.label)}${m.handle ? ' @' + esc(m.handle) : ''}">${ICON[key]}</a>`;
};
const recView = (key) => {
  const m = OP.socialModel(reg, key);
  return m.inert ? 'pending' : `<a href="${esc(m.href)}" target="_blank" rel="noopener noreferrer">${m.handle ? '@' + esc(m.handle) : esc(m.label)}</a>`;
};
const chain = OP.rec(reg, 'chain');

// register shipped to the page: dates are data for register.json only
const strip = JSON.parse(JSON.stringify(reg));
for (const r of Object.values(strip.records)) delete r.checked;
const regJson = JSON.stringify(strip).replace(/</g, '\u003c');

const html = read('index.html')
  .replace('{{CA_STATE}}', ca ? 'stated' : 'absent')
  .replace('{{CA_BAR}}', caBar).replace('{{HERO_CA_BTN}}', heroCa)
  .replace('{{SOCIALS}}', soc('x') + soc('github'))
  .replace('{{REC_CA}}', ca ? esc(ca) : 'pending').replace('{{REC_X}}', recView('x')).replace('{{REC_GH}}', recView('github'))
  .replace(/\{\{CHAIN_ID\}\}/g, esc(chain.chainId)).replace(/\{\{CHAIN_HEX\}\}/g, esc(chain.chainIdHex))
  .replace('{{REGISTER_JSON}}', regJson);
if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unfilled template slot');

// ---- write dist
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'brand'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'tokens.css'), read('styles/tokens.css'));
fs.writeFileSync(path.join(OUT, 'style.css'), read('styles/main.css'));
fs.writeFileSync(path.join(OUT, 'app.js'), read('js/core.js') + '\n' + read('js/ui.js'));
fs.writeFileSync(path.join(OUT, 'register.json'), JSON.stringify(reg, null, 2));
fs.copyFileSync(path.join(SRC, 'assets/brand/favicon.svg'), path.join(OUT, 'favicon.svg'));
for (const f of ['orionpad-logo.png', 'orionpad-logo-192.png', 'orionpad-banner.jpg'])
  fs.copyFileSync(path.join(SRC, 'assets/brand', f), path.join(OUT, 'brand', f));

// ---- logo must be in dist and referenced by a correct relative path
const logoRef = html.match(/src="(brand\/orionpad-logo\.png)"/);
if (!logoRef || !fs.existsSync(path.join(OUT, logoRef[1]))) throw new Error('logo missing from dist or not referenced');
console.log(`built ${path.relative(ROOT, OUT) || '.'} | ca=${ca ? 'stated' : 'absent'} | logo ${logoRef[1]} ok (${fs.statSync(path.join(OUT, logoRef[1])).size} bytes)`);

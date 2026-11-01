// Tiny static server for local checks: node scripts/serve.mjs [dir] [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] || 'dist'), port = Number(process.argv[3] || 4173);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith(path.sep) || !path.extname(p)) p = path.join(p, 'index.html');
  if (!p.startsWith(dir) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('serving ' + dir + ' on ' + port));

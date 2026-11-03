// Serve web/ and open a cloudflared quick tunnel, because Web Bluetooth only works over https.
// Usage: node serve.mjs            (prints a https://….trycloudflare.com link)
//        node serve.mjs --local    (http://localhost only, no tunnel)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'web');
const PORT = Number(process.env.PORT || 8790);
const LINK_FILE = path.join(HERE, 'share-link.txt');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

try { fs.unlinkSync(LINK_FILE); } catch { /* no old link */ }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/health') return res.end('ok');
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}`);
  if (process.argv.includes('--local')) return;

  const exe = ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'].find((c) => fs.existsSync(c)) || 'cloudflared';
  const cf = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let announced = false;
  const onOut = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || announced) return;
    announced = true;
    fs.writeFileSync(LINK_FILE, m[0] + '\n');
    console.log(`\nOpen this in Chrome on your phone:  ${m[0]}\n`);
  };
  cf.stdout.on('data', onOut);
  cf.stderr.on('data', onOut);
  cf.on('exit', (code) => { console.log(`Tunnel closed (code ${code})`); process.exit(1); });
  const stop = () => { try { cf.kill(); } catch { /* ignore */ } process.exit(0); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, stop);
});

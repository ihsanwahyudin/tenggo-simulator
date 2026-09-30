import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { TICK_RATE } from '@tenggo/shared';
import { handleConnection, tickRooms } from './rooms';

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIR = resolve(import.meta.dirname, '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path === '/healthz') return res.writeHead(200).end('ok');

  let file = join(CLIENT_DIR, normalize(path));
  if (!file.startsWith(CLIENT_DIR)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIR, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end('Client belum di-build. Jalankan "npm run build".');

  const hashed = file.includes(`${join(CLIENT_DIR, 'assets')}`);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
wss.on('connection', handleConnection);

// Loop tetap 30 tick/detik dengan akumulator agar tidak melenceng.
const STEP_MS = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  let n = 0;
  for (; acc >= STEP_MS && n < 5; n++, acc -= STEP_MS) tickRooms();
  if (n === 5) acc = 0;
}, STEP_MS / 2);

server.listen(PORT, () => console.log(`Tenggo Simulator jalan di http://localhost:${PORT}`));

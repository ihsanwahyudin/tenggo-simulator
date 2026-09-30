// Bot penguji: memainkan satu ronde dari meja sampai naik bus lewat WebSocket.
//   npm run bot            -> membuat room sendiri dan langsung mulai
//   npm run bot -- KODE    -> bergabung ke room KODE dan menunggu host memulai
// Bot mengikuti jarak-ke-finis yang menurun, menunggu lift dan bus, menyeberang saat lampu hijau,
// dan berusaha tidak melangkah ke tempat yang sedang dilihat penjaga.
import {
  BUS_DOOR,
  GUARD_FLOOR,
  LIFT_PHASES,
  LIFT_ZONES,
  OUTDOOR,
  ROAD,
  ZEBRAS,
  busDocked,
  canSee,
  canStep,
  finishDist,
  inCabin,
  isStaticWet,
  liftDoorOpen,
  pedLight,
  relocate,
  stairAt,
  tileKey as keyOf,
  type LiftCar,
  type SnapMsg,
  type World,
} from '@tenggo/shared';

const code = process.argv[2];
const name = process.argv[3] ?? 'Bot';
const url = process.env.SERVER ?? 'ws://localhost:3000/ws';
const quiet = !!process.env.QUIET;
const ws = new WebSocket(url);
let id = 0;
let snap: SnapMsg | null = null;
let seq = 0;
let lastLog = '';
const started = Date.now();

const log = (msg: string) => {
  if (!quiet && msg !== lastLog) console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
  lastLog = msg;
};

ws.onopen = () => ws.send(JSON.stringify(code ? { t: 'join', code, name } : { t: 'create', name }));
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.t === 'joined') {
    id = m.id;
    console.log(`masuk room ${m.code} sebagai ${name}`);
    if (!code) ws.send(JSON.stringify({ t: 'start' }));
  } else if (m.t === 'err') {
    console.log('ditolak:', m.msg);
    process.exit(1);
  } else if (m.t === 'snap') snap = m;
  else if (m.t === 'room' && m.phase === 'result') {
    console.log('HASIL', JSON.stringify(m.results));
    process.exit(0);
  }
};
ws.onclose = () => process.exit(1);

function think(): { x: number; z: number; w: boolean; u: boolean } {
  const s = snap!;
  const me = s.players.find((p) => p.id === id)!;
  const idle = { x: 0, z: 0, w: false, u: false };
  if (me.st !== 'active') return idle;

  const lifts: LiftCar[] = s.lifts.map(([phase, t], i) => ({ zone: Math.floor(i / 2), car: i % 2, phase: LIFT_PHASES[phase], t }));
  const wetSet = new Set(s.wet);
  const world: World = {
    wet: (f, tx, tz) => isStaticWet(f, tx, tz) || wetSet.has(keyOf(f, tx, tz)),
    doorOpen: (d) => (d === BUS_DOOR ? busDocked(s.time) : liftDoorOpen(lifts, d)),
  };
  const guards = s.hr.map(([x, z, face]) => ({ x, z, face, wp: 0, pause: 0 }));
  const seen = (f: number, x: number, z: number) => f === GUARD_FLOOR && guards.some((g) => canSee(g, { floor: f, x, z }));

  const f = me.fl;
  const tx = Math.floor(me.x);
  const tz = Math.floor(me.z);
  const here = finishDist(f, me.x, me.z);

  // Di dalam kabin lift yang akan turun: diam dan tekan tutup pintu.
  const zone = LIFT_ZONES.find((z) => z.top === f);
  if (zone && (inCabin(0, me.x, me.z) || inCabin(1, me.x, me.z))) {
    log(`Lt ${f}: di dalam lift, tutup pintu`);
    return { x: 0, z: 0, w: false, u: true };
  }

  // Pilih tile tetangga yang paling mendekatkan ke bus.
  let best: { dx: number; dz: number; d: number; f: number; x: number; z: number } | null = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!canStep(f, tx, tz, dx, dz, world)) continue;
    const at = { floor: f, x: tx + dx + 0.5, z: tz + dz + 0.5 };
    if (!stairAt(f, at.x, at.z)) relocate(at);
    const d = finishDist(at.floor, at.x, at.z);
    if (d < here && (!best || d < best.d)) best = { dx, dz, d, f: at.floor, x: at.x, z: at.z };
  }
  if (!best) {
    log(`Lt ${f}: menunggu (pintu tertutup) di ${tx},${tz}`);
    return idle;
  }

  // Jangan melangkah ke pandangan penjaga, kecuali memang sudah terlihat.
  if (seen(best.f, best.x, best.z) && !seen(f, me.x, me.z)) {
    log(`Lt ${f}: bersembunyi dari penjaga di ${tx},${tz}`);
    return idle;
  }
  // Menyeberang hanya saat lampu pejalan kaki baru hijau.
  if (f === OUTDOOR && tz < ROAD.z0 && tz + best.dz >= ROAD.z0) {
    const zebra = ZEBRAS.findIndex((zb) => tx >= zb.x0 && tx < zb.x1);
    if (pedLight(zebra, s.time) !== 'go' || pedLight(zebra, s.time + 2.2) !== 'go') {
      log('area luar: menunggu lampu hijau');
      return idle;
    }
  }

  // Luruskan dulu ke tengah tile pada sumbu tegak lurus, baru maju.
  const offX = tx + 0.5 - me.x;
  const offZ = tz + 0.5 - me.z;
  let x = best.dx;
  let z = best.dz;
  if (best.dx !== 0 && Math.abs(offZ) > 0.12) z = Math.sign(offZ);
  if (best.dz !== 0 && Math.abs(offX) > 0.12) x = Math.sign(offX);
  if (best.dx !== 0 && Math.abs(offZ) > 0.3) x = 0;
  if (best.dz !== 0 && Math.abs(offX) > 0.3) z = 0;
  const wetNear = world.wet(f, tx, tz) || world.wet(best.f, Math.floor(best.x), Math.floor(best.z));
  log(`Lt ${f}: jalan, sisa ${Math.ceil(best.d / 25) * 25} tile`);
  return { x, z, w: wetNear, u: false };
}

setInterval(() => {
  if (!snap || snap.phase !== 'race') return;
  const move = think();
  ws.send(JSON.stringify({ t: 'in', s: ++seq, x: move.x, z: move.z, w: move.w, p: false, th: false, u: move.u }));
}, 1000 / 30);
setTimeout(() => {
  console.log('waktu habis');
  process.exit(2);
}, 400_000);

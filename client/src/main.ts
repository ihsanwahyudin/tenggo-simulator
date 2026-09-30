import './ui/style.css';
import * as THREE from 'three';
import * as shared from '@tenggo/shared';
import {
  BUS_DOOR,
  DT,
  GUARD_FLOOR,
  JANITORS,
  LIFT_PHASES,
  LIFT_ZONES,
  MAP_H,
  MAP_W,
  OUTDOOR,
  PORTAL_DZ,
  TOP_FLOOR,
  ZEBRAS,
  busDocked,
  busWait,
  finishDist,
  floorOffsetZ,
  floorY,
  heightAt,
  isStaticWet,
  keyFloor,
  keyLocal,
  liftAt,
  liftDoorOpen,
  liftProgress,
  pedLight,
  ridingLift,
  stairAt,
  stepPlayer,
  tileKey,
  type LiftCar,
  type Phase,
  type PlayerInput,
  type PlayerSim,
  type RoomMsg,
  type SnapMsg,
  type SnapPlayer,
  type World,
} from '@tenggo/shared';
import { sfx, unlockAudio } from './audio';
import { Keyboard } from './input/keyboard';
import { Joystick, bindActionButtons, type Actions } from './input/touch';
import { Net } from './net';
import { PLAYER_COLORS } from './palette';
import { FollowCamera } from './scene/camera';
import { Character, lerpAngle, type CharacterView } from './scene/characters';
import { Props, type GuardView } from './scene/items';
import { buildOffice, buildTower } from './scene/office';
import { WetLayer } from './scene/wet';
import { Hud } from './ui/hud';
import { LobbyUI } from './ui/lobby';
import { ResultsUI } from './ui/results';

const INTERP_MS = 100; // pemain lain ditampilkan sedikit di masa lalu agar bisa diinterpolasi
const $ = (id: string) => document.getElementById(id)!;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- Scene ----------

const canvas = $('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2030);
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Matahari sore: satu lampu berbayang yang mencakup seluruh gedung dan jalan di depannya.
const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
const TOP_Y = floorY(TOP_FLOOR);
const WORLD_D = MAP_H + PORTAL_DZ; // gedung + area luar
sun.position.set(MAP_W / 2 - 9, TOP_Y + 30, WORLD_D / 2 - 12);
sun.target.position.set(MAP_W / 2, TOP_Y / 2, WORLD_D / 2);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(isTouch ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 40, bottom: -40, near: 1, far: 110 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
const floors = buildOffice();
const wetLayers = floors.map((group, f) => new WetLayer(group, f));
const tower = buildTower();
scene.add(...floors, tower, new THREE.HemisphereLight(0xffffff, 0x8088a0, 1.9), sun, sun.target);

/**
 * Yang ditampilkan: lantai tempat pemain berada dan satu lantai di bawahnya (terlihat lewat lubang
 * tangga dan lift). Lobby dan area luar sama-sama di permukaan tanah, jadi selalu tampil berdua.
 */
let viewFloor = TOP_FLOOR;
const floorVisible = (f: number) => f === viewFloor || f === viewFloor - 1 || (viewFloor === OUTDOOR && f === 1);
function setViewFloor(f: number) {
  viewFloor = f;
  floors.forEach((group, i) => (group.visible = floorVisible(i)));
  tower.visible = f === OUTDOOR; // menara hanya tampak dari jalan
}
setViewFloor(TOP_FLOOR);

const cam = new FollowCamera();
const props = new Props(scene);
const chars = new Map<number, Character>();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  cam.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ---------- Input ----------

const actions: Actions = { push: false, throw: false, use: false };
const keyboard = new Keyboard(actions);
const joystick = new Joystick($('joystick'), $('knob'));
bindActionButtons(actions, $('btn-push'), $('btn-throw'), $('btn-use'));
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') actions.throw = true;
});
document.body.classList.toggle('touch', isTouch);

// ---------- State ----------

const net = new Net();
let myId = 0;
let room: RoomMsg | null = null;
let phase: Phase = 'lobby';
const snaps: { at: number; s: SnapMsg }[] = [];

// Prediksi pemain sendiri
let local: PlayerSim | null = null;
let prevLocal: PlayerSim | null = null;
let pending: PlayerInput[] = [];
let seq = 0;
let acc = 0;
const smooth = { x: 0, z: 0 }; // sisa koreksi server yang dihaluskan

// Keadaan dunia dari snapshot terakhir, dipakai prediksi gerak: lantai basah, pintu lift, pintu bus.
let dynWet = new Set<number>();
let lifts: LiftCar[] = [];
let raceTime = 0;
const world: World = {
  wet: (f, tx, tz) => isStaticWet(f, tx, tz) || dynWet.has(tileKey(f, tx, tz)),
  doorOpen: (id) => (id === BUS_DOOR ? busDocked(raceTime) : lifts.length > 0 && liftDoorOpen(lifts, id)),
};

const hud = new Hud(() => sfx.tick());
const results = new ResultsUI(() => net.send({ t: 'lobby' }));
const lobby = new LobbyUI({
  create: (name) => enter({ t: 'create', name }),
  join: (code, name) => enter({ t: 'join', code, name }),
  start: () => net.send({ t: 'start' }),
});

async function enter(msg: { t: 'create'; name: string } | { t: 'join'; code: string; name: string }) {
  unlockAudio();
  try {
    await net.connect();
    net.send(msg);
  } catch (e) {
    lobby.showError((e as Error).message);
  }
}

// ---------- Jaringan ----------

net.onMessage = (msg) => {
  switch (msg.t) {
    case 'joined':
      myId = msg.id;
      history.replaceState(null, '', `?room=${msg.code}`);
      break;
    case 'err':
      lobby.showHome(msg.msg);
      break;
    case 'room':
      room = msg;
      setPhase(msg.phase);
      if (msg.phase === 'lobby') lobby.showRoom(msg, myId);
      else lobby.hide();
      if (msg.phase === 'result') results.show(msg, myId);
      break;
    case 'snap':
      onSnap(msg);
      break;
  }
};

net.onClose = () => {
  myId = 0;
  room = null;
  setPhase('lobby');
  results.hide();
  lobby.showHome('Koneksi ke server terputus');
};

function setPhase(next: Phase) {
  if (next === phase) return;
  const old = phase;
  phase = next;
  hud.setVisible(next === 'desk' || next === 'race');
  if (next !== 'result') results.hide();
  if (next === 'desk') resetRound();
  if (next === 'race' && old === 'desk') {
    sfx.teng();
    hud.flash('TENG! PULANG!');
  }
  if (next === 'lobby' || next === 'result') resetRound();
}

function resetRound() {
  snaps.length = 0;
  local = prevLocal = null;
  pending = [];
  seq = 0;
  acc = 0;
  smooth.x = smooth.z = 0;
  dynWet = new Set();
  lifts = [];
  raceTime = 0;
  for (const c of chars.values()) scene.remove(c.group);
  chars.clear();
  props.clear();
  for (const layer of wetLayers) layer.setDynamic([]);
  setViewFloor(TOP_FLOOR);
}

const simFromSnap = (p: SnapPlayer): PlayerSim => ({
  floor: p.fl,
  x: p.x, z: p.z, vx: p.vx, vz: p.vz, face: p.f,
  state: p.st, stateT: p.sT, downT: p.dT,
  invuln: p.inv, pushCd: p.cd, item: p.item,
});

const liftsFromSnap = (s: SnapMsg, elapsed = 0): LiftCar[] =>
  s.lifts.map(([phase, t], i) => {
    const name = LIFT_PHASES[phase];
    // Kabin yang sedang bergerak dilanjutkan sedikit ke depan supaya gerakannya halus di antara snapshot.
    const moving = name === 'down' || name === 'up';
    return { zone: Math.floor(i / 2), car: i % 2, phase: name, t: moving ? Math.max(0, t - elapsed) : t };
  });

/** Posisi di dunia 3D; area luar digeser ke selatan lobby. */
const worldZ = (f: number, z: number) => z + floorOffsetZ(f);

function onSnap(s: SnapMsg) {
  const before = snaps.at(-1)?.s;
  setPhase(s.phase);
  snaps.push({ at: performance.now(), s });
  if (snaps.length > 30) snaps.shift();
  dynWet = new Set(s.wet);
  lifts = liftsFromSnap(s);
  raceTime = s.phase === 'race' ? s.time : 0;
  if (before) playEvents(before, s);

  const me = s.players.find((p) => p.id === myId);
  if (!me) return;
  // Rekonsiliasi: mulai dari state server, lalu ulangi input yang belum diproses server.
  const old = local;
  local = simFromSnap(me);
  pending = pending.filter((i) => i.s > s.ack);
  for (const i of pending) stepPlayer(local, i, world);
  if (old && prevLocal) {
    // Koreksi dihitung di koordinat dunia, supaya melewati pintu putar tidak dianggap lompatan.
    const cx = local.x - old.x;
    const cz = worldZ(local.floor, local.z) - worldZ(old.floor, old.z);
    if (Math.hypot(cx, cz) < 3) {
      prevLocal.x += cx;
      prevLocal.z += cz;
      smooth.x -= cx;
      smooth.z -= cz;
    } else {
      // Dipindahkan server (ditangkap penjaga, tertabrak): langsung lompat, jangan dihaluskan
      prevLocal = { ...local };
      smooth.x = smooth.z = 0;
    }
  } else prevLocal = { ...local };
}

function playEvents(a: SnapMsg, b: SnapMsg) {
  const prev = new Map(a.players.map((p) => [p.id, p]));
  for (const p of b.players) {
    const was = prev.get(p.id);
    if (!was) continue;
    const mine = p.id === myId;
    const jumped = Math.hypot(p.x - was.x, worldZ(p.fl, p.z) - worldZ(was.fl, was.z)) > 3;
    if (p.st === 'down' && jumped && was.fl === GUARD_FLOOR && p.fl === GUARD_FLOOR + 1) {
      // Ditangkap penjaga: tiba-tiba terduduk di lantai atas
      sfx.caught();
      if (mine) hud.flash('KETAHUAN HR!');
    } else if (p.st === 'down' && jumped && p.fl === OUTDOOR && was.fl === OUTDOOR) {
      sfx.bonk();
      if (mine) hud.flash('TERTABRAK!');
    } else if (p.st === 'slip' && was.st === 'active') (world.wet(p.fl, Math.floor(p.x), Math.floor(p.z)) ? sfx.slip : sfx.bonk)();
    if (p.st === 'done' && was.st !== 'done') sfx.finish();
    if (mine && p.item && !was.item) sfx.pickup();
  }
  const known = new Set(a.projs.map((p) => p.id));
  if (b.projs.some((p) => !known.has(p.id))) sfx.whoosh();
}

// ---------- Loop ----------

function tick() {
  if (!local) return;
  const auto = pilot?.();
  const mv = auto ? { x: auto.x, z: auto.z, walk: auto.w } : joystick.active ? joystick.move() : keyboard.move();
  const inp: PlayerInput = { s: ++seq, x: mv.x, z: mv.z, w: mv.walk, p: actions.push, th: actions.throw, u: actions.use || !!auto?.u };
  actions.push = actions.throw = actions.use = false;
  net.send({ t: 'in', ...inp });
  pending.push(inp);
  if (pending.length > 90) pending.shift();
  prevLocal = { ...local };
  stepPlayer(local, inp, world);
}

/** Dua snapshot yang mengapit waktu render, beserta posisi di antaranya. */
function sample(now: number) {
  const rt = now - INTERP_MS;
  let i = snaps.length - 1;
  while (i > 0 && snaps[i].at > rt) i--;
  const a = snaps[i];
  const b = snaps[Math.min(i + 1, snaps.length - 1)];
  const t = b.at > a.at ? Math.max(0, Math.min(1, (rt - a.at) / (b.at - a.at))) : 1;
  return { a: a.s, b: b.s, t };
}

/** Ketinggian pijakan pemain: lantai, tangga, atau lantai kabin lift yang sedang bergerak. */
function standY(live: LiftCar[], floor: number, x: number, z: number): number {
  const lift = ridingLift(live, { floor, x, z });
  if (!lift) return heightAt(floor, x, z);
  const zone = LIFT_ZONES[lift.zone];
  return lerp(floorY(zone.top), floorY(zone.bottom), liftProgress(lift));
}

function renderWorld(now: number, time: number, dt: number) {
  const last = snaps.at(-1)!;
  const latest = last.s;
  const { a, b, t } = sample(now);
  const live = liftsFromSnap(latest, (now - last.at) / 1000);
  const roster = new Map(room?.players.map((p) => [p.id, p]));
  const colorOf = (id: number) => PLAYER_COLORS[(roster.get(id)?.color ?? 0) % PLAYER_COLORS.length];

  // Lantai yang sedang dilihat mengikuti pemain sendiri; di dalam lift berganti di tengah perjalanan
  const meNow = latest.players.find((p) => p.id === myId);
  const mySim = phase === 'race' && local ? local : meNow ? simFromSnap(meNow) : null;
  let myFloor = mySim?.floor ?? TOP_FLOOR;
  const myLift = mySim ? ridingLift(live, mySim) : undefined;
  if (myLift && liftProgress(myLift) > 0.5) myFloor = LIFT_ZONES[myLift.zone].bottom;
  setViewFloor(peek?.f ?? myFloor);

  // Pemain
  const prevById = new Map(a.players.map((p) => [p.id, p]));
  const seen = new Set<number>();
  let mine: CharacterView | null = null;
  for (const pb of b.players) {
    const info = roster.get(pb.id);
    if (!info) continue;
    seen.add(pb.id);
    const pa = prevById.get(pb.id) ?? pb;
    let floor = pb.fl;
    // Interpolasi di koordinat dunia, lalu kembalikan ke koordinat lokal lantainya
    let x = lerp(pa.x, pb.x, t);
    let wz = lerp(worldZ(pa.fl, pa.z), worldZ(pb.fl, pb.z), t);
    const view: CharacterView = {
      visible: true,
      label: true,
      x,
      y: 0,
      z: wz,
      face: lerpAngle(pa.f, pb.f, t),
      state: pb.st,
      invuln: pb.inv > 0,
      item: pb.item,
      pushCd: pb.cd,
    };
    if (pb.id === myId) {
      if (phase === 'race' && local && prevLocal) {
        const alpha = Math.min(1, acc / DT);
        x = lerp(prevLocal.x, local.x, alpha) + smooth.x;
        wz = lerp(worldZ(prevLocal.floor, prevLocal.z), worldZ(local.floor, local.z), alpha) + smooth.z;
        view.face = local.face;
        view.state = local.state;
        view.invuln = local.invuln > 0;
        floor = local.floor;
      }
      mine = view;
    }
    view.x = x;
    view.z = wz;
    const lz = wz - floorOffsetZ(floor);
    view.y = standY(live, floor, x, lz);
    // Penumpang lift yang sedang turun tetap terlihat dari lantai tujuannya
    const riding = ridingLift(live, { floor, x, z: lz });
    const inView = riding ? floorVisible(LIFT_ZONES[riding.zone].top) || floorVisible(LIFT_ZONES[riding.zone].bottom) : floorVisible(floor);
    view.visible = inView;
    view.label = inView && (floor === viewFloor || !!riding || !!stairAt(floor, x, lz) || (floor <= 1 && viewFloor <= 1));
    let c = chars.get(pb.id);
    if (!c) {
      c = new Character(colorOf(pb.id), info.name, pb.id, pb.id === myId);
      chars.set(pb.id, c);
      scene.add(c.group);
    }
    c.update(view, time, dt);
  }
  for (const [id, c] of chars) {
    if (seen.has(id)) continue;
    scene.remove(c.group);
    chars.delete(id);
  }

  // Proyektil, item, genangan
  const projA = new Map(a.projs.map((p) => [p.id, p]));
  props.syncProjectiles(
    b.projs.map((p) => {
      const pa = projA.get(p.id) ?? p;
      return { ...p, x: lerp(pa.x, p.x, t), z: lerp(worldZ(pa.f, pa.z), worldZ(p.f, p.z), t) - floorOffsetZ(p.f) };
    }),
    time,
    floorVisible,
  );
  props.sync(latest.items, time, floorVisible);
  wetLayers.forEach((layer, f) => layer.setDynamic(latest.wet.filter((k) => keyFloor(k) === f).map(keyLocal)));

  // Petugas kebersihan dan penjaga
  const walker = (pa: number[] | undefined, pb: number[]): GuardView => {
    const [ax, az] = pa ?? pb;
    const dx = pb[0] - ax;
    const dz = pb[1] - az;
    return {
      x: lerp(ax, pb[0], t),
      z: lerp(az, pb[1], t),
      face: pb.length > 2 ? lerpAngle((pa ?? pb)[2], pb[2], t) : dx || dz ? Math.atan2(dx, dz) : Math.PI / 2,
      moving: !!(dx || dz),
    };
  };
  const janitors = b.jan.map((j, i) => walker(a.jan[i], j));
  // Petugas yang sedang berbelok tetap menghadap arah terakhirnya
  janitors.forEach((j, i) => {
    if (j.moving) janitorFace[i] = j.face;
    else j.face = janitorFace[i] ?? j.face;
  });
  props.setJanitors(janitors, floorVisible, time);
  props.setGuards(b.hr.map((g, i) => walker(a.hr[i], g)), floorVisible(GUARD_FLOOR), viewFloor === GUARD_FLOOR, time);

  // Lift dan jalan raya
  props.setLifts(live, floorVisible, (f) => f === viewFloor, dt);
  const carA = new Map(a.cars.map((c) => [c[0], c]));
  props.setStreet(
    b.cars.map(([id, lane, x]) => [id, lane, lerp(carA.get(id)?.[2] ?? x, x, t)]),
    latest.time + (now - last.at) / 1000,
    phase === 'race' && floorVisible(OUTDOOR),
  );

  if (peek) cam.follow(peek.x, floorY(peek.f), worldZ(peek.f, peek.z), dt);
  else if (mine) cam.follow(mine.x, mine.y, mine.z, dt);
  else cam.overview(time, TOP_Y);

  // HUD
  if (!meNow || !mySim) return;
  const order = [...latest.players].sort(
    (p, q) => (p.rank || 1000 + finishDist(p.fl, p.x, p.z)) - (q.rank || 1000 + finishDist(q.fl, q.x, q.z)),
  );
  const cabin = mySim.state === 'active' ? liftAt(lifts, mySim) : undefined;
  let info = '';
  if (cabin?.phase === 'top') info = cabin.t > 0 ? `Pintu lift menutup dalam ${Math.ceil(cabin.t)}…` : 'Pintu lift terbuka';
  else if (myLift) info = myLift.phase === 'up' ? 'Lift naik lagi…' : 'Lift turun…';
  else if (viewFloor === OUTDOOR) {
    const zebra = ZEBRAS.reduce((best, zb, i) => (Math.abs(mySim.x - (zb.x0 + zb.x1) / 2) < Math.abs(mySim.x - (ZEBRAS[best].x0 + ZEBRAS[best].x1) / 2) ? i : best), 0);
    const light = pedLight(zebra, latest.time);
    const wait = busWait(latest.time);
    info = `Zebra ${'AB'[zebra]}: ${light === 'go' ? 'HIJAU, seberang!' : light === 'blink' ? 'mau merah…' : 'MERAH'} · ${wait === 0 ? 'bus di halte!' : `bus ${Math.ceil(wait)} dtk lagi`}`;
  }
  hud.update({
    phase,
    time: latest.time,
    floor: viewFloor,
    det: meNow.det,
    info,
    canUse: cabin?.phase === 'top',
    guards: viewFloor === GUARD_FLOOR ? latest.hr.map(([x, z]) => ({ x, z })) : [],
    place: order.findIndex((p) => p.id === myId) + 1,
    total: order.length,
    state: mySim.state,
    stateT: mySim.stateT,
    rank: meNow.rank,
    pushCd: meNow.cd,
    item: meNow.item,
    wet: latest.wet.filter((k) => keyFloor(k) === viewFloor).map(keyLocal),
    dots: latest.players
      .filter((p) => p.st !== 'done' && p.fl === viewFloor)
      .map((p) => ({ x: p.x, z: p.z, color: colorOf(p.id), me: p.id === myId })),
  });
}
const janitorFace: number[] = JANITORS.map(() => Math.PI / 2);

// Pegangan untuk debugging dari console; tidak ikut ke build produksi.
// __tenggo.peek = { f, x, z } mengarahkan kamera ke titik mana pun di gedung; null untuk kembali.
// __tenggo.pilot = () => ({ x, z, w, u }) menggantikan input pemain (untuk uji otomatis); aturan game ada di __tenggo.shared.
let peek: { f: number; x: number; z: number } | null = null;
let pilot: (() => { x: number; z: number; w: boolean; u: boolean } | null) | null = null;
if (import.meta.env.DEV) {
  Object.assign(window, {
    __tenggo: {
      shared,
      set peek(v: typeof peek) {
        peek = v;
      },
      set pilot(v: typeof pilot) {
        pilot = v;
      },
      get local() {
        return local;
      },
      get snap() {
        return snaps.at(-1)?.s;
      },
    },
  });
}

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  if (phase === 'race' && local) {
    acc += dt;
    let n = 0;
    for (; acc >= DT && n < 5; n++, acc -= DT) tick();
    if (n === 5) acc = 0;
  }
  const decay = Math.exp(-dt * 12);
  smooth.x *= decay;
  smooth.z *= decay;

  if ((phase === 'desk' || phase === 'race') && snaps.length) renderWorld(now, time, dt);
  else {
    setViewFloor(TOP_FLOOR);
    cam.overview(time, TOP_Y);
  }
  for (const layer of wetLayers) layer.update(time);
  renderer.render(scene, cam.camera);
}
requestAnimationFrame(frame);

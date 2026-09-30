import './ui/style.css';
import * as THREE from 'three';
import {
  DT,
  FLOOR_HEIGHT,
  GUARD_FLOOR,
  JANITOR_FLOOR,
  MAP_H,
  MAP_W,
  TOP_FLOOR,
  gateDist,
  heightAt,
  isStaticWet,
  keyFloor,
  keyLocal,
  stairAt,
  stepPlayer,
  tileKey,
  type Phase,
  type PlayerInput,
  type PlayerSim,
  type RoomMsg,
  type SnapMsg,
  type SnapPlayer,
} from '@tenggo/shared';
import { sfx, unlockAudio } from './audio';
import { Keyboard } from './input/keyboard';
import { Joystick, bindActionButtons, type Actions } from './input/touch';
import { Net } from './net';
import { PLAYER_COLORS } from './palette';
import { FollowCamera } from './scene/camera';
import { Character, lerpAngle, type CharacterView } from './scene/characters';
import { Props } from './scene/items';
import { buildOffice } from './scene/office';
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

// Matahari sore dari jendela: satu lampu berbayang yang mencakup seluruh gedung.
const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
const TOP_Y = TOP_FLOOR * FLOOR_HEIGHT;
sun.position.set(MAP_W / 2 - 7, TOP_Y + 24, MAP_H / 2 - 9);
sun.target.position.set(MAP_W / 2, TOP_Y / 2, MAP_H / 2);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: 1, far: 70 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
const floors = buildOffice();
const wetLayers = floors.map((group, f) => new WetLayer(group, f));
scene.add(...floors, new THREE.HemisphereLight(0xffffff, 0x8088a0, 1.9), sun, sun.target);

/** Yang ditampilkan: lantai tempat pemain berada dan satu lantai di bawahnya (terlihat lewat lubang tangga). */
let viewFloor = TOP_FLOOR;
const floorVisible = (f: number) => f === viewFloor || f === viewFloor - 1;
function setViewFloor(f: number) {
  viewFloor = f;
  floors.forEach((group, i) => (group.visible = floorVisible(i)));
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

const actions: Actions = { push: false, throw: false };
const keyboard = new Keyboard(actions);
const joystick = new Joystick($('joystick'), $('knob'));
bindActionButtons(actions, $('btn-push'), $('btn-throw'));
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

let dynWet = new Set<number>();
const isWet = (f: number, tx: number, tz: number) => isStaticWet(f, tx, tz) || dynWet.has(tileKey(f, tx, tz));

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

function onSnap(s: SnapMsg) {
  const before = snaps.at(-1)?.s;
  setPhase(s.phase);
  snaps.push({ at: performance.now(), s });
  if (snaps.length > 30) snaps.shift();
  dynWet = new Set(s.wet);
  if (before) playEvents(before, s);

  const me = s.players.find((p) => p.id === myId);
  if (!me) return;
  // Rekonsiliasi: mulai dari state server, lalu ulangi input yang belum diproses server.
  const old = local;
  local = simFromSnap(me);
  pending = pending.filter((i) => i.s > s.ack);
  for (const i of pending) stepPlayer(local, i, isWet);
  if (old && prevLocal) {
    const cx = local.x - old.x;
    const cz = local.z - old.z;
    prevLocal.x += cx;
    prevLocal.z += cz;
    if (Math.hypot(cx, cz) < 3) {
      smooth.x -= cx;
      smooth.z -= cz;
    } else smooth.x = smooth.z = 0;
  } else prevLocal = { ...local };
}

function playEvents(a: SnapMsg, b: SnapMsg) {
  const prev = new Map(a.players.map((p) => [p.id, p]));
  for (const p of b.players) {
    const was = prev.get(p.id);
    if (!was) continue;
    if (p.st === 'slip' && was.st === 'active') (isWet(p.fl, Math.floor(p.x), Math.floor(p.z)) ? sfx.slip : sfx.bonk)();
    if (p.st === 'done' && was.st !== 'done') sfx.finish();
    if (p.id === myId && p.item && !was.item) sfx.pickup();
    // Naik lantai mendadak dalam keadaan terduduk = baru saja ditangkap penjaga.
    if (p.fl > was.fl && p.st === 'down' && was.fl === GUARD_FLOOR) {
      sfx.caught();
      if (p.id === myId) hud.flash('KETAHUAN HR!');
    }
  }
  const known = new Set(a.projs.map((p) => p.id));
  if (b.projs.some((p) => !known.has(p.id))) sfx.whoosh();
}

// ---------- Loop ----------

function tick() {
  if (!local) return;
  const mv = joystick.active ? joystick.move() : keyboard.move();
  const inp: PlayerInput = { s: ++seq, x: mv.x, z: mv.z, w: mv.walk, p: actions.push, th: actions.throw };
  actions.push = actions.throw = false;
  net.send({ t: 'in', ...inp });
  pending.push(inp);
  if (pending.length > 90) pending.shift();
  prevLocal = { ...local };
  stepPlayer(local, inp, isWet);
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

function renderWorld(now: number, time: number, dt: number) {
  const latest = snaps.at(-1)!.s;
  const { a, b, t } = sample(now);
  const roster = new Map(room?.players.map((p) => [p.id, p]));
  const colorOf = (id: number) => PLAYER_COLORS[(roster.get(id)?.color ?? 0) % PLAYER_COLORS.length];

  // Lantai yang sedang dilihat mengikuti pemain sendiri
  const meNow = latest.players.find((p) => p.id === myId);
  setViewFloor(peek?.f ?? (phase === 'race' && local ? local.floor : (meNow?.fl ?? TOP_FLOOR)));

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
    const view: CharacterView = {
      visible: true,
      label: true,
      x: lerp(pa.x, pb.x, t),
      y: 0,
      z: lerp(pa.z, pb.z, t),
      face: lerpAngle(pa.f, pb.f, t),
      state: pb.st,
      invuln: pb.inv > 0,
      item: pb.item,
      pushCd: pb.cd,
    };
    if (pb.id === myId) {
      if (phase === 'race' && local && prevLocal) {
        const alpha = Math.min(1, acc / DT);
        view.x = lerp(prevLocal.x, local.x, alpha) + smooth.x;
        view.z = lerp(prevLocal.z, local.z, alpha) + smooth.z;
        view.face = local.face;
        view.state = local.state;
        view.invuln = local.invuln > 0;
        floor = local.floor;
      }
      mine = view;
    }
    view.y = heightAt(floor, view.x, view.z);
    view.visible = floorVisible(floor);
    view.label = floor === viewFloor || !!stairAt(floor, view.x, view.z);
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

  // Proyektil, item, genangan, petugas
  const projA = new Map(a.projs.map((p) => [p.id, p]));
  props.syncProjectiles(
    b.projs.map((p) => {
      const pa = projA.get(p.id) ?? p;
      return { ...p, x: lerp(pa.x, p.x, t), z: lerp(pa.z, p.z, t) };
    }),
    time,
    floorVisible,
  );
  props.sync(latest.items, time, floorVisible);
  wetLayers.forEach((layer, f) => layer.setDynamic(latest.wet.filter((k) => keyFloor(k) === f).map(keyLocal)));
  const jdx = b.jan[0] - a.jan[0];
  const jdz = b.jan[1] - a.jan[1];
  props.setJanitor(
    {
      x: lerp(a.jan[0], b.jan[0], t),
      z: lerp(a.jan[1], b.jan[1], t),
      face: jdx || jdz ? Math.atan2(jdx, jdz) : Math.PI / 2,
      moving: !!(jdx || jdz),
      visible: floorVisible(JANITOR_FLOOR),
    },
    time,
  );

  props.setGuards(
    b.hr.map(([x, z, face], i) => {
      const [ax, az, aface] = a.hr[i] ?? [x, z, face];
      return { x: lerp(ax, x, t), z: lerp(az, z, t), face: lerpAngle(aface, face, t), moving: ax !== x || az !== z };
    }),
    floorVisible(GUARD_FLOOR),
    viewFloor === GUARD_FLOOR,
    time,
  );

  if (peek) cam.follow(peek.x, peek.f * FLOOR_HEIGHT, peek.z, dt);
  else if (mine) cam.follow(mine.x, mine.y, mine.z, dt);
  else cam.overview(time, TOP_Y);

  // HUD
  const me = latest.players.find((p) => p.id === myId);
  if (!me) return;
  const order = [...latest.players].sort(
    (p, q) => (p.rank || 1000 + gateDist(p.fl, p.x, p.z)) - (q.rank || 1000 + gateDist(q.fl, q.x, q.z)),
  );
  hud.update({
    phase,
    time: latest.time,
    place: order.findIndex((p) => p.id === myId) + 1,
    total: order.length,
    state: local?.state ?? me.st,
    stateT: local?.stateT ?? me.sT,
    rank: me.rank,
    pushCd: me.cd,
    item: me.item,
    floor: viewFloor,
    det: me.det,
    guards: viewFloor === GUARD_FLOOR ? latest.hr.map(([x, z]) => ({ x, z })) : [],
    wet: latest.wet.filter((k) => keyFloor(k) === viewFloor).map(keyLocal),
    dots: latest.players
      .filter((p) => p.st !== 'done' && p.fl === viewFloor)
      .map((p) => ({ x: p.x, z: p.z, color: colorOf(p.id), me: p.id === myId })),
  });
}

// Pegangan untuk debugging dari console; tidak ikut ke build produksi.
// __tenggo.peek = { f, x, z } mengarahkan kamera ke titik mana pun di gedung; null untuk kembali.
let peek: { f: number; x: number; z: number } | null = null;
if (import.meta.env.DEV) {
  Object.assign(window, {
    __tenggo: {
      set peek(v: typeof peek) {
        peek = v;
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
  else cam.overview(time, TOP_Y);
  for (const layer of wetLayers) layer.update(time);
  renderer.render(scene, cam.camera);
}
requestAnimationFrame(frame);

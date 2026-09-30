import { PLANS } from './building';
import { DT } from './constants';
import { ALL_OPEN, lineBlocked, stairAt, type FloorPoint, type Point } from './map';
import type { PlayerSim } from './physics';

// Petak umpet: HR, manajer, dan direktur berpatroli di Lantai 3. Karyawan yang terlihat terlalu lama
// dikembalikan ke lobi lift Lantai 4 dan harus antre lift lagi.
export const GUARD_FLOOR = 3;
export const GUARD_SPEED = 2.4;
export const GUARD_TURN = 2.6; // radian/detik saat berbelok
export const GUARD_PAUSE = 0.9; // berhenti dan berbelok di tiap sudut rute
export const VISION_RANGE = 5;
export const VISION_HALF_ANGLE = 0.6;
export const BUMP_RANGE = 0.9; // sedekat ini pasti ketahuan, dari arah mana pun
export const DETECT_TIME = 0.3; // lama terlihat sampai tertangkap
export const DETECT_DECAY = 0.8; // lama kecurigaan hilang setelah lolos dari pandangan
export const CAUGHT_DOWN_TIME = 1.2;

export interface GuardDef {
  name: string;
  route: readonly Point[]; // dijalani berkeliling terus-menerus
}

export const GUARDS: readonly GuardDef[] = PLANS[GUARD_FLOOR].patrols.map((p) => ({
  name: p.name,
  route: p.pts.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 })),
}));

export interface GuardSim {
  x: number;
  z: number;
  face: number;
  wp: number;
  pause: number;
}

const angleTo = (from: Point, to: Point) => Math.atan2(to.x - from.x, to.z - from.z);

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function newGuard(def: GuardDef): GuardSim {
  return { ...def.route[0], face: angleTo(def.route[0], def.route[1]), wp: 1, pause: 0 };
}

export function stepGuard(g: GuardSim, def: GuardDef): void {
  const target = def.route[g.wp];
  const want = angleTo(g, target);
  if (g.pause > 0) {
    // Berbelok pelan-pelan, sehingga pandangannya menyapu sekitar.
    g.pause -= DT;
    const d = angleDiff(g.face, want);
    const step = GUARD_TURN * DT;
    g.face += Math.abs(d) <= step ? d : Math.sign(d) * step;
    return;
  }
  const d = Math.hypot(target.x - g.x, target.z - g.z);
  const step = GUARD_SPEED * DT;
  if (d <= step) {
    g.x = target.x;
    g.z = target.z;
    g.wp = (g.wp + 1) % def.route.length;
    g.pause = GUARD_PAUSE;
    return;
  }
  g.face = want;
  g.x += ((target.x - g.x) / d) * step;
  g.z += ((target.z - g.z) / d) * step;
}

/** Seberapa jauh pandangan dari (x, z) ke arah angle sebelum terhalang dinding atau perabot tinggi. */
export function sightDist(x: number, z: number, angle: number, max = VISION_RANGE): number {
  const sx = Math.sin(angle);
  const sz = Math.cos(angle);
  let clear = 0;
  for (let t = 0.25; t <= max + 1e-6; t += 0.25) {
    if (lineBlocked(GUARD_FLOOR, x + sx * clear, z + sz * clear, x + sx * t, z + sz * t, ALL_OPEN, true)) return clear;
    clear = t;
  }
  return max;
}

/** Tangga dan kabin lift adalah zona aman: penjaga tidak melihat siapa pun di sana. */
export function canSee(g: GuardSim, p: { floor: number; x: number; z: number }): boolean {
  if (p.floor !== GUARD_FLOOR || stairAt(p.floor, p.x, p.z)) return false;
  const d = Math.hypot(p.x - g.x, p.z - g.z);
  if (d > VISION_RANGE) return false;
  if (d > BUMP_RANGE && Math.abs(angleDiff(g.face, angleTo(g, p))) > VISION_HALF_ANGLE) return false;
  return !lineBlocked(GUARD_FLOOR, g.x, g.z, p.x, p.z, ALL_OPEN, true);
}

/** Tingkat kecurigaan 0..1; mencapai 1 berarti tertangkap. */
export function stepDetection(det: number, seen: boolean): number {
  return seen ? det + DT / DETECT_TIME : Math.max(0, det - DT / DETECT_DECAY);
}

// Titik kembali: lobi lift satu lantai di atas, di depan kedua pintu lift.
export const CAUGHT_RESPAWN: FloorPoint = { f: GUARD_FLOOR + 1, x: 30, z: 19 };

/** Ketahuan: dikembalikan ke lantai atas, terduduk sebentar, dan barang bawaannya disita. */
export function catchPlayer(p: PlayerSim): void {
  sendBack(p, CAUGHT_RESPAWN, CAUGHT_DOWN_TIME);
}

/** Memindahkan pemain ke suatu titik dalam keadaan terduduk (ketahuan penjaga, tertabrak mobil). */
export function sendBack(p: PlayerSim, to: FloorPoint, downTime: number): void {
  p.floor = to.f;
  p.x = to.x;
  p.z = to.z;
  p.vx = p.vz = 0;
  p.state = 'down';
  p.stateT = downTime;
  p.item = null;
}

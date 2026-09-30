import { DT } from './constants';
import { STAIRS, stairAt, tileAt, type FloorPoint, type Point } from './map';
import type { PlayerSim } from './physics';

// Petak umpet: HR dan manajer berpatroli di satu lantai. Karyawan yang terlihat terlalu lama
// dikembalikan ke lantai di atasnya.
export const GUARD_FLOOR = 1;
export const GUARD_SPEED = 2.4;
export const GUARD_TURN = 2.6; // radian/detik saat berbalik di ujung rute
export const GUARD_PAUSE = 1.4; // berhenti dan berbalik di tiap ujung rute
export const VISION_RANGE = 5;
export const VISION_HALF_ANGLE = 0.6;
export const BUMP_RANGE = 0.9; // sedekat ini pasti ketahuan, dari arah mana pun
export const DETECT_TIME = 0.3; // lama terlihat sampai tertangkap
export const DETECT_DECAY = 0.8; // lama kecurigaan hilang setelah lolos dari pandangan
export const CAUGHT_DOWN_TIME = 1.2;

export interface GuardDef {
  name: string;
  route: readonly Point[]; // dijalani berulang; dua titik berarti bolak-balik
}

export const GUARDS: readonly GuardDef[] = [
  { name: 'HR', route: [{ x: 3.5, z: 12.5 }, { x: 25.5, z: 12.5 }] }, // lorong
  { name: 'Manajer', route: [{ x: 27.5, z: 6.5 }, { x: 2.5, z: 6.5 }] }, // ruang meeting dan pantry
];

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
    // Berbalik pelan-pelan, sehingga pandangannya menyapu sekitar.
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

// Dinding dan perabot tinggi menghalangi pandangan; meja dan sofa tidak.
const SIGHT_BLOCKERS = '#CKMP';
const blocksSight = (tx: number, tz: number) => SIGHT_BLOCKERS.includes(tileAt(GUARD_FLOOR, tx, tz));

/** Seberapa jauh pandangan dari (x, z) ke arah angle sebelum terhalang, maksimal max. */
export function sightDist(x: number, z: number, angle: number, max = VISION_RANGE): number {
  const sx = Math.sin(angle);
  const sz = Math.cos(angle);
  for (let t = 0.15; t < max; t += 0.15) if (blocksSight(Math.floor(x + sx * t), Math.floor(z + sz * t))) return t;
  return max;
}

/** Tangga adalah zona aman: penjaga tidak melihat siapa pun yang masih di tangga. */
export function canSee(g: GuardSim, p: { floor: number; x: number; z: number }): boolean {
  if (p.floor !== GUARD_FLOOR || stairAt(p.floor, p.x, p.z)) return false;
  const d = Math.hypot(p.x - g.x, p.z - g.z);
  if (d > VISION_RANGE) return false;
  const angle = angleTo(g, p);
  if (d > BUMP_RANGE && Math.abs(angleDiff(g.face, angle)) > VISION_HALF_ANGLE) return false;
  return sightDist(g.x, g.z, angle, d) >= d;
}

/** Tingkat kecurigaan 0..1; mencapai 1 berarti tertangkap. */
export function stepDetection(det: number, seen: boolean): number {
  return seen ? det + DT / DETECT_TIME : Math.max(0, det - DT / DETECT_DECAY);
}

// Titik kembali: beberapa langkah sebelum mulut tangga yang turun ke lantai penjaga.
export const CAUGHT_RESPAWN: FloorPoint = (() => {
  const s = STAIRS.find((st) => st.upper === GUARD_FLOOR + 1)!;
  const midX = (s.minX + s.maxX) / 2;
  const midZ = (s.minZ + s.maxZ) / 2;
  const back = 2.5;
  const at =
    s.dir === '>' ? { x: s.minX - back, z: midZ }
    : s.dir === '<' ? { x: s.maxX + back, z: midZ }
    : s.dir === 'v' ? { x: midX, z: s.minZ - back }
    : { x: midX, z: s.maxZ + back };
  return { f: s.upper, ...at };
})();

/** Ketahuan: dikembalikan ke lantai atas, terduduk sebentar, dan barang bawaannya disita. */
export function catchPlayer(p: PlayerSim): void {
  p.floor = CAUGHT_RESPAWN.f;
  p.x = CAUGHT_RESPAWN.x;
  p.z = CAUGHT_RESPAWN.z;
  p.vx = p.vz = 0;
  p.state = 'down';
  p.stateT = CAUGHT_DOWN_TIME;
  p.item = null;
}

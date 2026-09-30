// Pertanyaan-pertanyaan tentang denah: tile padat, dinding tipis, tangga, lift, dan jarak ke finis.
// Koordinat: x ke kanan, z ke bawah, satu tile = 1 x 1. Tiap lantai punya koordinat lokal sendiri.
import { BUS, LIFT_A, LIFT_B, MAP_H, MAP_W, PLANS } from './building';

export { MAP_H, MAP_W } from './building';

export const FLOOR_COUNT = PLANS.length;
export const TOP_FLOOR = FLOOR_COUNT - 1;
export const OUTDOOR = 0;
export const LOBBY = 1;
export const FLOOR_HEIGHT = 2.4;
export const WALL_HALF = 0.08; // setengah tebal dinding
const FLOOR_TILES = MAP_W * MAP_H;

export interface Point {
  x: number;
  z: number;
}

export interface FloorPoint extends Point {
  f: number;
}

/** Hal-hal di dunia yang berubah selama ronde dan memengaruhi gerak. */
export interface World {
  wet(f: number, tx: number, tz: number): boolean;
  doorOpen(id: number): boolean;
}

// ---------- Portal lobby <-> area luar ----------
// Area luar menempel di selatan lobby pada ketinggian yang sama. Baris z = 3 di area luar adalah
// baris z = 34 di lobby (dinding selatan gedung), jadi melewati pintu putar tidak terasa berpindah.
export const PORTAL_DZ = MAP_H - 3;
const OUT_MIN_Z = 3;

/** Ketinggian lantai. Lobby dan area luar sama-sama di permukaan tanah. */
export const floorY = (f: number) => Math.max(0, f - 1) * FLOOR_HEIGHT;
/** Geseran z lantai di dunia 3D (hanya area luar yang digeser). */
export const floorOffsetZ = (f: number) => (f === OUTDOOR ? PORTAL_DZ : 0);

// ---------- Tile ----------

function lookup(arr: 'solid' | 'tall' | 'wetCells', f: number, tx: number, tz: number, outside: boolean): boolean {
  if (f === LOBBY && tz >= MAP_H) {
    f = OUTDOOR;
    tz -= PORTAL_DZ;
  } else if (f === OUTDOOR && tz < OUT_MIN_Z) {
    f = LOBBY;
    tz += PORTAL_DZ;
  }
  if (tx < 0 || tx >= MAP_W || tz < 0 || tz >= MAP_H || f < 0 || f >= FLOOR_COUNT) return outside;
  return PLANS[f][arr][tz * MAP_W + tx] === 1;
}

export const isSolid = (f: number, tx: number, tz: number) => lookup('solid', f, tx, tz, true);
export const isStaticWet = (f: number, tx: number, tz: number) => lookup('wetCells', f, tx, tz, false);
const isTall = (f: number, tx: number, tz: number) => lookup('tall', f, tx, tz, true);

/** Kunci unik tile di seluruh gedung. */
export const tileKey = (f: number, tx: number, tz: number) => f * FLOOR_TILES + tz * MAP_W + tx;
export const keyFloor = (key: number) => Math.floor(key / FLOOR_TILES);
/** Kunci tile di dalam lantainya sendiri (tz * MAP_W + tx). */
export const keyLocal = (key: number) => key % FLOOR_TILES;

// ---------- Dinding ----------

/**
 * Apakah sisi tile tertutup. horizontal = sisi ATAS tile (tx, tz), yaitu garis dari (tx, tz) ke (tx + 1, tz);
 * selain itu sisi KIRI tile, garis dari (tx, tz) ke (tx, tz + 1). Pintu lift dan bus bertanya ke world.
 */
export function edgeBlocked(f: number, horizontal: boolean, tx: number, tz: number, world: World): boolean {
  if (f === LOBBY && tz > MAP_H - (horizontal ? 0 : 1)) {
    f = OUTDOOR;
    tz -= PORTAL_DZ;
  } else if (f === OUTDOOR && tz < OUT_MIN_Z) {
    f = LOBBY;
    tz += PORTAL_DZ;
  }
  const plan = PLANS[f];
  if (horizontal) {
    if (tx < 0 || tx >= MAP_W || tz < 0 || tz > MAP_H) return false;
    const i = tz * MAP_W + tx;
    return plan.h[i] !== 0 && (plan.hDyn[i] < 0 || !world.doorOpen(plan.hDyn[i]));
  }
  if (tx < 0 || tx > MAP_W || tz < 0 || tz >= MAP_H) return false;
  const i = tz * (MAP_W + 1) + tx;
  return plan.v[i] !== 0 && (plan.vDyn[i] < 0 || !world.doorOpen(plan.vDyn[i]));
}

/** Bisakah melangkah satu tile ke arah (dx, dz): tidak ada perabot di tujuan dan tidak ada dinding di antaranya. */
export function canStep(f: number, tx: number, tz: number, dx: number, dz: number, world: World): boolean {
  if (isSolid(f, tx + dx, tz + dz)) return false;
  if (dx === 1) return !edgeBlocked(f, false, tx + 1, tz, world);
  if (dx === -1) return !edgeBlocked(f, false, tx, tz, world);
  if (dz === 1) return !edgeBlocked(f, true, tx, tz + 1, world);
  return !edgeBlocked(f, true, tx, tz, world);
}

function wallBetween(f: number, ax: number, az: number, bx: number, bz: number, world: World): boolean {
  if (ax === bx && az === bz) return false;
  if (bx !== ax) return edgeBlocked(f, false, Math.max(ax, bx), az, world);
  return edgeBlocked(f, true, ax, Math.max(az, bz), world);
}

/**
 * Apakah garis lurus antara dua titik terhalang dinding (dan, bila tall, perabot tinggi).
 * Dipakai untuk pandangan penjaga dan lintasan lemparan.
 */
export function lineBlocked(f: number, x0: number, z0: number, x1: number, z1: number, world: World, tall: boolean): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  let cx = Math.floor(x0);
  let cz = Math.floor(z0);
  for (let i = 1; i <= steps; i++) {
    const nx = Math.floor(x0 + ((x1 - x0) * i) / steps);
    const nz = Math.floor(z0 + ((z1 - z0) * i) / steps);
    if (nx === cx && nz === cz) continue;
    // Langkah diagonal dipecah jadi dua langkah lurus; terhalang bila kedua jalurnya tertutup.
    const viaX = !wallBetween(f, cx, cz, nx, cz, world) && !wallBetween(f, nx, cz, nx, nz, world);
    const viaZ = !wallBetween(f, cx, cz, cx, nz, world) && !wallBetween(f, cx, nz, nx, nz, world);
    if (!viaX && !viaZ) return true;
    if (tall && isTall(f, nx, nz)) return true;
    cx = nx;
    cz = nz;
  }
  return false;
}

// ---------- Tangga ----------

export interface Stair {
  upper: number; // lantai di ujung atas; ujung bawah ada di lantai upper - 1
  minX: number;
  maxX: number; // eksklusif
  minZ: number; // ujung atas
  maxZ: number; // ujung bawah, eksklusif
}

// Semua tangga menurun ke arah +z. Tergambar di lantai atas (mode 'turun').
export const STAIRS: Stair[] = PLANS.flatMap((plan) =>
  plan.stairs.filter((s) => s.mode === 'turun').map((s) => ({ upper: plan.no, minX: s.x0, maxX: s.x1, minZ: s.z0, maxZ: s.z1 })),
);

export function stairAt(f: number, x: number, z: number): Stair | undefined {
  for (const s of STAIRS) if ((f === s.upper || f === s.upper - 1) && x >= s.minX && x < s.maxX && z >= s.minZ && z < s.maxZ) return s;
  return undefined;
}

/** Seberapa jauh sudah turun: 0 di ujung atas, 1 di ujung bawah. */
export const stairProgress = (s: Stair, z: number) => Math.max(0, Math.min(1, (z - s.minZ) / (s.maxZ - s.minZ)));

/**
 * Membetulkan lantai (dan z, untuk portal) setelah sesuatu bergerak: di tangga pindah lantai terjadi
 * di tengah tangga; melewati pintu putar memindahkan antara lobby dan area luar.
 */
export function relocate(p: { floor: number; x: number; z: number }): void {
  if (p.floor === LOBBY && p.z >= MAP_H) {
    p.floor = OUTDOOR;
    p.z -= PORTAL_DZ;
  } else if (p.floor === OUTDOOR && p.z < OUT_MIN_Z) {
    p.floor = LOBBY;
    p.z += PORTAL_DZ;
  } else {
    const s = stairAt(p.floor, p.x, p.z);
    if (s) p.floor = stairProgress(s, p.z) >= 0.5 ? s.upper - 1 : s.upper;
  }
}

/** Ketinggian pijakan di suatu titik, termasuk kemiringan tangga. (Kabin lift dihitung terpisah.) */
export function heightAt(f: number, x: number, z: number): number {
  const s = stairAt(f, x, z);
  return s ? (s.upper - 1 - stairProgress(s, z)) * FLOOR_HEIGHT : floorY(f);
}

// ---------- Lift ----------

/** Dua zona lift, masing-masing dua kabin di posisi denah yang sama. */
export const LIFT_ZONES = [{ top: 4, bottom: 3 }, { top: 2, bottom: 1 }] as const;
export const LIFT_RECTS = [LIFT_A, LIFT_B] as const;

export function inCabin(car: number, x: number, z: number): boolean {
  const [x0, z0, x1, z1] = LIFT_RECTS[car];
  return x >= x0 && x < x1 && z >= z0 && z < z1;
}

// ---------- Titik-titik penting ----------

const cells = (f: number, list: readonly (readonly [number, number])[]): FloorPoint[] => list.map(([x, z]) => ({ f, x: x + 0.5, z: z + 0.5 }));

export const SEATS: FloorPoint[] = cells(TOP_FLOOR, PLANS[TOP_FLOOR].starts);
export const ITEM_SPAWNS: FloorPoint[] = PLANS.flatMap((plan) => cells(plan.no, plan.spawns));
export const inBus = (x: number, z: number) => x >= BUS.x0 && x < BUS.x1 && z >= BUS.z0 && z < BUS.z1;

// ---------- Jarak ke finis ----------

export const ALL_OPEN: World = { wet: () => false, doorOpen: () => true };

// Jarak jalan kaki (dalam tile) dari tiap tile ke bus, menembus tangga, lift, dan pintu putar.
const FINISH_DIST: Float32Array = (() => {
  const dist = new Float32Array(FLOOR_TILES * FLOOR_COUNT).fill(Infinity);
  const queue: number[] = [];
  for (let z = BUS.z0; z < BUS.z1; z++)
    for (let x = BUS.x0; x < BUS.x1; x++) {
      dist[tileKey(OUTDOOR, x, z)] = 0;
      queue.push(OUTDOOR, x, z);
    }
  for (let i = 0; i < queue.length; i += 3) {
    const f = queue[i];
    const tx = queue[i + 1];
    const tz = queue[i + 2];
    const d = dist[tileKey(f, tx, tz)] + 1;
    const next: number[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!canStep(f, tx, tz, dx, dz, ALL_OPEN)) continue;
      const at = { floor: f, x: tx + dx + 0.5, z: tz + dz + 0.5 };
      // Di tangga, relocate memilih lantai menurut posisi; untuk pencarian kita tetap di lantai semula.
      if (!stairAt(f, at.x, at.z)) relocate(at);
      next.push(at.floor, Math.floor(at.x), Math.floor(at.z));
    }
    const s = stairAt(f, tx + 0.5, tz + 0.5);
    if (s) next.push(f === s.upper ? f - 1 : f + 1, tx, tz);
    for (const zone of LIFT_ZONES)
      if ((f === zone.top || f === zone.bottom) && (inCabin(0, tx, tz) || inCabin(1, tx, tz))) next.push(f === zone.top ? zone.bottom : zone.top, tx, tz);
    for (let n = 0; n < next.length; n += 3) {
      const key = tileKey(next[n], next[n + 1], next[n + 2]);
      if (dist[key] <= d) continue;
      dist[key] = d;
      queue.push(next[n], next[n + 1], next[n + 2]);
    }
  }
  return dist;
})();

/** Sisa jarak ke bus dari suatu titik; Infinity bila tidak terjangkau. */
export function finishDist(f: number, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (f < 0 || f >= FLOOR_COUNT || tx < 0 || tx >= MAP_W || tz < 0 || tz >= MAP_H) return Infinity;
  return FINISH_DIST[tileKey(f, tx, tz)];
}

// ---------- Petugas kebersihan ----------

export const JANITORS: readonly { floor: number; route: readonly Point[] }[] = PLANS.flatMap((plan) =>
  plan.janitor ? [{ floor: plan.no, route: plan.janitor.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 })) }] : [],
);

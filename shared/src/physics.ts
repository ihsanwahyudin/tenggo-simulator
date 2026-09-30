import {
  DT,
  INVULN_TIME,
  PLAYER_RADIUS,
  RUN_SPEED,
  SLIDE_DAMPING,
  SLIP_DOWN_TIME,
  SLIP_SPEED,
  SLIP_TIME,
  WALK_SPEED,
} from './constants';
import { WALL_HALF, edgeBlocked, isSolid, relocate, type World } from './map';

export type PlayerState = 'seated' | 'active' | 'slip' | 'down' | 'done';
export type ItemKind = 'stapler' | 'kertas' | 'kopi';

export interface PlayerSim {
  floor: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  face: number; // sudut hadap; arah = (sin face, cos face)
  state: PlayerState;
  stateT: number; // sisa waktu state slip/down
  downT: number; // lama jatuh setelah selesai meluncur
  invuln: number;
  pushCd: number;
  item: ItemKind | null;
}

export interface PlayerInput {
  s: number; // nomor urut
  x: number;
  z: number;
  w: boolean; // jalan pelan
  p: boolean; // dorong
  th: boolean; // lempar
  u: boolean; // pakai (tombol tutup pintu lift)
}

export function newSim(floor: number, x: number, z: number, face = 0): PlayerSim {
  return { floor, x, z, vx: 0, vz: 0, face, state: 'seated', stateT: 0, downT: 0, invuln: 0, pushCd: 0, item: null };
}

/** Mendorong lingkaran keluar dari sebuah kotak. */
function pushOut(p: { x: number; z: number }, r: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
  const cx = p.x < minX ? minX : p.x > maxX ? maxX : p.x;
  const cz = p.z < minZ ? minZ : p.z > maxZ ? maxZ : p.z;
  const nx = p.x - cx;
  const nz = p.z - cz;
  const d2 = nx * nx + nz * nz;
  if (d2 >= r * r) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    p.x += nx * push;
    p.z += nz * push;
    return;
  }
  // Titik tengah ada di dalam kotak: keluarkan lewat sisi terdekat.
  const l = p.x - minX;
  const rt = maxX - p.x;
  const u = p.z - minZ;
  const dn = maxZ - p.z;
  const m = Math.min(l, rt, u, dn);
  if (m === l) p.x = minX - r;
  else if (m === rt) p.x = maxX + r;
  else if (m === u) p.z = minZ - r;
  else p.z = maxZ + r;
}

/** Menggeser lalu mengeluarkan dari perabot dan dinding. Lantai ikut diperbarui (tangga, pintu putar). */
export function moveWithCollision(p: { floor: number; x: number; z: number }, dx: number, dz: number, world: World, r = PLAYER_RADIUS): void {
  p.x += dx;
  p.z += dz;
  const f = p.floor;
  const reach = r + WALL_HALF;
  for (let iter = 0; iter < 2; iter++) {
    const tx0 = Math.floor(p.x - reach);
    const tx1 = Math.floor(p.x + reach);
    const tz0 = Math.floor(p.z - reach);
    const tz1 = Math.floor(p.z + reach);
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1; tx++) if (isSolid(f, tx, tz)) pushOut(p, r, tx, tz, tx + 1, tz + 1);
    for (let tz = tz0; tz <= tz1 + 1; tz++)
      for (let tx = tx0; tx <= tx1; tx++)
        if (edgeBlocked(f, true, tx, tz, world)) pushOut(p, r, tx, tz - WALL_HALF, tx + 1, tz + WALL_HALF);
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1 + 1; tx++)
        if (edgeBlocked(f, false, tx, tz, world)) pushOut(p, r, tx - WALL_HALF, tz, tx + WALL_HALF, tz + 1);
  }
  relocate(p);
}

/** Menjatuhkan pemain: meluncur sebentar ke arah (dx, dz), lalu tergeletak selama downTime. */
export function knock(p: PlayerSim, dx: number, dz: number, downTime: number, speed: number, slideTime: number): void {
  p.state = 'slip';
  p.vx = dx * speed;
  p.vz = dz * speed;
  p.stateT = slideTime;
  p.downT = downTime;
  p.item = null;
}

/** Satu tick simulasi untuk satu pemain. Dipakai server dan prediksi di client. */
export function stepPlayer(p: PlayerSim, input: PlayerInput, world: World): void {
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - DT);
  if (p.pushCd > 0) p.pushCd = Math.max(0, p.pushCd - DT);

  switch (p.state) {
    case 'seated':
    case 'done':
      return;
    case 'down':
      p.stateT -= DT;
      if (p.stateT <= 0) {
        p.state = 'active';
        p.stateT = 0;
        p.invuln = INVULN_TIME;
      }
      return;
    case 'slip':
      moveWithCollision(p, p.vx * DT, p.vz * DT, world);
      p.vx *= SLIDE_DAMPING;
      p.vz *= SLIDE_DAMPING;
      p.stateT -= DT;
      if (p.stateT <= 0) {
        p.state = 'down';
        p.stateT = p.downT;
        p.vx = 0;
        p.vz = 0;
      }
      return;
    case 'active': {
      const len = Math.hypot(input.x, input.z);
      if (len < 0.01) return;
      const mx = input.x / len;
      const mz = input.z / len;
      const speed = input.w ? WALK_SPEED : RUN_SPEED;
      moveWithCollision(p, mx * speed * DT, mz * speed * DT, world);
      p.face = Math.atan2(mx, mz);
      if (!input.w && p.invuln <= 0 && world.wet(p.floor, Math.floor(p.x), Math.floor(p.z)))
        knock(p, mx, mz, SLIP_DOWN_TIME, SLIP_SPEED, SLIP_TIME);
    }
  }
}

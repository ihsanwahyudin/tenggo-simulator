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
import { floorAt, isSolid } from './map';

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
}

export type WetFn = (f: number, tx: number, tz: number) => boolean;

export function newSim(floor: number, x: number, z: number): PlayerSim {
  return { floor, x, z, vx: 0, vz: 0, face: 0, state: 'seated', stateT: 0, downT: 0, invuln: 0, pushCd: 0, item: null };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Menggeser lalu mengeluarkan dari benda padat. Di tangga, lantai ikut diperbarui. */
export function moveWithCollision(p: { floor: number; x: number; z: number }, dx: number, dz: number, r = PLAYER_RADIUS): void {
  p.x += dx;
  p.z += dz;
  for (let iter = 0; iter < 2; iter++) {
    const tx0 = Math.floor(p.x - r);
    const tx1 = Math.floor(p.x + r);
    const tz0 = Math.floor(p.z - r);
    const tz1 = Math.floor(p.z + r);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!isSolid(p.floor, tx, tz)) continue;
        const nx = p.x - clamp(p.x, tx, tx + 1);
        const nz = p.z - clamp(p.z, tz, tz + 1);
        const d2 = nx * nx + nz * nz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          p.x += nx * push;
          p.z += nz * push;
        } else {
          // Titik tengah ada di dalam tile: keluarkan lewat sisi terdekat.
          const l = p.x - tx;
          const rt = tx + 1 - p.x;
          const u = p.z - tz;
          const dn = tz + 1 - p.z;
          const m = Math.min(l, rt, u, dn);
          if (m === l) p.x = tx - r;
          else if (m === rt) p.x = tx + 1 + r;
          else if (m === u) p.z = tz - r;
          else p.z = tz + 1 + r;
        }
      }
    }
  }
  p.floor = floorAt(p.floor, p.x, p.z);
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
export function stepPlayer(p: PlayerSim, input: PlayerInput, isWet: WetFn): void {
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
      moveWithCollision(p, p.vx * DT, p.vz * DT);
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
      moveWithCollision(p, mx * speed * DT, mz * speed * DT);
      p.face = Math.atan2(mx, mz);
      if (!input.w && p.invuln <= 0 && isWet(p.floor, Math.floor(p.x), Math.floor(p.z)))
        knock(p, mx, mz, SLIP_DOWN_TIME, SLIP_SPEED, SLIP_TIME);
    }
  }
}

import {
  DT,
  PROJECTILE_HIT_RADIUS,
  PUSH_CONE,
  PUSH_COOLDOWN,
  PUSH_DOWN_TIME,
  PUSH_RANGE,
  PUSH_SLIDE_SPEED,
  PUSH_SLIDE_TIME,
  THROW_DOWN_TIME,
  THROW_SLIDE_SPEED,
  THROW_SLIDE_TIME,
} from './constants';
import { lineBlocked, relocate, stairAt, type FloorPoint, type World } from './map';
import { knock, type ItemKind, type PlayerSim } from './physics';

export const ITEM_KINDS: readonly ItemKind[] = ['stapler', 'kertas', 'kopi'];

export const ITEM_STATS: Record<ItemKind, { speed: number; range: number }> = {
  stapler: { speed: 16, range: 9 },
  kertas: { speed: 12, range: 16 },
  kopi: { speed: 11, range: 7 },
};

export interface Projectile {
  id: number;
  kind: ItemKind;
  floor: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number; // sisa jarak tempuh
  owner: number;
}

export const canBeHit = (p: PlayerSim) => p.state === 'active' && p.invuln <= 0;

type Located = { floor: number; x: number; z: number };
/** Sama lantai, atau sama-sama di tangga (pindah lantai terjadi di tengah tangga). */
export const sameLevel = (a: Located, b: Located) =>
  a.floor === b.floor || (!!stairAt(a.floor, a.x, a.z) && stairAt(a.floor, a.x, a.z) === stairAt(b.floor, b.x, b.z));

/** Dorong ke arah hadap. Mengembalikan pemain yang kena. */
export function tryPush(attacker: PlayerSim, others: PlayerSim[], world: World): PlayerSim[] {
  if (attacker.state !== 'active' || attacker.pushCd > 0) return [];
  attacker.pushCd = PUSH_COOLDOWN;
  const fx = Math.sin(attacker.face);
  const fz = Math.cos(attacker.face);
  const hit: PlayerSim[] = [];
  for (const o of others) {
    if (o === attacker || !canBeHit(o) || !sameLevel(attacker, o)) continue;
    const dx = o.x - attacker.x;
    const dz = o.z - attacker.z;
    const d = Math.hypot(dx, dz);
    if (d > PUSH_RANGE) continue;
    if (d > 0.05 && (dx * fx + dz * fz) / d < PUSH_CONE) continue;
    if (lineBlocked(attacker.floor, attacker.x, attacker.z, o.x, o.z, world, false)) continue; // terhalang dinding
    knock(o, fx, fz, PUSH_DOWN_TIME, PUSH_SLIDE_SPEED, PUSH_SLIDE_TIME);
    hit.push(o);
  }
  return hit;
}

export function throwItem(id: number, owner: number, p: PlayerSim): Projectile | null {
  if (p.state !== 'active' || !p.item) return null;
  const kind = p.item;
  p.item = null;
  const dx = Math.sin(p.face);
  const dz = Math.cos(p.face);
  return { id, kind, floor: p.floor, x: p.x + dx * 0.4, z: p.z + dz * 0.4, dx, dz, left: ITEM_STATS[kind].range, owner };
}

export interface ProjectileResult {
  done: boolean;
  hit?: number;
  spill?: FloorPoint; // kopi tumpah di sini
}

/** Satu tick proyektil. Terbang di atas perabot, hanya dinding yang menghentikannya. */
export function stepProjectile(pr: Projectile, targets: { id: number; sim: PlayerSim }[], world: World): ProjectileResult {
  const SUB = 2;
  const step = (ITEM_STATS[pr.kind].speed * DT) / SUB;
  const end = (hit?: number): ProjectileResult => ({
    done: true,
    hit,
    spill: pr.kind === 'kopi' ? { f: pr.floor, x: pr.x, z: pr.z } : undefined,
  });
  for (let i = 0; i < SUB; i++) {
    const nx = pr.x + pr.dx * step;
    const nz = pr.z + pr.dz * step;
    if (lineBlocked(pr.floor, pr.x, pr.z, nx, nz, world, false)) return end();
    pr.x = nx;
    pr.z = nz;
    relocate(pr);
    pr.left -= step;
    for (const t of targets) {
      if (t.id === pr.owner || !canBeHit(t.sim) || !sameLevel(pr, t.sim)) continue;
      if (Math.hypot(t.sim.x - pr.x, t.sim.z - pr.z) > PROJECTILE_HIT_RADIUS) continue;
      knock(t.sim, pr.dx, pr.dz, THROW_DOWN_TIME, THROW_SLIDE_SPEED, THROW_SLIDE_TIME);
      return end(t.id);
    }
    if (pr.left <= 0) return end();
  }
  return { done: false };
}

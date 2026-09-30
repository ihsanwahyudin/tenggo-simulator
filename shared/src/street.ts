import { BUS_DOOR, ROAD, ZEBRAS, MAP_W } from './building';
import { DT, PLAYER_RADIUS } from './constants';
import { OUTDOOR, type FloorPoint } from './map';

// Jalan raya di depan gedung: dua zebra cross berlampu, mobil di tiga lajur, dan bus TransJakarta.

// ---------- Lampu penyeberangan ----------
// Satu putaran: pejalan kaki hijau -> berkedip -> merah (mobil jalan) -> jeda pengosongan.
export const LIGHT_GO = 5;
export const LIGHT_BLINK = 1.5;
export const LIGHT_CARS = 4.5;
export const LIGHT_CLEAR = 1;
export const LIGHT_CYCLE = LIGHT_GO + LIGHT_BLINK + LIGHT_CARS + LIGHT_CLEAR;

export type PedLight = 'go' | 'blink' | 'stop';

/** Lampu pejalan kaki di zebra ke-i. Dua zebra bergantian: saat yang satu hijau, yang lain merah. */
export function pedLight(zebra: number, time: number): PedLight {
  const t = (time + zebra * (LIGHT_CYCLE / 2)) % LIGHT_CYCLE;
  return t < LIGHT_GO ? 'go' : t < LIGHT_GO + LIGHT_BLINK ? 'blink' : 'stop';
}

/** Mobil wajib berhenti sebelum zebra ini (pejalan kaki hijau/berkedip, atau jeda pengosongan). */
function carsMustStop(zebra: number, time: number): boolean {
  const t = (time + zebra * (LIGHT_CYCLE / 2)) % LIGHT_CYCLE;
  return t < LIGHT_GO + LIGHT_BLINK || t >= LIGHT_CYCLE - LIGHT_CLEAR;
}

// ---------- Mobil ----------
export const CAR_SPEED = 7;
export const CAR_LENGTH = 2.6;
export const CAR_HALF_WIDTH = 0.7;
export const CAR_GAP = 1; // jarak antar mobil saat antre
export const CAR_SPAWN_MIN = 1.7; // detik antar mobil per lajur; longgar supaya ada celah untuk menerobos
export const CAR_SPAWN_MAX = 3.4;
export const CAR_KILL_SPEED = 1; // mobil yang nyaris berhenti tidak menabrak
export const RUN_OVER_DOWN = 1.5;
export const RUN_OVER_RESPAWN: FloorPoint = { f: OUTDOOR, x: 30, z: 4.5 };

export interface Car {
  id: number;
  lane: number;
  x: number; // posisi ekor mobil; mobil melaju ke arah +x
  speed: number; // kecepatan pada tick terakhir
}

export interface Traffic {
  cars: Car[];
  nextSpawn: number[]; // per lajur, waktu mobil berikutnya muncul
  nextId: number;
}

export const newTraffic = (): Traffic => ({ cars: [], nextSpawn: ROAD.lanes.map((_, i) => 0.5 + i * 0.6), nextId: 1 });

export function stepTraffic(tr: Traffic, time: number, random: () => number = Math.random): void {
  for (let lane = 0; lane < ROAD.lanes.length; lane++) {
    const inLane = tr.cars.filter((c) => c.lane === lane).sort((a, b) => b.x - a.x);
    let aheadTail = Infinity;
    for (const c of inLane) {
      let limit = aheadTail - CAR_GAP - CAR_LENGTH;
      ZEBRAS.forEach((zb, i) => {
        // Yang moncongnya belum masuk zebra berhenti di garis; yang sudah di dalam tetap jalan.
        if (carsMustStop(i, time) && c.x + CAR_LENGTH <= zb.x0 - 0.3 + 1e-6) limit = Math.min(limit, zb.x0 - 0.3 - CAR_LENGTH);
      });
      const nx = Math.max(c.x, Math.min(c.x + CAR_SPEED * DT, limit));
      c.speed = (nx - c.x) / DT;
      c.x = nx;
      aheadTail = c.x;
    }
    if (time >= tr.nextSpawn[lane] && aheadTail > -CAR_LENGTH + CAR_GAP + 1) {
      tr.cars.push({ id: tr.nextId++, lane, x: -CAR_LENGTH - 1, speed: CAR_SPEED });
      tr.nextSpawn[lane] = time + CAR_SPAWN_MIN + random() * (CAR_SPAWN_MAX - CAR_SPAWN_MIN);
    }
  }
  tr.cars = tr.cars.filter((c) => c.x < MAP_W + 1);
}

/** Apakah pemain di posisi ini tertabrak mobil yang sedang melaju. */
export function hitByCar(tr: Traffic, p: { floor: number; x: number; z: number }): boolean {
  if (p.floor !== OUTDOOR || p.z < ROAD.z0 - PLAYER_RADIUS || p.z > ROAD.z1 + PLAYER_RADIUS) return false;
  return tr.cars.some(
    (c) =>
      c.speed > CAR_KILL_SPEED &&
      Math.abs(p.z - ROAD.lanes[c.lane]) < CAR_HALF_WIDTH + PLAYER_RADIUS &&
      p.x > c.x - PLAYER_RADIUS &&
      p.x < c.x + CAR_LENGTH + PLAYER_RADIUS,
  );
}

// ---------- Bus ----------
export const BUS_ARRIVE = 1.5;
export const BUS_DWELL = 6;
export const BUS_LEAVE = 1.5;
export const BUS_AWAY = 7;
export const BUS_CYCLE = BUS_ARRIVE + BUS_DWELL + BUS_LEAVE + BUS_AWAY;

/** Bus sedang berhenti di halte dengan pintu terbuka. */
export function busDocked(time: number): boolean {
  const t = time % BUS_CYCLE;
  return t >= BUS_ARRIVE && t < BUS_ARRIVE + BUS_DWELL;
}

/** Geseran bus dari posisi berhentinya, untuk animasi: negatif = masih datang, positif = sudah pergi. */
export function busOffset(time: number): number {
  const t = time % BUS_CYCLE;
  const far = 45;
  if (t < BUS_ARRIVE) return -far * (1 - t / BUS_ARRIVE) ** 2;
  if (t < BUS_ARRIVE + BUS_DWELL) return 0;
  if (t < BUS_ARRIVE + BUS_DWELL + BUS_LEAVE) return far * ((t - BUS_ARRIVE - BUS_DWELL) / BUS_LEAVE) ** 2;
  return far;
}

/** Sisa detik sampai pintu bus berikutnya terbuka (0 bila sedang terbuka). */
export function busWait(time: number): number {
  const t = time % BUS_CYCLE;
  if (t < BUS_ARRIVE) return BUS_ARRIVE - t;
  return t < BUS_ARRIVE + BUS_DWELL ? 0 : BUS_CYCLE - t + BUS_ARRIVE;
}

export { BUS_DOOR };

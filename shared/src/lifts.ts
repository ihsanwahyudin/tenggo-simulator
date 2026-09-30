import { DT } from './constants';
import { LIFT_ZONES, inCabin } from './map';
import type { PlayerSim } from './physics';

// Rebutan lift. Tiap zona punya dua kabin; kabin menunggu di atas dengan pintu terbuka, turun begitu
// pintunya ditutup, menurunkan penumpang, lalu naik lagi dalam keadaan kosong.
export const LIFT_AUTO_CLOSE = 4; // pintu menutup sendiri sekian detik setelah orang pertama masuk
export const LIFT_DOOR_TIME = 0.7;
export const LIFT_TRAVEL = 3;
export const LIFT_BOTTOM_WAIT = 3; // paling lama menunggu penumpang keluar di bawah
export const LIFT_BOTTOM_MIN = 1; // pintu bawah terbuka minimal sekian detik
export const LIFT_CAPACITY = 4;
export const LIFT_CARS = LIFT_ZONES.length * 2;

export type LiftPhase = 'top' | 'closing' | 'down' | 'bottom' | 'closingUp' | 'up';
export const LIFT_PHASES: readonly LiftPhase[] = ['top', 'closing', 'down', 'bottom', 'closingUp', 'up'];

export interface LiftCar {
  zone: number;
  car: number;
  phase: LiftPhase;
  t: number; // sisa waktu fase; di fase 'top' berarti hitung mundur tutup pintu (0 = belum ada penumpang)
}

export const newLifts = (): LiftCar[] =>
  LIFT_ZONES.flatMap((_, zone) => [0, 1].map((car) => ({ zone, car, phase: 'top' as LiftPhase, t: 0 })));

/** Pintu dinamis mana yang terbuka: id = zona * 4 + kabin * 2 + ujung (0 atas, 1 bawah). */
export function liftDoorOpen(lifts: readonly LiftCar[], id: number): boolean {
  const lift = lifts[Math.floor(id / 2)];
  return lift.phase === (id % 2 === 0 ? 'top' : 'bottom');
}

/** Posisi kabin: 0 di lantai atas, 1 di lantai bawah. */
export function liftProgress(l: LiftCar): number {
  if (l.phase === 'down') return 1 - l.t / LIFT_TRAVEL;
  if (l.phase === 'up') return l.t / LIFT_TRAVEL;
  return l.phase === 'bottom' || l.phase === 'closingUp' ? 1 : 0;
}

/** Kabin yang sedang membawa pemain ini (pintunya tertutup atau sedang bergerak), kalau ada. */
export function ridingLift(lifts: readonly LiftCar[], p: { floor: number; x: number; z: number }): LiftCar | undefined {
  return lifts.find((l) => l.phase !== 'top' && l.phase !== 'bottom' && riders(l, [p]).length > 0);
}

function riders<T extends { floor: number; x: number; z: number }>(l: LiftCar, players: readonly T[]): T[] {
  const zone = LIFT_ZONES[l.zone];
  const floor = l.phase === 'bottom' || l.phase === 'closingUp' || l.phase === 'up' ? zone.bottom : zone.top;
  return players.filter((p) => p.floor === floor && inCabin(l.car, p.x, p.z));
}

/** Kabin yang pintunya terbuka dan sedang ditempati pemain ini. */
export function liftAt(lifts: readonly LiftCar[], p: { floor: number; x: number; z: number }): LiftCar | undefined {
  return lifts.find((l) => (l.phase === 'top' || l.phase === 'bottom') && riders(l, [p]).length > 0);
}

/** Satu tick untuk satu kabin. closeRequested: ada penumpang yang menekan tombol tutup pintu. */
export function stepLift(l: LiftCar, players: readonly PlayerSim[], closeRequested: boolean): void {
  const zone = LIFT_ZONES[l.zone];
  const inside = riders(l, players);
  switch (l.phase) {
    case 'top':
      if (inside.length === 0) {
        l.t = 0;
        return;
      }
      if (l.t === 0) l.t = LIFT_AUTO_CLOSE;
      l.t = Math.max(1e-6, l.t - DT);
      if (l.t <= DT || closeRequested || inside.length >= LIFT_CAPACITY) {
        l.phase = 'closing';
        l.t = LIFT_DOOR_TIME;
      }
      return;
    case 'closing':
    case 'closingUp':
      l.t -= DT;
      if (l.t <= 0) {
        l.phase = l.phase === 'closing' ? 'down' : 'up';
        l.t = LIFT_TRAVEL;
      }
      return;
    case 'down':
    case 'up':
      l.t -= DT;
      if (l.t <= 0) {
        // Sampai: semua yang ada di kabin berpindah lantai.
        const to = l.phase === 'down' ? zone.bottom : zone.top;
        for (const p of inside) p.floor = to;
        l.phase = l.phase === 'down' ? 'bottom' : 'top';
        l.t = l.phase === 'bottom' ? LIFT_BOTTOM_WAIT : 0;
      }
      return;
    case 'bottom':
      l.t -= DT;
      if (l.t <= 0 || (inside.length === 0 && l.t <= LIFT_BOTTOM_WAIT - LIFT_BOTTOM_MIN)) {
        l.phase = 'closingUp';
        l.t = LIFT_DOOR_TIME;
      }
  }
}

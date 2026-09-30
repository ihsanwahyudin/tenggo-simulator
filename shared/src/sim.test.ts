import { describe, expect, it } from 'vitest';
import {
  DT,
  FLOORS,
  FLOOR_HEIGHT,
  INVULN_TIME,
  ITEM_SPAWNS,
  JANITOR_FLOOR,
  JANITOR_ROUTE,
  MAP_H,
  MAP_W,
  MAX_PLAYERS,
  PLAYER_RADIUS,
  PUSH_DOWN_TIME,
  PUSH_SLIDE_TIME,
  SEATS,
  SLIP_DOWN_TIME,
  SLIP_TIME,
  STAIRS,
  TOP_FLOOR,
  gateDist,
  heightAt,
  isGate,
  isSolid,
  isStaticWet,
  newSim,
  stepPlayer,
  stepProjectile,
  throwItem,
  tileAt,
  tryPush,
  type PlayerInput,
  type PlayerSim,
  type WetFn,
  CAUGHT_RESPAWN,
  DETECT_TIME,
  GUARDS,
  GUARD_FLOOR,
  GUARD_PAUSE,
  GUARD_SPEED,
  canSee,
  catchPlayer,
  newGuard,
  stepDetection,
  stepGuard,
  type GuardSim,
} from './index';

const input = (x: number, z: number, w = false): PlayerInput => ({ s: 0, x, z, w, p: false, th: false });
const IDLE = input(0, 0);
const dry: WetFn = () => false;

/** Pemain aktif; bawaan di lantai paling atas (ruang kerja). */
function active(x: number, z: number, face = 0, floor = TOP_FLOOR): PlayerSim {
  const p = newSim(floor, x, z);
  p.state = 'active';
  p.face = face;
  return p;
}

function run(p: PlayerSim, inp: PlayerInput, seconds: number, isWet: WetFn = dry) {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepPlayer(p, inp, isWet);
}

describe('denah', () => {
  it('semua lantai berukuran sama', () => {
    for (const rows of FLOORS) {
      expect(rows.length).toBe(MAP_H);
      for (const row of rows) expect(row.length).toBe(MAP_W);
    }
  });

  it('semua pemain mulai di lantai atas dan bisa mencapai gerbang', () => {
    expect(SEATS.length).toBe(MAX_PLAYERS);
    for (const s of SEATS) {
      expect(s.f).toBe(TOP_FLOOR);
      expect(Number.isFinite(gateDist(s.f, s.x, s.z))).toBe(true);
    }
  });

  it('titik item dan rute petugas ada di lantai yang terjangkau', () => {
    expect(ITEM_SPAWNS.length).toBeGreaterThanOrEqual(6);
    for (const p of ITEM_SPAWNS) expect(Number.isFinite(gateDist(p.f, p.x, p.z))).toBe(true);
    for (const p of JANITOR_ROUTE) expect(Number.isFinite(gateDist(JANITOR_FLOOR, p.x, p.z))).toBe(true);
  });

  it('gerbang ada di lantai dasar dan berjarak nol', () => {
    expect(isGate(0, 24, 17)).toBe(true);
    expect(gateDist(0, 24.5, 17.5)).toBe(0);
  });

  it('tiap lantai di atas lobby punya tangga turun yang tergambar di kedua lantai', () => {
    expect(STAIRS.map((s) => s.upper).sort()).toEqual([1, 2]);
    for (const s of STAIRS)
      for (let z = s.minZ; z < s.maxZ; z++)
        for (let x = s.minX; x < s.maxX; x++) expect(tileAt(s.upper - 1, x, z)).toBe(tileAt(s.upper, x, z));
  });
});

describe('gerak dan tabrakan', () => {
  it('duduk tidak bisa bergerak', () => {
    const p = newSim(SEATS[0].f, SEATS[0].x, SEATS[0].z);
    run(p, input(1, 0), 1);
    expect(p.x).toBe(SEATS[0].x);
  });

  it('tidak menembus meja', () => {
    const seat = SEATS[0];
    expect(isSolid(seat.f, Math.floor(seat.x), Math.floor(seat.z) + 1)).toBe(true);
    const p = active(seat.x, seat.z);
    run(p, input(0, 1), 2);
    expect(p.z).toBeLessThanOrEqual(Math.floor(seat.z) + 1 - PLAYER_RADIUS + 1e-6);
  });

  it('tidak menembus dinding dan bisa menyusurinya', () => {
    const p = active(1.5, 4.5);
    run(p, input(-1, 1), 1);
    expect(p.x).toBeCloseTo(1 + PLAYER_RADIUS, 5);
    expect(p.z).toBeGreaterThan(6);
  });

  it('jalan pelan lebih lambat dari lari', () => {
    const a = active(2, 11.5);
    const b = active(2, 11.5);
    run(a, input(1, 0), 1);
    run(b, input(1, 0, true), 1);
    expect(a.x - 2).toBeGreaterThan((b.x - 2) * 2);
  });
});

describe('tangga', () => {
  it('menuruni tangga memindahkan pemain ke lantai bawah dan ketinggiannya turun bertahap', () => {
    const p = active(20.5, 15.5);
    expect(heightAt(p.floor, p.x, p.z)).toBe(TOP_FLOOR * FLOOR_HEIGHT);

    run(p, input(1, 0), 0.3); // sudah di tangga, belum sampai tengah
    expect(p.floor).toBe(TOP_FLOOR);
    const h = heightAt(p.floor, p.x, p.z);
    expect(h).toBeLessThan(TOP_FLOOR * FLOOR_HEIGHT);
    expect(h).toBeGreaterThan((TOP_FLOOR - 1) * FLOOR_HEIGHT);

    run(p, input(1, 0), 1);
    expect(p.floor).toBe(TOP_FLOOR - 1);
    expect(p.x).toBeGreaterThan(26);
    expect(heightAt(p.floor, p.x, p.z)).toBe((TOP_FLOOR - 1) * FLOOR_HEIGHT);
  });

  it('bisa naik lagi lewat tangga yang sama', () => {
    const p = active(26.5, 15.5, 0, TOP_FLOOR - 1);
    run(p, input(-1, 0), 1.3);
    expect(p.floor).toBe(TOP_FLOOR);
    expect(p.x).toBeLessThan(21);
  });

  it('ujung bawah tangga tertutup dari lantai atas', () => {
    expect(isSolid(TOP_FLOOR, 26, 15)).toBe(true);
    expect(isSolid(TOP_FLOOR - 1, 26, 15)).toBe(false);
  });

  it('turun lantai mendekatkan ke gerbang', () => {
    expect(gateDist(TOP_FLOOR, 20.5, 15.5)).toBeGreaterThan(gateDist(TOP_FLOOR - 1, 26.5, 15.5));
    expect(gateDist(1, 8.5, 15.5)).toBeGreaterThan(gateDist(0, 2.5, 15.5));
  });
});

describe('lantai basah', () => {
  it('lari di lantai basah terpeleset, jatuh, lalu bangun dengan kebal sementara', () => {
    expect(isStaticWet(TOP_FLOOR, 21, 7)).toBe(true);
    const p = active(20.5, 7.5);
    run(p, input(1, 0), 0.3, isStaticWet);
    expect(p.state).toBe('slip');
    run(p, IDLE, SLIP_TIME, isStaticWet);
    expect(p.state).toBe('down');
    run(p, input(1, 0), SLIP_DOWN_TIME - 0.2, isStaticWet);
    expect(p.state).toBe('down');
    run(p, IDLE, 0.3, isStaticWet);
    expect(p.state).toBe('active');
    expect(p.invuln).toBeGreaterThan(0);
  });

  it('jalan pelan aman', () => {
    const p = active(20.5, 7.5);
    run(p, input(1, 0, true), 3, isStaticWet);
    expect(p.state).toBe('active');
    expect(p.x).toBeGreaterThan(24);
  });
});

describe('dorong', () => {
  it('menjatuhkan target di depan dan memicu cooldown', () => {
    const a = active(5, 11.5, Math.PI / 2); // menghadap +x
    const b = active(6, 11.5);
    expect(tryPush(a, [a, b])).toEqual([b]);
    expect(b.state).toBe('slip');
    expect(a.pushCd).toBeGreaterThan(0);

    run(b, IDLE, PUSH_SLIDE_TIME + PUSH_DOWN_TIME - 0.1);
    expect(b.state).toBe('down');
    run(b, IDLE, 0.2);
    expect(b.state).toBe('active');
    expect(b.x).toBeGreaterThan(6);
  });

  it('tidak kena kalau target di belakang, terlalu jauh, atau sedang cooldown', () => {
    const a = active(5, 11.5, Math.PI / 2);
    expect(tryPush(a, [active(4, 11.5)])).toEqual([]);
    a.pushCd = 0;
    expect(tryPush(a, [active(8, 11.5)])).toEqual([]);
    expect(tryPush(a, [active(6, 11.5)])).toEqual([]); // masih cooldown
  });

  it('target yang baru bangun kebal', () => {
    const a = active(5, 11.5, Math.PI / 2);
    const b = active(6, 11.5);
    b.invuln = INVULN_TIME;
    expect(tryPush(a, [b])).toEqual([]);
  });

  it('tidak kena target di lantai lain', () => {
    const a = active(5, 11.5, Math.PI / 2);
    expect(tryPush(a, [active(6, 11.5, 0, TOP_FLOOR - 1)])).toEqual([]);
  });
});

describe('lempar', () => {
  it('mengenai target di garis lurus dan menjatuhkan item yang dipegangnya', () => {
    const a = active(5, 11.5, Math.PI / 2);
    a.item = 'stapler';
    const b = active(10, 11.5);
    b.item = 'kertas';
    const pr = throwItem(1, 1, a)!;
    expect(a.item).toBeNull();
    const targets = [{ id: 1, sim: a }, { id: 2, sim: b }];
    let res = stepProjectile(pr, targets);
    for (let i = 0; i < 60 && !res.done; i++) res = stepProjectile(pr, targets);
    expect(res.hit).toBe(2);
    expect(b.state).toBe('slip');
    expect(b.item).toBeNull();
  });

  it('melewati target di lantai lain', () => {
    const a = active(5, 11.5, Math.PI / 2);
    a.item = 'stapler';
    const b = active(7, 11.5, 0, TOP_FLOOR - 1);
    const pr = throwItem(1, 1, a)!;
    const targets = [{ id: 2, sim: b }];
    let res = stepProjectile(pr, targets);
    for (let i = 0; i < 60 && !res.done; i++) res = stepProjectile(pr, targets);
    expect(res.hit).toBeUndefined();
    expect(b.state).toBe('active');
  });

  it('tanpa item tidak bisa melempar', () => {
    expect(throwItem(1, 1, active(5, 11.5))).toBeNull();
  });

  it('kopi berhenti di dinding dan tumpah di lantai yang sama', () => {
    const a = active(3, 11.5, -Math.PI / 2); // menghadap -x, ke dinding kiri
    a.item = 'kopi';
    const pr = throwItem(1, 1, a)!;
    let res = stepProjectile(pr, []);
    for (let i = 0; i < 60 && !res.done; i++) res = stepProjectile(pr, []);
    expect(res.done).toBe(true);
    expect(res.hit).toBeUndefined();
    expect(res.spill!.f).toBe(TOP_FLOOR);
    expect(res.spill!.x).toBeGreaterThanOrEqual(1);
    expect(res.spill!.x).toBeLessThan(2);
  });
});

describe('petak umpet dengan HR', () => {
  const guard = (x: number, z: number, face: number): GuardSim => ({ x, z, face, wp: 0, pause: 0 });
  const EAST = Math.PI / 2;
  const at = (x: number, z: number, floor = GUARD_FLOOR) => ({ floor, x, z });

  it('melihat karyawan di depannya, tidak yang di belakang atau di luar jangkauan', () => {
    const g = guard(5.5, 12.5, EAST);
    expect(canSee(g, at(8.5, 12.5))).toBe(true);
    expect(canSee(g, at(2.5, 12.5))).toBe(false);
    expect(canSee(g, at(11.5, 12.5))).toBe(false);
    expect(canSee(g, at(8.5, 12.5, GUARD_FLOOR + 1))).toBe(false);
  });

  it('yang menempel tetap ketahuan walau dari belakang', () => {
    expect(canSee(guard(5.5, 12.5, EAST), at(5.0, 12.5))).toBe(true);
  });

  it('pandangan terhalang dinding dan tanaman, tapi tidak oleh meja', () => {
    expect(canSee(guard(12.5, 10.5, EAST), at(16.5, 10.5))).toBe(false); // dinding di kolom 15
    expect(canSee(guard(3.5, 11.5, EAST), at(7.5, 11.5))).toBe(false); // tanaman di kolom 5
    expect(canSee(guard(1.5, 2.5, EAST), at(5.5, 2.5))).toBe(true); // meja pantry di kolom 3-4
  });

  it('tangga adalah zona aman', () => {
    expect(canSee(guard(27.5, 15.5, -EAST), at(25.5, 15.5))).toBe(false);
    expect(canSee(guard(27.5, 15.5, -EAST), at(26.5, 15.5))).toBe(true);
  });

  it('terlihat cukup lama berarti tertangkap dan kembali ke lantai atas', () => {
    let det = 0;
    let ticks = 0;
    while (det < 1) {
      det = stepDetection(det, true);
      ticks++;
    }
    expect(ticks * DT).toBeCloseTo(DETECT_TIME, 1);
    expect(stepDetection(0.5, false)).toBeLessThan(0.5);

    const p = active(8.5, 12.5, 0, GUARD_FLOOR);
    p.item = 'kopi';
    catchPlayer(p);
    expect(p.floor).toBe(GUARD_FLOOR + 1);
    expect(p.state).toBe('down');
    expect(p.item).toBeNull();
    expect(isSolid(CAUGHT_RESPAWN.f, Math.floor(CAUGHT_RESPAWN.x), Math.floor(CAUGHT_RESPAWN.z))).toBe(false);
    run(p, IDLE, 2);
    expect(p.state).toBe('active');
  });

  it('penjaga berpatroli bolak-balik di rutenya tanpa menabrak perabot', () => {
    for (const def of GUARDS) {
      const g = newGuard(def);
      const length = Math.hypot(def.route[1].x - def.route[0].x, def.route[1].z - def.route[0].z);
      const oneWay = length / GUARD_SPEED;
      for (let i = 0; i < Math.round((oneWay + 0.2) / DT); i++) {
        stepGuard(g, def);
        expect(isSolid(GUARD_FLOOR, Math.floor(g.x), Math.floor(g.z))).toBe(false);
      }
      expect(g.x).toBeCloseTo(def.route[1].x, 5);
      for (let i = 0; i < Math.round((oneWay + GUARD_PAUSE + 0.2) / DT); i++) stepGuard(g, def);
      expect(g.x).toBeCloseTo(def.route[0].x, 5);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  ALL_OPEN,
  BUS,
  BUS_ARRIVE,
  BUS_CYCLE,
  BUS_DWELL,
  CAUGHT_RESPAWN,
  DETECT_TIME,
  DT,
  FLOOR_HEIGHT,
  GUARDS,
  GUARD_FLOOR,
  INVULN_TIME,
  ITEM_SPAWNS,
  JANITORS,
  LIFT_AUTO_CLOSE,
  LIFT_CAPACITY,
  LIFT_DOOR_TIME,
  LIFT_TRAVEL,
  LIGHT_CYCLE,
  LOBBY,
  MAP_H,
  MAX_PLAYERS,
  OUTDOOR,
  PLANS,
  PLAYER_RADIUS,
  PORTAL_DZ,
  PUSH_DOWN_TIME,
  PUSH_SLIDE_TIME,
  ROAD,
  RUN_OVER_RESPAWN,
  SEATS,
  SLIP_DOWN_TIME,
  SLIP_TIME,
  STAIRS,
  TOP_FLOOR,
  WALL_HALF,
  ZEBRAS,
  busDocked,
  busWait,
  canSee,
  catchPlayer,
  edgeBlocked,
  finishDist,
  heightAt,
  hitByCar,
  inBus,
  isSolid,
  isStaticWet,
  liftDoorOpen,
  liftProgress,
  newGuard,
  newLifts,
  newSim,
  newTraffic,
  pedLight,
  stepDetection,
  stepGuard,
  stepLift,
  stepPlayer,
  stepProjectile,
  stepTraffic,
  throwItem,
  tryPush,
  type GuardSim,
  type PlayerInput,
  type PlayerSim,
  type World,
} from './index';

const input = (x: number, z: number, w = false): PlayerInput => ({ s: 0, x, z, w, p: false, th: false, u: false });
const IDLE = input(0, 0);
const STATIC_WET: World = { wet: isStaticWet, doorOpen: () => true };

/** Pemain aktif; bawaan di lantai paling atas (ruang kerja). */
function active(x: number, z: number, face = 0, floor = TOP_FLOOR): PlayerSim {
  const p = newSim(floor, x, z, face);
  p.state = 'active';
  return p;
}

function run(p: PlayerSim, inp: PlayerInput, seconds: number, world: World = ALL_OPEN) {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepPlayer(p, inp, world);
}

/** Acak berbenih supaya tes lalu lintas selalu sama. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('denah', () => {
  it('ada enam level: area luar, lobby, dan empat lantai di atasnya', () => {
    expect(PLANS.map((p) => p.no)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('semua pemain mulai di lantai atas dan bisa mencapai bus', () => {
    expect(SEATS.length).toBe(MAX_PLAYERS);
    for (const s of SEATS) {
      expect(s.f).toBe(TOP_FLOOR);
      expect(isSolid(s.f, Math.floor(s.x), Math.floor(s.z))).toBe(false);
      expect(Number.isFinite(finishDist(s.f, s.x, s.z))).toBe(true);
    }
  });

  it('titik item, rute penjaga, dan rute petugas kebersihan terjangkau', () => {
    expect(ITEM_SPAWNS.length).toBeGreaterThan(30);
    for (const p of ITEM_SPAWNS) expect(Number.isFinite(finishDist(p.f, p.x, p.z))).toBe(true);
    expect(GUARDS.length).toBe(3);
    for (const g of GUARDS) for (const p of g.route) expect(Number.isFinite(finishDist(GUARD_FLOOR, p.x, p.z))).toBe(true);
    expect(JANITORS.map((j) => j.floor)).toEqual([1, 2]);
    for (const j of JANITORS) for (const p of j.route) expect(Number.isFinite(finishDist(j.floor, p.x, p.z))).toBe(true);
  });

  it('makin ke bawah makin dekat ke bus', () => {
    const d = [finishDist(5, 30.5, 8.5), finishDist(4, 2.5, 19.5), finishDist(3, 27.5, 16.5), finishDist(2, 2.5, 19.5), finishDist(1, 27.5, 16.5), finishDist(0, 30.5, 4.5)];
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
    expect(finishDist(OUTDOOR, BUS.x0 + 1.5, BUS.z0 + 1.5)).toBe(0);
  });

  it('tiap lantai tangga punya dua tangga turun, tertutup di ujung bawahnya', () => {
    expect(STAIRS.map((s) => s.upper).sort()).toEqual([3, 3, 5, 5]);
    for (const s of STAIRS) {
      expect(edgeBlocked(s.upper, true, s.minX, s.maxZ, ALL_OPEN)).toBe(true);
      expect(edgeBlocked(s.upper - 1, true, s.minX, s.maxZ, ALL_OPEN)).toBe(false);
      expect(edgeBlocked(s.upper - 1, true, s.minX, s.minZ, ALL_OPEN)).toBe(true);
    }
  });
});

describe('gerak dan tabrakan', () => {
  it('duduk tidak bisa bergerak', () => {
    const p = newSim(SEATS[0].f, SEATS[0].x, SEATS[0].z);
    run(p, input(1, 0), 1);
    expect(p.x).toBe(SEATS[0].x);
  });

  it('tidak menembus meja', () => {
    expect(isSolid(TOP_FLOOR, 26, 9)).toBe(true);
    const p = active(26.5, 8.5);
    run(p, input(0, 1), 2);
    expect(p.z).toBeLessThanOrEqual(9 - PLAYER_RADIUS + 1e-6);
  });

  it('sekat kaca tipis menahan pemain, pintunya bisa dilewati', () => {
    // Sekat di x = 18 (z 8-26) dengan pintu di z 8-10
    const blocked = active(16.5, 14.5);
    run(blocked, input(1, 0), 1);
    expect(blocked.x).toBeCloseTo(18 - WALL_HALF - PLAYER_RADIUS, 5);

    const through = active(16.5, 9);
    run(through, input(1, 0), 1);
    expect(through.x).toBeGreaterThan(19);
  });

  it('menyusuri dinding tanpa tersangkut, lalu masuk lewat pintunya', () => {
    // Sekat di x = 11 dengan pintu di z 16-18
    const p = active(9.5, 12.5);
    run(p, input(1, 1), 1.5);
    expect(p.x).toBeGreaterThan(11.5);
    expect(p.z).toBeGreaterThan(16);
  });

  it('jalan pelan lebih lambat dari lari', () => {
    const a = active(12, 7.5);
    const b = active(12, 7.5);
    run(a, input(1, 0), 1);
    run(b, input(1, 0, true), 1);
    expect(a.x - 12).toBeGreaterThan((b.x - 12) * 2);
  });
});

describe('tangga dan pintu putar', () => {
  it('menuruni tangga darurat memindahkan pemain ke lantai bawah', () => {
    const p = active(2.5, 14.5);
    expect(heightAt(p.floor, p.x, p.z)).toBe((TOP_FLOOR - 1) * FLOOR_HEIGHT);
    run(p, input(0, 1), 0.3);
    expect(p.floor).toBe(TOP_FLOOR);
    expect(heightAt(p.floor, p.x, p.z)).toBeLessThan((TOP_FLOOR - 1) * FLOOR_HEIGHT);
    run(p, input(0, 1), 1);
    expect(p.floor).toBe(TOP_FLOOR - 1);
    expect(p.z).toBeGreaterThan(20); // sudah keluar lewat pintu selatan bordes bawah
    expect(heightAt(p.floor, p.x, p.z)).toBe((TOP_FLOOR - 2) * FLOOR_HEIGHT);
  });

  it('keluar pintu putar lobby langsung berada di area luar, di titik yang sama', () => {
    const p = active(30, 33.2, 0, LOBBY);
    run(p, input(0, 1), 0.4);
    expect(p.floor).toBe(OUTDOOR);
    expect(p.z + PORTAL_DZ).toBeGreaterThan(MAP_H);
    expect(p.z + PORTAL_DZ).toBeLessThan(MAP_H + 2.5);
    run(p, input(0, -1), 0.6);
    expect(p.floor).toBe(LOBBY);
  });

  it('dinding gedung di samping pintu putar tetap padat dari kedua sisi', () => {
    const inside = active(20.5, 33, 0, LOBBY);
    run(inside, input(0, 1), 1);
    expect(inside.floor).toBe(LOBBY);
    const outside = active(20.5, 4, 0, OUTDOOR);
    run(outside, input(0, -1), 1);
    expect(outside.floor).toBe(OUTDOOR);
  });
});

describe('lantai basah', () => {
  it('lari di lantai basah terpeleset, jatuh, lalu bangun dengan kebal sementara', () => {
    expect(isStaticWet(TOP_FLOOR, 6, 16)).toBe(true);
    const p = active(5.5, 16.5);
    run(p, input(1, 0), 0.3, STATIC_WET);
    expect(p.state).toBe('slip');
    run(p, IDLE, SLIP_TIME, STATIC_WET);
    expect(p.state).toBe('down');
    run(p, IDLE, SLIP_DOWN_TIME + 0.1, STATIC_WET);
    expect(p.state).toBe('active');
    expect(p.invuln).toBeGreaterThan(0);
  });

  it('jalan pelan aman', () => {
    const p = active(5.5, 16.5);
    run(p, input(1, 0, true), 1.5, STATIC_WET);
    expect(p.state).toBe('active');
    expect(p.x).toBeGreaterThan(9);
  });
});

describe('dorong dan lempar', () => {
  it('dorong menjatuhkan target di depan dan memicu cooldown', () => {
    const a = active(20, 7.5, Math.PI / 2); // menghadap +x
    const b = active(21, 7.5);
    expect(tryPush(a, [a, b], ALL_OPEN)).toEqual([b]);
    expect(a.pushCd).toBeGreaterThan(0);
    run(b, IDLE, PUSH_SLIDE_TIME + PUSH_DOWN_TIME + 0.1);
    expect(b.state).toBe('active');
    expect(b.x).toBeGreaterThan(21);
  });

  it('dorong tidak kena yang di belakang, terlalu jauh, kebal, beda lantai, atau di balik dinding', () => {
    const a = () => active(20, 7.5, Math.PI / 2);
    expect(tryPush(a(), [active(19, 7.5)], ALL_OPEN)).toEqual([]);
    expect(tryPush(a(), [active(23, 7.5)], ALL_OPEN)).toEqual([]);
    const immune = active(21, 7.5);
    immune.invuln = INVULN_TIME;
    expect(tryPush(a(), [immune], ALL_OPEN)).toEqual([]);
    expect(tryPush(a(), [active(21, 7.5, 0, TOP_FLOOR - 1)], ALL_OPEN)).toEqual([]);
    // Sekat kaca di x = 18
    expect(tryPush(active(17.6, 14.5, Math.PI / 2), [active(18.4, 14.5)], ALL_OPEN)).toEqual([]);
  });

  it('lemparan mengenai target di garis lurus dan berhenti di dinding', () => {
    const a = active(20, 7.5, Math.PI / 2);
    a.item = 'stapler';
    const b = active(25, 7.5);
    const pr = throwItem(1, 1, a)!;
    const targets = [{ id: 1, sim: a }, { id: 2, sim: b }];
    let res = stepProjectile(pr, targets, ALL_OPEN);
    for (let i = 0; i < 60 && !res.done; i++) res = stepProjectile(pr, targets, ALL_OPEN);
    expect(res.hit).toBe(2);
    expect(b.state).toBe('slip');

    const c = active(16, 14.5, Math.PI / 2);
    c.item = 'kopi';
    const kopi = throwItem(2, 1, c)!;
    res = stepProjectile(kopi, [], ALL_OPEN);
    for (let i = 0; i < 60 && !res.done; i++) res = stepProjectile(kopi, [], ALL_OPEN);
    expect(res.hit).toBeUndefined();
    expect(res.spill!.x).toBeLessThan(18);
    expect(res.spill!.x).toBeGreaterThan(17);
  });
});

describe('lift', () => {
  const rider = () => active(27, 15, 0, 4); // di dalam kabin A, zona atas
  const stepAll = (lifts: ReturnType<typeof newLifts>, players: PlayerSim[], seconds: number, close = false) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) for (const l of lifts) stepLift(l, players, close);
  };

  it('kabin kosong menunggu di atas dengan pintu terbuka; pintu bawah tertutup', () => {
    const lifts = newLifts();
    stepAll(lifts, [], 10);
    expect(lifts.every((l) => l.phase === 'top')).toBe(true);
    expect(liftDoorOpen(lifts, 0)).toBe(true); // zona atas, kabin A, ujung atas
    expect(liftDoorOpen(lifts, 1)).toBe(false);
  });

  it('pintu menutup sendiri setelah ada penumpang, lalu kabin turun dan penumpang pindah lantai', () => {
    const lifts = newLifts();
    const p = rider();
    stepAll(lifts, [p], LIFT_AUTO_CLOSE - 0.5);
    expect(lifts[0].phase).toBe('top');
    stepAll(lifts, [p], 0.6);
    expect(lifts[0].phase).toBe('closing');
    expect(liftDoorOpen(lifts, 0)).toBe(false);
    stepAll(lifts, [p], LIFT_DOOR_TIME + LIFT_TRAVEL / 2);
    expect(liftProgress(lifts[0])).toBeGreaterThan(0.3);
    expect(liftProgress(lifts[0])).toBeLessThan(0.7);
    expect(p.floor).toBe(4);
    stepAll(lifts, [p], LIFT_TRAVEL / 2 + 0.1);
    expect(p.floor).toBe(3);
    expect(lifts[0].phase).toBe('bottom');
    expect(liftDoorOpen(lifts, 1)).toBe(true);
    expect(lifts[1].phase).toBe('top'); // kabin B tidak ikut
  });

  it('tombol tutup pintu memberangkatkan kabin saat itu juga', () => {
    const lifts = newLifts();
    const p = rider();
    stepAll(lifts, [p], 0.2);
    stepAll(lifts, [p], DT, true);
    expect(lifts[0].phase).toBe('closing');
  });

  it('kabin penuh langsung berangkat', () => {
    const lifts = newLifts();
    const crowd = Array.from({ length: LIFT_CAPACITY }, rider);
    stepAll(lifts, crowd, DT * 2);
    expect(lifts[0].phase).toBe('closing');
  });

  it('setelah penumpang keluar, kabin naik lagi dan siap dipakai', () => {
    const lifts = newLifts();
    const p = rider();
    stepAll(lifts, [p], 0.1, true);
    stepAll(lifts, [p], LIFT_DOOR_TIME + LIFT_TRAVEL + 0.1);
    expect(p.floor).toBe(3);
    p.z = 19; // keluar ke lobi lift
    stepAll(lifts, [p], 1.2 + LIFT_DOOR_TIME + LIFT_TRAVEL + 0.1);
    expect(lifts[0].phase).toBe('top');
    expect(p.floor).toBe(3);
  });

  it('pintu lift yang tertutup menahan pemain', () => {
    const closed: World = { wet: () => false, doorOpen: () => false };
    const p = active(27, 19, 0, 4);
    run(p, input(0, -1), 1, closed);
    expect(p.z).toBeCloseTo(17 + WALL_HALF + PLAYER_RADIUS, 5);
    run(p, input(0, -1), 1, ALL_OPEN);
    expect(p.z).toBeLessThan(16);
  });
});

describe('jalan raya dan bus', () => {
  it('dua zebra cross bergantian hijau', () => {
    let both = 0;
    let goA = 0;
    for (let t = 0; t < LIGHT_CYCLE; t += 0.1) {
      if (pedLight(0, t) === 'go') goA++;
      if (pedLight(0, t) === 'go' && pedLight(1, t) === 'go') both++;
    }
    expect(goA).toBeGreaterThan(30);
    expect(both).toBe(0);
    expect(pedLight(0, 1)).toBe('go');
    expect(pedLight(1, 1)).toBe('stop');
  });

  it('mobil berhenti sebelum zebra yang hijau, dan melintas saat merah', () => {
    const tr = newTraffic();
    const random = seeded(7);
    let hitsOnGreen = 0;
    let hitsOnRed = 0;
    for (let t = 0; t < 120; t += DT) {
      stepTraffic(tr, t, random);
      ZEBRAS.forEach((zb, i) => {
        const hit = ROAD.lanes.some((z) => hitByCar(tr, { floor: OUTDOOR, x: (zb.x0 + zb.x1) / 2, z }));
        if (pedLight(i, t) === 'go') hitsOnGreen += hit ? 1 : 0;
        else if (pedLight(i, t) === 'stop') hitsOnRed += hit ? 1 : 0;
      });
    }
    expect(hitsOnGreen).toBe(0);
    expect(hitsOnRed).toBeGreaterThan(20);
    expect(tr.cars.length).toBeLessThan(30);
  });

  it('lalu lintas saat merah cukup longgar untuk diterobos: tiap lajur lebih sering kosong daripada terisi', () => {
    const tr = newTraffic();
    const random = seeded(3);
    let busy = 0;
    let samples = 0;
    for (let t = 0; t < 120; t += DT) {
      stepTraffic(tr, t, random);
      if (pedLight(0, t) !== 'stop') continue;
      samples++;
      if (hitByCar(tr, { floor: OUTDOOR, x: 16, z: ROAD.lanes[1] })) busy++;
    }
    expect(busy / samples).toBeLessThan(0.4);
  });

  it('mobil tidak menabrak pemain di trotoar atau di lantai lain', () => {
    const tr = newTraffic();
    tr.cars.push({ id: 1, lane: 0, x: 15, speed: 7 });
    expect(hitByCar(tr, { floor: OUTDOOR, x: 16, z: ROAD.lanes[0] })).toBe(true);
    expect(hitByCar(tr, { floor: OUTDOOR, x: 16, z: 9.5 })).toBe(false);
    expect(hitByCar(tr, { floor: LOBBY, x: 16, z: ROAD.lanes[0] })).toBe(false);
    tr.cars[0].speed = 0;
    expect(hitByCar(tr, { floor: OUTDOOR, x: 16, z: ROAD.lanes[0] })).toBe(false);
    expect(isSolid(RUN_OVER_RESPAWN.f, Math.floor(RUN_OVER_RESPAWN.x), Math.floor(RUN_OVER_RESPAWN.z))).toBe(false);
  });

  it('bus datang, berhenti dengan pintu terbuka, lalu pergi, berulang', () => {
    expect(busDocked(0)).toBe(false);
    expect(busDocked(BUS_ARRIVE + 0.1)).toBe(true);
    expect(busDocked(BUS_ARRIVE + BUS_DWELL + 0.1)).toBe(false);
    expect(busDocked(BUS_CYCLE + BUS_ARRIVE + 1)).toBe(true);
    expect(busWait(BUS_ARRIVE + 1)).toBe(0);
    expect(busWait(BUS_ARRIVE + BUS_DWELL + 1)).toBeCloseTo(BUS_CYCLE - BUS_DWELL - 1, 5);
    expect(inBus(BUS.x0 + 2, BUS.z0 + 1)).toBe(true);
    expect(inBus(BUS.x0 + 2, BUS.z0 - 1)).toBe(false);
  });

  it('pintu bus yang tertutup menahan pemain di peron', () => {
    const closed: World = { wet: () => false, doorOpen: () => false };
    const p = active(25, 22.5, 0, OUTDOOR);
    run(p, input(0, 1), 1, closed);
    expect(inBus(p.x, p.z)).toBe(false);
    run(p, input(0, 1), 1, ALL_OPEN);
    expect(inBus(p.x, p.z)).toBe(true);
  });
});

describe('petak umpet dengan HR', () => {
  const guard = (x: number, z: number, face: number): GuardSim => ({ x, z, face, wp: 0, pause: 0 });
  const WEST = -Math.PI / 2;
  const at = (x: number, z: number, floor = GUARD_FLOOR) => ({ floor, x, z });

  it('melihat karyawan di depannya, tidak yang di belakang, di luar jangkauan, atau di lantai lain', () => {
    const g = guard(15.5, 9.5, WEST);
    expect(canSee(g, at(12.5, 9.5))).toBe(true);
    expect(canSee(g, at(18.5, 9.5))).toBe(false);
    expect(canSee(g, at(9.5, 9.5))).toBe(false);
    expect(canSee(g, at(12.5, 9.5, GUARD_FLOOR + 1))).toBe(false);
  });

  it('yang menempel tetap ketahuan walau dari belakang', () => {
    expect(canSee(guard(15.5, 9.5, WEST), at(16, 9.5))).toBe(true);
  });

  it('pandangan terhalang dinding dan tanaman, tapi tembus lewat pintu', () => {
    // Ruang Interview 1 (x 7-13, z 10-15): dinding utara di z = 10, pintu di x 9-11
    expect(canSee(guard(12.5, 9.5, 0), at(12.5, 11.5))).toBe(false);
    expect(canSee(guard(10, 9.5, 0), at(10, 11.5))).toBe(true);
    // Tanaman di (14, 8)
    expect(canSee(guard(12.5, 8.5, Math.PI / 2), at(16.5, 8.5))).toBe(false);
  });

  it('tangga adalah zona aman', () => {
    expect(canSee(guard(2.5, 14.5, 0), at(2.5, 15.5))).toBe(false);
    expect(canSee(guard(2.5, 13.5, 0), at(2.5, 14.5))).toBe(true);
  });

  it('terlihat cukup lama berarti tertangkap dan kembali ke lobi lift lantai atas', () => {
    let det = 0;
    let ticks = 0;
    while (det < 1) {
      det = stepDetection(det, true);
      ticks++;
    }
    expect(ticks * DT).toBeCloseTo(DETECT_TIME, 1);

    const p = active(12.5, 9.5, 0, GUARD_FLOOR);
    p.item = 'kopi';
    catchPlayer(p);
    expect(p.floor).toBe(GUARD_FLOOR + 1);
    expect(p.state).toBe('down');
    expect(p.item).toBeNull();
    expect(isSolid(CAUGHT_RESPAWN.f, Math.floor(CAUGHT_RESPAWN.x), Math.floor(CAUGHT_RESPAWN.z))).toBe(false);
    run(p, IDLE, 2);
    expect(p.state).toBe('active');
  });

  it('penjaga berkeliling di rutenya tanpa menabrak perabot atau dinding', () => {
    for (const def of GUARDS) {
      const g = newGuard(def);
      let visited = 0;
      let lastWp = g.wp;
      for (let i = 0; i < Math.round(90 / DT); i++) {
        const before = { x: g.x, z: g.z };
        stepGuard(g, def);
        expect(isSolid(GUARD_FLOOR, Math.floor(g.x), Math.floor(g.z))).toBe(false);
        const tx = Math.floor(g.x);
        const tz = Math.floor(g.z);
        const bx = Math.floor(before.x);
        const bz = Math.floor(before.z);
        if (tx !== bx) expect(edgeBlocked(GUARD_FLOOR, false, Math.max(tx, bx), tz, ALL_OPEN)).toBe(false);
        if (tz !== bz) expect(edgeBlocked(GUARD_FLOOR, true, tx, Math.max(tz, bz), ALL_OPEN)).toBe(false);
        if (g.wp !== lastWp) {
          visited++;
          lastWp = g.wp;
        }
      }
      expect(visited).toBeGreaterThanOrEqual(def.route.length);
    }
  });
});

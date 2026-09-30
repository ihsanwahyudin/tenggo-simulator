import type { WebSocket } from 'ws';
import {
  BUS_DOOR,
  DESK_MAX,
  DESK_MIN,
  DT,
  FINISH_GRACE,
  GUARDS,
  ITEM_KINDS,
  ITEM_RESPAWN,
  ITEM_SPAWNS,
  JANITORS,
  JANITOR_SPEED,
  JANITOR_WET_TIME,
  LIFT_PHASES,
  MAX_PLAYERS,
  MAX_RACE_TIME,
  OUTDOOR,
  PICKUP_RANGE,
  RUN_OVER_DOWN,
  RUN_OVER_RESPAWN,
  SEATS,
  SNAPSHOT_EVERY,
  SPILL_TIME,
  busDocked,
  canSee,
  catchPlayer,
  hitByCar,
  inBus,
  inCabin,
  isSolid,
  isStaticWet,
  liftAt,
  liftDoorOpen,
  newGuard,
  newLifts,
  newSim,
  newTraffic,
  sendBack,
  stairAt,
  stepDetection,
  stepGuard,
  stepLift,
  stepPlayer,
  stepProjectile,
  stepTraffic,
  throwItem,
  tileKey,
  tryPush,
  type FloorPoint,
  type GuardSim,
  type ItemKind,
  type LiftCar,
  type Phase,
  type PlayerInput,
  type PlayerSim,
  type Projectile,
  type ResultRow,
  type RoomMsg,
  type ServerMsg,
  type SnapMsg,
  type Traffic,
  type World,
} from '@tenggo/shared';

export interface Member {
  id: number;
  name: string;
  color: number;
  ws: WebSocket;
  sim: PlayerSim;
  queue: PlayerInput[];
  budget: number; // jatah input yang boleh diproses, bertambah satu per tick
  debt: number; // langkah yang sudah dijalankan server tanpa input; input berikutnya dilewati sebanyak ini
  lastSeq: number;
  ack: number;
  rank: number;
  time: number;
  det: number; // kecurigaan penjaga, 0..1
}

interface ItemSpawn extends FloorPoint {
  kind: ItemKind | null;
  respawnAt: number;
}

const MAX_BUDGET = 6;
const MAX_INPUTS_PER_TICK = 3;
const MAX_QUEUE = 30;
const MAX_DEBT = 5;
const IDLE: PlayerInput = { s: 0, x: 0, z: 0, w: false, p: false, th: false, u: false };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const randomKind = () => ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)];
const newJanitors = () => JANITORS.map((j) => ({ ...j.route[0], wp: 1 }));

export function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export class Room {
  readonly members = new Map<number, Member>();
  phase: Phase = 'lobby';
  private hostId = 0;
  private time = 0; // desk: sisa detik; race: detik sejak teng
  private tickN = 0;
  private nextRank = 1;
  private firstFinish = -1;
  private nextProjId = 1;
  private items: ItemSpawn[] = [];
  private projs: Projectile[] = [];
  private wet = new Map<number, number>(); // tileKey -> waktu kering
  private janitors = newJanitors();
  private guards: GuardSim[] = GUARDS.map(newGuard);
  private lifts: LiftCar[] = newLifts();
  private traffic: Traffic = newTraffic();
  private results: ResultRow[] | undefined;

  constructor(readonly code: string) {}

  // Keadaan dunia yang memengaruhi gerak: lantai basah, pintu lift, pintu bus.
  private world: World = {
    wet: (f, tx, tz) => isStaticWet(f, tx, tz) || this.wet.has(tileKey(f, tx, tz)),
    doorOpen: (id) => (id === BUS_DOOR ? busDocked(this.time) : liftDoorOpen(this.lifts, id)),
  };

  get joinError(): string | null {
    if (this.phase === 'desk' || this.phase === 'race') return 'Ronde sedang berjalan, coba lagi sebentar';
    if (this.members.size >= MAX_PLAYERS) return 'Room penuh';
    return null;
  }

  add(id: number, name: string, ws: WebSocket): Member {
    const used = new Set([...this.members.values()].map((m) => m.color));
    let color = 0;
    while (used.has(color)) color++;
    const m: Member = {
      id, name, color, ws,
      sim: newSim(0, 0, 0),
      queue: [], budget: 0, debt: 0, lastSeq: 0, ack: 0, rank: 0, time: 0, det: 0,
    };
    this.members.set(id, m);
    if (this.members.size === 1) this.hostId = id;
    send(ws, { t: 'joined', id, code: this.code });
    this.sendRoom();
    return m;
  }

  remove(id: number): void {
    if (!this.members.delete(id)) return;
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? 0;
    this.sendRoom();
  }

  start(by: number): void {
    if (by !== this.hostId || (this.phase !== 'lobby' && this.phase !== 'result')) return;
    this.phase = 'desk';
    this.time = DESK_MIN + Math.random() * (DESK_MAX - DESK_MIN);
    this.nextRank = 1;
    this.firstFinish = -1;
    this.results = undefined;
    this.projs = [];
    this.wet.clear();
    this.items = ITEM_SPAWNS.map((p) => ({ ...p, kind: randomKind(), respawnAt: 0 }));
    this.janitors = newJanitors();
    this.guards = GUARDS.map(newGuard);
    this.lifts = newLifts();
    this.traffic = newTraffic();

    const seats = [...SEATS].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const m of this.members.values()) {
      const seat = seats[i++];
      // Duduk menghadap mejanya: meja ada di sisi +z atau -z kursi.
      const face = isSolid(seat.f, Math.floor(seat.x), Math.floor(seat.z) + 1) ? 0 : Math.PI;
      m.sim = newSim(seat.f, seat.x, seat.z, face);
      m.queue = [];
      m.budget = 0;
      m.debt = 0;
      m.lastSeq = 0;
      m.ack = 0;
      m.rank = 0;
      m.time = 0;
      m.det = 0;
    }
    this.sendRoom();
  }

  toLobby(by: number): void {
    if (by !== this.hostId || this.phase !== 'result') return;
    this.phase = 'lobby';
    this.results = undefined;
    this.sendRoom();
  }

  input(m: Member, msg: Record<string, unknown>): void {
    if (this.phase !== 'race') return;
    const s = Number(msg.s);
    const x = Number(msg.x);
    const z = Number(msg.z);
    if (!Number.isInteger(s) || s <= m.lastSeq || !Number.isFinite(x) || !Number.isFinite(z)) return;
    m.lastSeq = s;
    m.queue.push({
      s,
      x: Math.max(-1, Math.min(1, x)),
      z: Math.max(-1, Math.min(1, z)),
      w: !!msg.w,
      p: !!msg.p,
      th: !!msg.th,
      u: !!msg.u,
    });
    if (m.queue.length > MAX_QUEUE) m.queue.shift();
  }

  tick(): void {
    if (this.phase === 'desk') {
      this.time -= DT;
      if (this.time <= 0) {
        this.phase = 'race';
        this.time = 0;
        for (const m of this.members.values()) m.sim.state = 'active';
        this.sendRoom();
      }
    } else if (this.phase === 'race') {
      this.stepRace();
    } else {
      return;
    }
    if (++this.tickN % SNAPSHOT_EVERY === 0) this.sendSnapshots();
  }

  private stepRace(): void {
    this.time += DT;
    const members = [...this.members.values()];
    const sims = members.map((m) => m.sim);
    const closeRequests = new Set<LiftCar>();

    // Input pemain. Simulasi tiap pemain maju satu langkah per input, supaya prediksi client persis sama.
    for (const m of members) {
      m.budget = Math.min(m.budget + 1, MAX_BUDGET);
      let n = 0;
      for (; n < MAX_INPUTS_PER_TICK && m.queue.length && m.budget >= 1; n++) {
        const inp = m.queue.shift()!;
        m.budget--;
        m.ack = inp.s;
        if (m.debt > 0) {
          m.debt--;
          continue;
        }
        stepPlayer(m.sim, inp, this.world);
        if (inp.p) tryPush(m.sim, sims, this.world);
        if (inp.th) {
          const pr = throwItem(this.nextProjId, m.id, m.sim);
          if (pr) {
            this.nextProjId++;
            this.projs.push(pr);
          }
        }
        if (inp.u && m.sim.state === 'active') {
          const lift = liftAt(this.lifts, m.sim);
          if (lift) closeRequests.add(lift);
        }
      }
      // Input tidak datang (lag atau tab di background): timer jatuh dan kebal tetap harus berjalan.
      if (n === 0) {
        if (m.sim.state === 'slip' || m.sim.state === 'down') {
          stepPlayer(m.sim, IDLE, this.world);
          m.debt = Math.min(m.debt + 1, MAX_DEBT);
        } else if (m.sim.invuln > 0) m.sim.invuln = Math.max(0, m.sim.invuln - DT);
      }
    }

    for (const lift of this.lifts) stepLift(lift, sims, closeRequests.has(lift));

    // Item di lantai
    for (const it of this.items) {
      if (!it.kind) {
        if (this.time >= it.respawnAt) it.kind = randomKind();
        continue;
      }
      for (const { sim } of members) {
        if (sim.state !== 'active' || sim.item || sim.floor !== it.f) continue;
        if (Math.hypot(sim.x - it.x, sim.z - it.z) > PICKUP_RANGE) continue;
        sim.item = it.kind;
        it.kind = null;
        it.respawnAt = this.time + ITEM_RESPAWN;
        break;
      }
    }

    // Proyektil
    this.projs = this.projs.filter((pr) => {
      const res = stepProjectile(pr, members, this.world);
      if (res.spill) this.spill(res.spill);
      return !res.done;
    });

    // Petugas kebersihan dan lantai basah
    this.janitors.forEach((j, i) => {
      const { floor, route } = JANITORS[i];
      const target = route[j.wp];
      const dx = target.x - j.x;
      const dz = target.z - j.z;
      const d = Math.hypot(dx, dz);
      const step = JANITOR_SPEED * DT;
      if (d <= step) {
        j.x = target.x;
        j.z = target.z;
        j.wp = (j.wp + 1) % route.length;
      } else {
        j.x += (dx / d) * step;
        j.z += (dz / d) * step;
      }
      this.wetTile(floor, Math.floor(j.x), Math.floor(j.z), JANITOR_WET_TIME);
    });
    for (const [key, until] of this.wet) if (until <= this.time) this.wet.delete(key);

    // Penjaga berpatroli; yang terlihat terlalu lama dikembalikan ke lantai atas. Kabin lift aman.
    this.guards.forEach((g, i) => stepGuard(g, GUARDS[i]));
    for (const m of members) {
      const s = m.sim;
      const hidden = s.state === 'seated' || s.state === 'done' || inCabin(0, s.x, s.z) || inCabin(1, s.x, s.z);
      m.det = stepDetection(m.det, !hidden && this.guards.some((g) => canSee(g, s)));
      if (m.det >= 1) {
        m.det = 0;
        catchPlayer(s);
      }
    }

    // Lalu lintas: tertabrak mobil yang melaju = kembali ke depan pintu lobby
    stepTraffic(this.traffic, this.time);
    for (const { sim } of members) {
      if (sim.state === 'seated' || sim.state === 'done') continue;
      if (hitByCar(this.traffic, sim)) sendBack(sim, RUN_OVER_RESPAWN, RUN_OVER_DOWN);
    }

    // Finis: masuk ke bus yang sedang berhenti di halte
    if (busDocked(this.time)) {
      for (const m of members) {
        if (m.sim.state !== 'active' || m.sim.floor !== OUTDOOR || !inBus(m.sim.x, m.sim.z)) continue;
        m.sim.state = 'done';
        m.rank = this.nextRank++;
        m.time = this.time;
        if (this.firstFinish < 0) this.firstFinish = this.time;
      }
    }

    const allDone = members.every((m) => m.sim.state === 'done');
    const graceOver = this.firstFinish >= 0 && this.time - this.firstFinish > FINISH_GRACE;
    if (allDone || graceOver || this.time > MAX_RACE_TIME) this.finish();
  }

  private wetTile(f: number, tx: number, tz: number, duration: number): void {
    if (isSolid(f, tx, tz) || isStaticWet(f, tx, tz) || stairAt(f, tx + 0.5, tz + 0.5)) return;
    if (inCabin(0, tx, tz) || inCabin(1, tx, tz) || (f === OUTDOOR && inBus(tx, tz))) return;
    const key = tileKey(f, tx, tz);
    this.wet.set(key, Math.max(this.wet.get(key) ?? 0, this.time + duration));
  }

  private spill(p: FloorPoint): void {
    const tx = Math.floor(p.x);
    const tz = Math.floor(p.z);
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) this.wetTile(p.f, tx + ox, tz + oz, SPILL_TIME);
  }

  private finish(): void {
    this.phase = 'result';
    this.results = [...this.members.values()]
      .map((m) => ({ id: m.id, name: m.name, color: m.color, rank: m.rank, time: r3(m.time) }))
      .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
    this.sendRoom();
  }

  private sendRoom(): void {
    const msg: RoomMsg = {
      t: 'room',
      code: this.code,
      phase: this.phase,
      host: this.hostId,
      players: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color })),
      results: this.results,
    };
    for (const m of this.members.values()) send(m.ws, msg);
  }

  private sendSnapshots(): void {
    const snap: SnapMsg = {
      t: 'snap',
      phase: this.phase,
      time: r3(this.time),
      ack: 0,
      players: [...this.members.values()].map(({ id, sim, rank, det }) => ({
        id,
        fl: sim.floor,
        x: r3(sim.x), z: r3(sim.z), f: r3(sim.face),
        st: sim.state, sT: r3(sim.stateT), dT: sim.downT,
        vx: r3(sim.vx), vz: r3(sim.vz),
        inv: r3(sim.invuln), cd: r3(sim.pushCd),
        item: sim.item, rank, det: r3(Math.min(1, det)),
      })),
      items: this.items.flatMap((it, id) => (it.kind ? [{ id, k: it.kind, f: it.f, x: it.x, z: it.z }] : [])),
      projs: this.projs.map((p) => ({ id: p.id, k: p.kind, f: p.floor, x: r3(p.x), z: r3(p.z) })),
      wet: [...this.wet.keys()],
      jan: this.janitors.map((j) => [r3(j.x), r3(j.z)]),
      hr: this.guards.map((g) => [r3(g.x), r3(g.z), r3(g.face)]),
      lifts: this.lifts.map((l) => [LIFT_PHASES.indexOf(l.phase), r3(l.t)]),
      cars: this.traffic.cars.map((c) => [c.id, c.lane, r3(c.x)]),
    };
    for (const m of this.members.values()) {
      snap.ack = m.ack;
      send(m.ws, snap);
    }
  }
}

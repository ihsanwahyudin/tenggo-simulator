// Denah gedung Tenggo: 5 lantai kantor + area luar (jalan raya dan halte TransJakarta).
// Tiap lantai 60 x 34 tile. Dinding tipis dan berada di GARIS antar tile; perabot menempati tile.
// File ini adalah sumber kebenaran denah; gambar rancangan awalnya ada di design/.

export const MAP_W = 60;
export const MAP_H = 34;
const W = MAP_W;
const H = MAP_H;

// solid: menghalangi jalan. tall: juga menghalangi pandangan penjaga.
export const ITEM_TYPES = {
  desk: { solid: true, tall: false },
  chair: { solid: false, tall: false },
  table: { solid: true, tall: false },
  cabinet: { solid: true, tall: true },
  shelf: { solid: true, tall: true },
  locker: { solid: true, tall: true },
  plant: { solid: true, tall: true },
  sofa: { solid: true, tall: false },
  beanbag: { solid: true, tall: false },
  counter: { solid: true, tall: false },
  coffee: { solid: true, tall: false },
  vending: { solid: true, tall: true },
  fridge: { solid: true, tall: true },
  dispenser: { solid: true, tall: false },
  printer: { solid: true, tall: false },
  lamp: { solid: true, tall: false },
  booth: { solid: true, tall: true },
  server: { solid: true, tall: true },
  pingpong: { solid: true, tall: false },
  gym: { solid: true, tall: false },
  bed: { solid: true, tall: false },
  sink: { solid: true, tall: false },
  toilet: { solid: true, tall: true },
  reception: { solid: true, tall: false },
  turnstile: { solid: true, tall: false },
  atm: { solid: true, tall: true },
  shaft: { solid: true, tall: true },
  bench: { solid: true, tall: false },
  fence: { solid: true, tall: false },
  cart: { solid: true, tall: true },
  motor: { solid: true, tall: false },
  topup: { solid: true, tall: true },
  mat: { solid: false, tall: false },
  tv: { solid: false, tall: false },
} as const;
export type ItemType = keyof typeof ITEM_TYPES;

export interface Furniture {
  type: ItemType;
  x: number;
  z: number;
  w: number;
  h: number;
}

export interface Door {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  edges: string[];
  narrow: boolean; // hanya muat satu orang
  dyn?: number; // pintu yang dibuka-tutup simulasi (lift, bus)
}

export interface Room {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  name: string;
  fill: string | null;
}

type Cell = [number, number];
type WallKind = 'solid' | 'glass';
type DoorSpec = [side: 'n' | 's' | 'e' | 'w', at: number, width?: number];

// Pintu dinamis: 8 pintu lift (2 zona x 2 kabin x ujung atas/bawah) dan pintu bus.
export const BUS_DOOR = 8;
export const DOOR_COUNT = 9;
/** Zona atas melayani Lt 4 -> Lt 3, zona bawah Lt 2 -> Lt 1. */
export function liftDoorId(floor: number, car: number): number {
  const zone = floor >= 3 ? 0 : 1;
  const end = floor === 4 || floor === 2 ? 0 : 1;
  return zone * 4 + car * 2 + end;
}

export class FloorPlan {
  readonly walls = new Map<string, WallKind>();
  readonly doors: Door[] = [];
  readonly rooms: Room[] = [];
  readonly items: Furniture[] = [];
  readonly solid = new Uint8Array(W * H);
  readonly tall = new Uint8Array(W * H);
  readonly wetCells = new Uint8Array(W * H);
  // Sisi tile setelah finish(): 0 terbuka, 1 kaca, 2 masif. h = sisi atas tile, v = sisi kiri tile.
  readonly h = new Uint8Array((H + 1) * W);
  readonly v = new Uint8Array(H * (W + 1));
  readonly hDyn = new Int8Array((H + 1) * W).fill(-1);
  readonly vDyn = new Int8Array(H * (W + 1)).fill(-1);
  wet: { x: number; z: number; w: number; h: number }[] = [];
  stairs: { x0: number; z0: number; x1: number; z1: number; mode: 'turun' | 'tiba' | 'tutup' }[] = [];
  starts: Cell[] = [];
  spawns: Cell[] = [];
  patrols: { name: string; pts: Cell[] }[] = [];
  janitor: Cell[] | null = null;
  private taken = new Uint8Array(W * H);
  private reserved = new Uint8Array(W * H);

  constructor(readonly no: number, readonly title: string) {}

  private edges(x0: number, z0: number, x1: number, z1: number): string[] {
    const out: string[] = [];
    if (z0 === z1) for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) out.push(`h,${x},${z0}`);
    else for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z++) out.push(`v,${x0},${z}`);
    return out;
  }

  wall(x0: number, z0: number, x1: number, z1: number, kind: WallKind = 'glass'): void {
    for (const e of this.edges(x0, z0, x1, z1)) if (kind === 'solid' || !this.walls.has(e)) this.walls.set(e, kind);
  }

  /** Pintu = celah di dinding. Tile di kedua sisinya dijaga tetap kosong. */
  door(x0: number, z0: number, x1: number, z1: number, opt: { narrow?: boolean; dyn?: number } = {}): void {
    const edges = this.edges(x0, z0, x1, z1);
    this.doors.push({ x0, z0, x1, z1, edges, narrow: !!opt.narrow || edges.length === 1, dyn: opt.dyn });
    for (const e of edges) {
      const [t, x, z] = e.split(',');
      this.reserve(+x, +z);
      if (t === 'h') this.reserve(+x, +z - 1);
      else this.reserve(+x - 1, +z);
    }
  }

  /** doors: [sisi, posisi, lebar] dengan sisi n/s/e/w; posisi = koordinat tile awal celah. */
  room(x0: number, z0: number, x1: number, z1: number, o: { name?: string; kind?: WallKind; fill?: string | null; doors?: DoorSpec[] } = {}): void {
    const kind = o.kind ?? 'glass';
    this.wall(x0, z0, x1, z0, kind);
    this.wall(x0, z1, x1, z1, kind);
    this.wall(x0, z0, x0, z1, kind);
    this.wall(x1, z0, x1, z1, kind);
    this.rooms.push({ x0, z0, x1, z1, name: o.name ?? '', fill: o.fill ?? null });
    for (const [side, at, w = 2] of o.doors ?? []) {
      if (side === 'n') this.door(at, z0, at + w, z0);
      else if (side === 's') this.door(at, z1, at + w, z1);
      else if (side === 'w') this.door(x0, at, x0, at + w);
      else this.door(x1, at, x1, at + w);
    }
  }

  reserve(x: number, z: number): void {
    if (x >= 0 && z >= 0 && x < W && z < H) this.reserved[z * W + x] = 1;
  }

  reserveRect(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.reserve(x, z);
  }

  /** Menjaga jalur keliling (patroli, petugas kebersihan) tetap bebas perabot. */
  reserveLoop(pts: Cell[]): void {
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      this.reserveRect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx) + 1, Math.max(az, bz) + 1);
    }
  }

  reservePatrols(): void {
    for (const p of this.patrols) this.reserveLoop(p.pts);
  }

  /** Menaruh perabot. Dilewati (tidak error) bila menimpa perabot lain atau tile yang dijaga kosong. */
  put(type: ItemType, x: number, z: number, w = 1, h = 1): boolean {
    const def = ITEM_TYPES[type];
    if (x < 0 || z < 0 || x + w > W || z + h > H) return false;
    const cells: number[] = [];
    for (let cz = Math.floor(z); cz < Math.ceil(z + h); cz++)
      for (let cx = Math.floor(x); cx < Math.ceil(x + w); cx++) cells.push(cz * W + cx);
    if (def.solid) {
      if (cells.some((c) => this.taken[c] || this.reserved[c])) return false;
      for (const c of cells) {
        this.taken[c] = 1;
        this.solid[c] = 1;
        if (def.tall) this.tall[c] = 1;
      }
    } else if (cells.some((c) => this.solid[c])) return false;
    this.items.push({ type, x, z, w, h });
    return true;
  }

  /** Mengubah daftar dinding dan pintu menjadi larik sisi tile yang cepat dibaca. */
  finish(): this {
    const set = (key: string, value: number, dyn: number) => {
      const [t, xs, zs] = key.split(',');
      const x = +xs;
      const z = +zs;
      if (t === 'h') {
        this.h[z * W + x] = value;
        this.hDyn[z * W + x] = dyn;
      } else {
        this.v[z * (W + 1) + x] = value;
        this.vDyn[z * (W + 1) + x] = dyn;
      }
    };
    for (const [key, kind] of this.walls) set(key, kind === 'solid' ? 2 : 1, -1);
    for (const d of this.doors) for (const e of d.edges) set(e, d.dyn === undefined ? 0 : 2, d.dyn ?? -1);
    for (const r of this.wet)
      for (let z = r.z; z < r.z + r.h; z++)
        for (let x = r.x; x < r.x + r.w; x++) if (!this.solid[z * W + x]) this.wetCells[z * W + x] = 1;
    this.spawns = this.spawns.filter(([x, z]) => !this.solid[z * W + x]); // item tidak muncul di atas perabot
    return this;
  }
}

// ---------- Pembantu penataan perabot ----------

/** Deret meja saling membelakangi, memanjang ke kanan. Kursi di sisi atas dan bawah. */
function benchH(F: FloorPlan, x: number, z: number, len: number) {
  for (let i = 0; i + 2 <= len; i += 2) {
    if (F.put('desk', x + i, z, 2, 1)) F.put('chair', x + i + 0.5, z - 1);
    if (F.put('desk', x + i, z + 1, 2, 1)) F.put('chair', x + i + 0.5, z + 2);
  }
}

/** Deret meja memanjang ke bawah. Kursi di kiri dan kanan. */
function benchV(F: FloorPlan, x: number, z: number, len: number) {
  for (let i = 0; i + 2 <= len; i += 2) {
    if (F.put('desk', x, z + i, 1, 2)) F.put('chair', x - 1, z + i + 0.5);
    if (F.put('desk', x + 1, z + i, 1, 2)) F.put('chair', x + 2, z + i + 0.5);
  }
}

function meeting(F: FloorPlan, x0: number, z0: number, x1: number, z1: number) {
  const tx = x0 + 2;
  const tz = z0 + 2;
  const tw = Math.max(1, x1 - x0 - 4);
  const th = Math.max(1, z1 - z0 - 4);
  if (F.put('table', tx, tz, tw, th)) {
    for (let x = tx; x < tx + tw; x++) {
      F.put('chair', x, tz - 1);
      F.put('chair', x, tz + th);
    }
    for (let z = tz; z < tz + th; z++) {
      F.put('chair', tx - 1, z);
      F.put('chair', tx + tw, z);
    }
  }
  F.put('tv', x0 + 1, z0, Math.min(3, x1 - x0 - 2), 0.3);
  F.put('plant', x1 - 1, z1 - 1);
}

function office(F: FloorPlan, x0: number, z0: number, x1: number, z1: number) {
  if (F.put('desk', x0 + 1, z0 + 1, 2, 1)) F.put('chair', x0 + 1.5, z0 + 2);
  F.put('cabinet', x1 - 1, z0, 1, 2);
  F.put('shelf', x0 + 3, z0, Math.max(1, x1 - x0 - 5), 1);
  F.put('sofa', x0, z1 - 1, 2, 1);
  F.put('plant', x1 - 1, z1 - 1);
  F.put('lamp', x0, z0);
}

function row(F: FloorPlan, type: ItemType, x: number, z: number, n: number, dx: number, dz: number, w = 1, h = 1) {
  for (let i = 0; i < n; i++) F.put(type, x + i * dx, z + i * dz, w, h);
}

function cafeTables(F: FloorPlan, x0: number, z0: number, x1: number, z1: number, stepX = 4, stepZ = 4) {
  for (let z = z0; z + 2 <= z1; z += stepZ)
    for (let x = x0; x + 2 <= x1; x += stepX)
      if (F.put('table', x, z, 2, 2)) {
        F.put('chair', x - 1, z + 0.5);
        F.put('chair', x + 2, z + 0.5);
        F.put('chair', x + 0.5, z - 1);
        F.put('chair', x + 0.5, z + 2);
      }
}

// ---------- Kerangka yang sama di semua lantai ----------
// Inti gedung di tengah (dua lift + lobi lift + toilet), tangga darurat di ujung barat dan timur.
type Rect = readonly [number, number, number, number];
export const LIFT_A: Rect = [25, 13, 29, 17];
export const LIFT_B: Rect = [31, 13, 35, 17];
const STAIR_W: Rect = [0, 14, 5, 20];
const STAIR_E: Rect = [55, 14, 60, 20];

/**
 * lift: 'naik' (pemain naik lift di sini), 'tiba' (pemain keluar lift di sini), atau null (lift tidak dipakai).
 * tangga: 'turun' (masuk tangga di sini), 'tiba' (keluar tangga di sini), atau 'tutup'.
 */
function skeleton(F: FloorPlan, { lift, tangga, lobbyDoors }: { lift: 'naik' | 'tiba' | null; tangga: 'turun' | 'tiba' | 'tutup'; lobbyDoors: DoorSpec[] }) {
  F.room(0, 0, W, H, { kind: 'solid' });

  // Inti: shaft, dua kabin lift, lobi lift
  for (const [x0, z0, x1, z1] of [[24, 12, 36, 13], [24, 13, 25, 17], [35, 13, 36, 17], [29, 13, 31, 17]])
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) F.put('shaft', x, z);
  for (const [name, [x0, z0, x1, z1]] of [['A', LIFT_A], ['B', LIFT_B]] as const) {
    F.room(x0, z0, x1, z1, { kind: 'solid' });
    F.reserveRect(x0, z0, x1, z1);
    // Pintu lift dibuka-tutup oleh simulasi lift
    if (lift) F.door(x0 + 1, z1, x1 - 1, z1, { dyn: liftDoorId(F.no, name === 'A' ? 0 : 1) });
  }
  F.room(24, 17, 36, 21, { name: 'Lobi lift', kind: 'solid', fill: '#e6e9f2', doors: lobbyDoors });
  F.reserveRect(25, 17, 35, 20);

  // Toilet di kiri-kanan inti
  F.room(20, 12, 24, 17, { name: 'Toilet', kind: 'solid', fill: '#dfeaf0', doors: [['s', 21, 2]] });
  row(F, 'toilet', 20, 12, 4, 1, 0);
  F.put('sink', 20, 14, 1, 2);
  F.room(36, 12, 40, 17, { name: 'Toilet', kind: 'solid', fill: '#dfeaf0', doors: [['s', 37, 2]] });
  row(F, 'toilet', 36, 12, 4, 1, 0);
  F.put('sink', 39, 14, 1, 2);

  // Tangga darurat
  for (const [x0, z0, x1, z1] of [STAIR_W, STAIR_E]) {
    F.room(x0, z0, x1, z1, { kind: 'solid', fill: '#e6e9f2' });
    for (let z = 15; z < 19; z++) {
      F.put('shaft', x0, z);
      F.put('shaft', x1 - 1, z);
    }
    F.reserveRect(x0, z0, x1, z1);
    if (tangga === 'turun') {
      F.door(x0 + 1, z0, x1 - 1, z0); // masuk dari utara
      F.wall(x0 + 1, 19, x1 - 1, 19, 'solid'); // ujung bawah tertutup di lantai ini
    } else if (tangga === 'tiba') {
      F.door(x0 + 1, z1, x1 - 1, z1); // keluar ke selatan
      F.wall(x0 + 1, 15, x1 - 1, 15, 'solid');
    }
    F.stairs.push({ x0: x0 + 1, z0: 15, x1: x1 - 1, z1: 19, mode: tangga });
  }
}


// =====================================================================================
// LANTAI 5 — RUANG KERJA (start). Turun lewat tangga darurat barat atau timur.
// =====================================================================================
function lantai5() {
  const F = new FloorPlan(5, 'Lantai 5 — Ruang Kerja');
  skeleton(F, { lift: null, tangga: 'turun', lobbyDoors: [['s', 29, 2]] });

  // Deret ruangan di sisi utara
  F.room(0, 0, 9, 6, { name: 'R. Direktur', fill: '#efe3cf', doors: [['s', 6, 2]] });
  F.room(9, 0, 15, 6, { name: 'Manajer A', fill: '#efe3cf', doors: [['s', 10, 2]] });
  F.room(15, 0, 21, 6, { name: 'Print & Arsip', fill: '#e3e6ee', doors: [['s', 17, 2]] });
  F.room(21, 0, 31, 6, { name: 'Rapat "Monas"', fill: '#d9ecd9', doors: [['s', 22, 2], ['e', 2, 2]] });
  F.room(31, 0, 39, 6, { name: 'Rapat "Semanggi"', fill: '#d9ecd9', doors: [['s', 36, 2]] });
  F.room(39, 0, 45, 6, { name: 'Manajer B', fill: '#efe3cf', doors: [['s', 40, 2]] });
  F.room(45, 0, 51, 6, { name: 'Manajer C', fill: '#efe3cf', doors: [['s', 48, 2]] });
  F.room(51, 0, 60, 6, { name: 'Ruang Server', kind: 'solid', fill: '#d5d8e0', doors: [['s', 52, 1]] });

  // Sekat kaca open-plan: memaksa zig-zag menuju tangga
  F.wall(18, 8, 18, 26);
  F.door(18, 8, 18, 10);
  F.door(18, 22, 18, 24);
  F.wall(11, 8, 11, 26);
  F.door(11, 16, 11, 18);
  F.door(11, 24, 11, 25, { narrow: true });
  F.wall(42, 8, 42, 26);
  F.door(42, 12, 42, 14);
  F.door(42, 24, 42, 26);
  F.wall(49, 8, 49, 26);
  F.door(49, 8, 49, 10);
  F.door(49, 21, 49, 22, { narrow: true });

  // Deret ruangan di sisi selatan, saling tembus
  F.wall(0, 26, 24, 26);
  F.wall(36, 26, 60, 26);
  F.room(0, 26, 12, 34, { name: 'Lounge Kolaborasi', fill: '#f7ead0', doors: [['n', 3, 2], ['e', 29, 2]] });
  F.room(12, 26, 24, 34, { name: 'Pantry Lt 5', fill: '#f4ecd8', doors: [['n', 14, 2], ['e', 29, 2]] });
  F.room(36, 26, 48, 34, { name: 'Perpustakaan', fill: '#e6dcf2', doors: [['w', 29, 2], ['n', 44, 2], ['e', 29, 2]] });
  F.room(48, 26, 60, 34, { name: 'Loker & ATK', fill: '#e3e6ee', doors: [['n', 55, 2]] });

  // Start: 8 kursi di dekat inti gedung, empat di utara dan empat di selatan
  F.starts = [[26, 8], [30, 8], [34, 8], [28, 11], [26, 22], [30, 22], [34, 22], [32, 25]];
  for (const [x, z] of F.starts) F.reserve(x, z);

  benchH(F, 25, 9, 10);
  benchH(F, 25, 23, 10);
  benchV(F, 20, 19, 6);
  benchV(F, 14, 9, 6);
  benchV(F, 14, 19, 6);
  benchH(F, 6, 9, 4);
  benchH(F, 6, 21, 4);
  benchV(F, 38, 19, 6);
  benchV(F, 45, 9, 6);
  benchV(F, 45, 17, 8);
  benchH(F, 51, 10, 4);
  benchH(F, 51, 22, 4);
  row(F, 'plant', 12, 8, 1, 1, 0);
  row(F, 'cabinet', 5, 11, 3, 0, 1);
  row(F, 'cabinet', 54, 17, 1, 0, 1);
  F.put('printer', 19, 12);
  F.put('printer', 40, 18);
  F.put('dispenser', 23, 8);
  F.put('dispenser', 36, 8);
  row(F, 'booth', 39, 8, 2, 0, 2, 1, 1);
  row(F, 'plant', 17, 12, 1, 0, 1);
  F.put('plant', 43, 8);
  F.put('plant', 48, 25);
  F.put('lamp', 5, 8);
  F.put('lamp', 54, 8);
  F.put('sofa', 6, 13, 2, 1);
  F.put('sofa', 51, 14, 2, 1);

  office(F, 0, 0, 9, 6);
  office(F, 9, 0, 15, 6);
  office(F, 39, 0, 45, 6);
  office(F, 45, 0, 51, 6);
  meeting(F, 21, 0, 31, 6);
  meeting(F, 31, 0, 39, 6);
  row(F, 'printer', 15, 0, 2, 2, 0);
  row(F, 'shelf', 19, 0, 1, 0, 1, 2, 1);
  row(F, 'cabinet', 15, 3, 2, 0, 1);
  row(F, 'server', 53, 0, 6, 1, 0, 1, 2);
  row(F, 'server', 55, 4, 4, 1, 0);
  // Lounge
  F.put('sofa', 1, 28, 3, 1);
  F.put('sofa', 1, 32, 3, 1);
  row(F, 'beanbag', 6, 28, 3, 2, 0);
  F.put('table', 5, 31, 2, 1);
  F.put('pingpong', 8, 31, 3, 2);
  F.put('mat', 1, 29, 4, 3);
  F.put('plant', 0, 26);
  F.put('lamp', 11, 33);
  F.put('tv', 5, 33.7, 3, 0.3);
  // Pantry
  row(F, 'counter', 13, 33, 6, 1, 0);
  F.put('coffee', 19, 33);
  F.put('fridge', 20, 33);
  F.put('vending', 21, 33);
  F.put('dispenser', 22, 33);
  cafeTables(F, 17, 28, 23, 31, 4, 4);
  // Perpustakaan
  row(F, 'shelf', 38, 27, 3, 0, 2, 4, 1);
  row(F, 'beanbag', 44, 31, 2, 2, 0);
  F.put('sofa', 37, 33, 3, 1);
  F.put('lamp', 47, 33);
  // Loker
  row(F, 'locker', 49, 33, 10, 1, 0);
  row(F, 'locker', 49, 27, 4, 1, 0);
  row(F, 'cabinet', 59, 28, 4, 0, 1);
  F.put('printer', 51, 30);

  // Aula kecil di selatan inti gedung
  F.rooms.push({ x0: 24, z0: 26, x1: 36, z1: 34, name: 'Area Town Hall', fill: '#f4ecd8' });
  row(F, 'sofa', 25, 29, 3, 4, 0, 2, 1);
  row(F, 'beanbag', 26, 31, 3, 4, 0);
  F.put('tv', 27, 33.7, 6, 0.3);
  F.put('plant', 24, 33);
  F.put('plant', 35, 33);
  F.put('lamp', 24, 27);
  F.put('coffee', 35, 27);
  row(F, 'cabinet', 7, 18, 2, 1, 0);
  F.put('plant', 9, 25);
  F.put('plant', 50, 25);

  F.wet.push({ x: 6, z: 15, w: 4, h: 3 }, { x: 50, z: 17, w: 4, h: 3 });
  F.spawns = [[16, 7], [44, 7], [3, 10], [57, 11], [8, 24], [52, 25], [21, 30], [41, 31], [30, 28]];
  return F;
}

// =====================================================================================
// LANTAI 4 — MEETING & KOLABORASI. Tidak ada tangga turun: hanya 2 lift (zona atas).
// =====================================================================================
function lantai4() {
  const F = new FloorPlan(4, 'Lantai 4 — Meeting & Kolaborasi');
  skeleton(F, {
    lift: 'naik', tangga: 'tiba',
    lobbyDoors: [['s', 29, 2], ['e', 18, 1]],
  });

  // Barat: lorong kedatangan z 20-22, lalu dua baris ruang rapat yang saling tembus
  F.wall(5, 20, 24, 20);
  F.door(9, 20, 11, 20);
  F.wall(24, 21, 24, 34, 'solid');
  F.door(24, 21, 24, 22, { narrow: true }); // jalan pintas sempit ke depan lift
  F.room(0, 22, 8, 28, { name: 'Rapat "Kuningan"', fill: '#d9ecd9', doors: [['n', 2, 2], ['e', 24, 2]] });
  F.room(8, 22, 16, 28, { name: 'Rapat "Sudirman"', fill: '#d9ecd9', doors: [['e', 23, 2], ['s', 10, 2]] });
  F.room(16, 22, 24, 28, { name: 'Rapat "Thamrin"', fill: '#d9ecd9', doors: [['n', 18, 2], ['e', 24, 2]] });
  F.room(0, 28, 8, 34, { name: 'Studio Podcast', fill: '#e6dcf2', doors: [['n', 5, 2], ['e', 30, 2]] });
  F.room(8, 28, 16, 34, { name: 'R. Training', fill: '#f7ead0', doors: [['e', 30, 2]] });
  F.room(16, 28, 24, 34, { name: 'Lounge', fill: '#f7ead0', doors: [['e', 30, 2]] });

  // Timur: lorong kedatangan, ruang direksi sebagai jalan pintas ke pintu sempit lobi lift
  F.wall(36, 20, 55, 20);
  F.door(44, 20, 46, 20);
  F.wall(36, 21, 36, 34, 'solid');
  F.door(36, 22, 36, 24);
  F.room(40, 14, 55, 20, { name: 'Rapat Direksi', fill: '#d9ecd9', doors: [['w', 17, 2], ['n', 50, 2]] });
  F.room(36, 22, 44, 28, { name: 'Rapat "Gatot Subroto"', fill: '#d9ecd9', doors: [['n', 38, 2], ['e', 24, 2]] });
  F.room(44, 22, 52, 28, { name: 'Rapat "Senopati"', fill: '#d9ecd9', doors: [['n', 48, 2], ['s', 46, 2]] });
  F.room(52, 22, 60, 28, { name: 'Bilik Fokus', fill: '#e3e6ee', doors: [['n', 55, 2]] });
  F.room(36, 28, 48, 34, { name: 'Ruang Kreatif', fill: '#f7ead0', doors: [['w', 30, 2], ['e', 30, 2]] });
  F.room(48, 28, 60, 34, { name: 'Gudang Event', fill: '#e3e6ee', doors: [] });

  // Utara: aula dan ruang-ruang pendukung (jalur memutar lewat belakang inti gedung)
  F.room(0, 0, 10, 8, { name: 'Rapat "Blok M"', fill: '#d9ecd9', doors: [['s', 4, 2], ['e', 3, 2]] });
  F.room(10, 0, 22, 8, { name: 'Bilik Telepon', fill: '#e3e6ee', doors: [['s', 12, 2], ['e', 3, 2]] });
  F.room(22, 0, 38, 8, { name: 'Aula Town Hall', fill: '#f4ecd8', doors: [['s', 24, 2], ['s', 34, 2]] });
  F.room(38, 0, 50, 8, { name: 'Rapat "Kemang"', fill: '#d9ecd9', doors: [['w', 3, 2], ['s', 46, 2]] });
  F.room(50, 0, 60, 8, { name: 'Rapat "Menteng"', fill: '#d9ecd9', doors: [['s', 53, 2]] });
  F.wall(5, 12, 20, 12);
  F.door(12, 12, 14, 12);
  F.wall(40, 12, 55, 12);
  F.door(42, 12, 44, 12);
  F.room(5, 12, 20, 20, { name: 'Area Kolaborasi', fill: '#f7ead0', doors: [['e', 17, 2]] });

  for (const r of [[0, 22, 8, 28], [8, 22, 16, 28], [16, 22, 24, 28], [36, 22, 44, 28], [44, 22, 52, 28], [0, 0, 10, 8], [38, 0, 50, 8], [50, 0, 60, 8], [40, 14, 55, 20]])
    meeting(F, r[0], r[1], r[2], r[3]);
  // Studio, training, lounge
  F.put('table', 2, 30, 3, 2);
  row(F, 'chair', 2, 29, 3, 1, 0);
  row(F, 'lamp', 0, 33, 1, 1, 0);
  F.put('shelf', 0, 28, 3, 1);
  row(F, 'desk', 9, 29, 3, 2, 0, 1, 2);
  row(F, 'desk', 9, 32, 3, 2, 0, 1, 2);
  F.put('tv', 10, 33.7, 4, 0.3);
  F.put('sofa', 17, 29, 3, 1);
  F.put('sofa', 17, 33, 3, 1);
  row(F, 'beanbag', 21, 29, 2, 0, 3);
  F.put('coffee', 16, 31);
  F.put('plant', 23, 33);
  // Area kolaborasi barat
  benchH(F, 7, 14, 6);
  row(F, 'beanbag', 15, 13, 2, 2, 0);
  F.put('sofa', 15, 18, 3, 1);
  F.put('plant', 5, 12);
  F.put('lamp', 5, 19);
  row(F, 'booth', 11, 0, 5, 2, 0, 1, 2);
  row(F, 'booth', 11, 5, 4, 2, 0, 1, 2);
  // Aula
  for (let z = 1; z <= 5; z += 2) row(F, 'chair', 25, z, 10, 1, 0);
  F.put('tv', 27, 0, 6, 0.3);
  F.put('table', 29, 6, 2, 1);
  row(F, 'plant', 22, 0, 1, 1, 0);
  F.put('plant', 37, 0);
  // Timur
  row(F, 'booth', 53, 23, 3, 2, 0, 1, 2);
  row(F, 'booth', 53, 26, 3, 2, 0, 1, 1);
  F.put('table', 39, 30, 3, 2);
  row(F, 'beanbag', 43, 29, 2, 0, 3);
  F.put('shelf', 44, 33, 3, 1);
  row(F, 'cabinet', 49, 28, 5, 2, 0);
  row(F, 'cabinet', 49, 32, 5, 2, 0);
  // Lorong utara
  row(F, 'plant', 6, 9, 1, 1, 0);
  F.put('printer', 21, 9);
  F.put('dispenser', 38, 9);
  F.put('sofa', 47, 9, 3, 1);
  F.put('plant', 54, 12);
  F.put('vending', 23, 19);
  F.put('plant', 25, 21);
  F.put('plant', 34, 21);
  row(F, 'sofa', 27, 31, 2, 4, 0, 2, 1);
  F.put('plant', 30, 33);
  F.put('lamp', 35, 33);

  F.put('reception', 28, 28, 4, 1);
  row(F, 'plant', 25, 26, 2, 9, 0);
  F.put('printer', 25, 29);
  F.put('dispenser', 34, 29);

  F.wet.push({ x: 26, z: 23, w: 8, h: 3 });
  F.spawns = [[3, 21], [56, 21], [30, 27], [12, 10], [46, 10], [20, 31], [40, 25], [30, 10], [57, 9]];
  return F;
}

// =====================================================================================
// LANTAI 3 — HR & DIREKSI (petak umpet). Turun lewat tangga.
// =====================================================================================
function lantai3() {
  const F = new FloorPlan(3, 'Lantai 3 — HR & Direksi (petak umpet)');
  skeleton(F, {
    lift: 'tiba', tangga: 'turun',
    lobbyDoors: [['w', 18, 2], ['e', 18, 2]],
  });

  // Barat: blok ruangan HR dikelilingi lorong melingkar (rute patroli HR)
  F.room(7, 10, 13, 15, { name: 'Interview 1', fill: '#fbe0e0', doors: [['n', 9, 2], ['s', 10, 2]] });
  F.room(13, 10, 18, 15, { name: 'Interview 2', fill: '#fbe0e0', doors: [['n', 15, 2], ['w', 12, 1]] });
  F.room(7, 15, 18, 21, { name: 'Payroll', fill: '#fbe0e0', doors: [['e', 17, 2], ['w', 17, 2]] });
  F.room(0, 0, 12, 8, { name: 'Kantor HRD', fill: '#fbe0e0', doors: [['s', 3, 2], ['e', 3, 2]] });
  F.room(12, 0, 22, 8, { name: 'Arsip Personalia', fill: '#e3e6ee', doors: [['s', 18, 2]] });
  F.room(0, 23, 10, 34, { name: 'Klinik', fill: '#dfeaf0', doors: [['n', 6, 2], ['e', 27, 2]] });
  F.room(10, 23, 24, 34, { name: 'R. Training Karyawan Baru', fill: '#f7ead0', doors: [['n', 12, 2], ['n', 20, 2]] });

  // Timur: wilayah direksi
  F.room(42, 10, 53, 15, { name: 'Sekretaris', fill: '#efe3cf', doors: [['n', 50, 2], ['s', 44, 2]] });
  F.room(42, 15, 53, 21, { name: 'Legal', fill: '#efe3cf', doors: [['w', 17, 2], ['e', 18, 2]] });
  F.room(38, 0, 48, 8, { name: 'Rapat Direksi', fill: '#d9ecd9', doors: [['s', 40, 2]] });
  F.room(48, 0, 60, 8, { name: 'R. Direktur Utama', fill: '#efe3cf', doors: [['s', 55, 2], ['w', 3, 2]] });
  F.room(22, 0, 38, 8, { name: 'Ruang Tunggu Tamu', fill: '#f4ecd8', doors: [['s', 24, 2], ['s', 34, 2]] });
  F.room(36, 23, 48, 34, { name: 'Keuangan', fill: '#efe3cf', doors: [['n', 38, 2], ['e', 28, 2]] });
  F.room(48, 23, 60, 34, { name: 'Brankas & Arsip', kind: 'solid', fill: '#d5d8e0', doors: [['n', 50, 1]] });
  F.room(24, 21, 36, 34, { name: 'Lounge Direksi', fill: '#f4ecd8', doors: [['w', 25, 2], ['e', 25, 2]] });

  // Rute patroli (tile-tilenya dijaga kosong)
  F.patrols = [
    { name: 'HR', pts: [[19, 9], [6, 9], [6, 22], [19, 22]] },
    { name: 'Manajer', pts: [[40, 9], [54, 9], [54, 22], [40, 22]] },
    { name: 'Direktur', pts: [[22, 9], [37, 9], [37, 10], [22, 10]] },
  ];
  F.reservePatrols();

  benchH(F, 1, 1, 8);
  benchH(F, 1, 5, 2);
  row(F, 'cabinet', 11, 0, 2, 0, 1);
  F.put('plant', 9, 7);
  row(F, 'shelf', 13, 0, 4, 2, 0, 2, 1);
  row(F, 'cabinet', 13, 3, 4, 2, 0);
  row(F, 'cabinet', 13, 5, 4, 2, 0);
  for (const r of [[7, 10, 13, 15], [13, 10, 18, 15], [38, 0, 48, 8]]) meeting(F, r[0], r[1], r[2], r[3]);
  benchH(F, 9, 17, 6);
  F.put('cabinet', 17, 20);
  F.put('printer', 7, 20);
  // Klinik
  row(F, 'bed', 1, 25, 3, 0, 3, 2, 1);
  F.put('counter', 5, 24, 3, 1);
  F.put('cabinet', 9, 31, 1, 2);
  F.put('sink', 5, 33);
  // Training
  for (let z = 25; z <= 31; z += 3) row(F, 'desk', 12, z, 5, 2, 0, 2, 1);
  for (let z = 26; z <= 32; z += 3) row(F, 'chair', 12.5, z, 5, 2, 0);
  F.put('tv', 14, 33.7, 5, 0.3);
  F.put('plant', 23, 33);
  // Ruang tunggu
  row(F, 'sofa', 24, 1, 3, 4, 0, 3, 1);
  row(F, 'sofa', 24, 5, 3, 4, 0, 3, 1);
  row(F, 'table', 25, 3, 3, 4, 0);
  F.put('reception', 35, 2, 2, 3);
  row(F, 'plant', 22, 0, 1, 1, 0);
  F.put('lamp', 37, 7);
  // Direktur utama
  F.put('desk', 53, 2, 3, 1);
  F.put('chair', 54, 1);
  F.put('sofa', 50, 5, 3, 1);
  F.put('table', 51, 6, 1, 1);
  row(F, 'shelf', 56, 0, 1, 1, 0, 4, 1);
  F.put('plant', 59, 7);
  F.put('lamp', 49, 0);
  F.put('cabinet', 59, 3, 1, 2);
  // Sekretaris, legal, keuangan
  benchH(F, 44, 12, 4);
  F.put('printer', 52, 14);
  benchH(F, 45, 17, 6);
  row(F, 'cabinet', 44, 20, 3, 1, 0);
  benchH(F, 38, 25, 8);
  benchH(F, 38, 30, 8);
  row(F, 'cabinet', 47, 24, 3, 0, 1);
  row(F, 'cabinet', 49, 24, 5, 2, 0, 1, 2);
  row(F, 'cabinet', 49, 28, 5, 2, 0, 1, 2);
  row(F, 'shelf', 50, 33, 2, 5, 0, 4, 1);
  // Tempat sembunyi di lorong: tanaman, lemari, dan mesin menghalangi pandangan
  for (const [x, z] of [[8, 8], [14, 8], [20, 11], [5, 11], [5, 21], [12, 22], [18, 23], [21, 8]]) F.put('plant', x, z);
  for (const [x, z] of [[41, 8], [47, 8], [55, 11], [55, 20], [46, 22], [52, 22], [39, 20]]) F.put('plant', x, z);
  F.put('vending', 20, 21);
  F.put('printer', 41, 21);
  row(F, 'cabinet', 26, 11, 3, 3, 0);
  F.put('dispenser', 23, 11);
  row(F, 'sofa', 27, 23, 2, 4, 0, 2, 1);
  row(F, 'plant', 25, 26, 3, 4, 0);
  F.put('lamp', 35, 33);
  row(F, 'locker', 25, 33, 8, 1, 0);

  F.spawns = [[30, 22], [3, 9], [56, 9], [10, 22], [50, 22], [30, 30], [20, 9]];
  return F;
}

// =====================================================================================
// LANTAI 2 — SOSIAL: kantin, musholla, game room, gym. Hanya lift (zona bawah).
// =====================================================================================
function lantai2() {
  const F = new FloorPlan(2, 'Lantai 2 — Kantin, Musholla & Game Room');
  skeleton(F, {
    lift: 'naik', tangga: 'tiba',
    lobbyDoors: [['w', 18, 1], ['e', 18, 2], ['s', 29, 2]],
  });

  // Barat: kantin besar dengan kios makanan
  F.room(0, 22, 24, 34, { name: 'Kantin', fill: '#f4ecd8', doors: [['n', 2, 2], ['n', 14, 2], ['e', 24, 2], ['e', 31, 2]] });
  F.wall(12, 22, 12, 30);
  F.room(5, 12, 20, 20, { name: 'Koperasi & Minimarket', fill: '#f7ead0', doors: [['s', 8, 2], ['e', 18, 2], ['n', 16, 2]] });
  F.wall(5, 20, 5, 22);
  F.door(5, 20, 5, 22);
  F.room(0, 0, 12, 8, { name: 'Musholla', fill: '#d9ecd9', doors: [['s', 8, 2], ['e', 5, 2]] });
  F.room(12, 0, 20, 8, { name: 'Tempat Wudhu', fill: '#dfeaf0', doors: [['s', 14, 2]] });
  // Tengah-utara & timur
  F.room(20, 0, 34, 8, { name: 'Game Room', fill: '#e6dcf2', doors: [['s', 22, 2], ['s', 30, 2], ['e', 3, 2]] });
  F.room(34, 0, 46, 8, { name: 'Nap Room', fill: '#e6dcf2', doors: [['s', 42, 2]] });
  F.room(46, 0, 60, 8, { name: 'Gym', fill: '#e3e6ee', doors: [['s', 48, 2], ['s', 56, 2]] });
  F.room(40, 12, 55, 20, { name: 'Kedai Kopi Karyawan', fill: '#f4ecd8', doors: [['n', 46, 2], ['w', 18, 2], ['s', 50, 2]] });
  F.wall(36, 20, 40, 20);
  F.room(36, 22, 48, 34, { name: 'R. Laktasi & P3K', fill: '#dfeaf0', doors: [['n', 38, 2]] });
  F.room(48, 22, 60, 34, { name: 'Smoking Area', fill: '#d5d8e0', doors: [['n', 56, 2], ['w', 28, 2]] });
  F.wall(36, 21, 36, 34, 'solid');
  F.door(36, 21, 36, 22, { narrow: true });
  F.wall(24, 21, 24, 22, 'solid');

  // Rute petugas kebersihan (mengepel sambil mundur) melewati kantin dan depan lift
  F.janitor = [[25, 23], [34, 23], [34, 31], [25, 31]];
  F.reserveLoop(F.janitor);
  F.reservePatrols();

  // Kantin
  row(F, 'counter', 1, 33, 10, 1, 0);
  row(F, 'counter', 0, 25, 1, 0, 1, 1, 6);
  F.put('fridge', 11, 33);
  F.put('coffee', 0, 33);
  cafeTables(F, 3, 24, 11, 31, 4, 4);
  cafeTables(F, 14, 24, 21, 33, 4, 4);
  F.put('vending', 23, 27);
  F.put('dispenser', 23, 29);
  F.put('plant', 23, 33);
  // Koperasi
  row(F, 'shelf', 7, 14, 3, 4, 0, 3, 1);
  row(F, 'shelf', 7, 17, 3, 4, 0, 3, 1);
  F.put('counter', 17, 13, 2, 1);
  F.put('fridge', 19, 12);
  F.put('atm', 5, 12);
  // Musholla
  for (let z = 1; z <= 5; z += 2) row(F, 'mat', 1, z, 5, 2, 0, 1, 1.6);
  row(F, 'shelf', 11, 0, 1, 0, 1, 1, 3);
  row(F, 'sink', 13, 0, 6, 1, 0);
  row(F, 'sink', 19, 3, 3, 0, 1);
  // Game room
  F.put('pingpong', 22, 2, 3, 2);
  F.put('pingpong', 27, 2, 3, 2);
  row(F, 'beanbag', 22, 6, 3, 2, 0);
  F.put('tv', 21, 0, 4, 0.3);
  F.put('sofa', 31, 5, 2, 1);
  F.put('vending', 33, 0);
  F.put('lamp', 20, 0);
  // Nap room
  row(F, 'bed', 35, 1, 5, 2, 0, 1, 2);
  row(F, 'bed', 35, 5, 3, 2, 0, 1, 2);
  F.put('plant', 45, 0);
  F.put('lamp', 45, 7);
  // Gym
  row(F, 'gym', 47, 1, 5, 2, 0, 1, 2);
  row(F, 'gym', 51, 5, 3, 3, 0, 2, 1);
  row(F, 'locker', 57, 0, 3, 1, 0);
  F.put('dispenser', 59, 7);
  F.put('mat', 47, 4, 3, 2);
  // Kedai kopi
  row(F, 'counter', 41, 13, 4, 1, 0);
  F.put('coffee', 45, 13);
  cafeTables(F, 42, 16, 53, 19, 4, 4);
  row(F, 'sofa', 50, 13, 1, 1, 0, 3, 1);
  F.put('plant', 54, 12);
  // Laktasi & P3K
  row(F, 'sofa', 37, 25, 2, 0, 4, 2, 1);
  F.put('fridge', 47, 23);
  F.put('bed', 42, 30, 2, 1);
  F.put('cabinet', 47, 30, 1, 3);
  F.put('sink', 40, 33);
  F.put('plant', 37, 33);
  // Smoking area
  row(F, 'sofa', 50, 33, 2, 4, 0, 3, 1);
  row(F, 'plant', 49, 24, 3, 3, 0);
  F.put('table', 53, 28, 2, 2);
  // Lorong
  for (const [x, z] of [[21, 9], [36, 9], [56, 9], [3, 11], [28, 25], [32, 29], [29, 33]]) F.put('plant', x, z);
  row(F, 'sofa', 27, 27, 2, 4, 0, 2, 1);
  F.put('atm', 35, 25);
  F.put('atm', 35, 27);
  F.put('lamp', 25, 33);

  F.wet.push(
    { x: 12, z: 3, w: 7, h: 5 },
    { x: 13, z: 8, w: 5, h: 2 },
    { x: 27, z: 25, w: 6, h: 3 },
    { x: 12, z: 22, w: 4, h: 3 },
  );
  F.spawns = [[3, 21], [56, 21], [30, 30], [30, 10], [10, 21], [45, 10], [22, 23], [57, 23], [18, 10]];
  return F;
}

// =====================================================================================
// LANTAI 1 — LOBBY. Turnstile, kedai kopi, gerbang keluar.
// =====================================================================================
function lantai1() {
  const F = new FloorPlan(1, 'Lantai 1 — Lobby Utama');
  skeleton(F, {
    lift: 'tiba', tangga: 'tutup',
    lobbyDoors: [['s', 28, 4], ['w', 18, 2]],
  });

  // Barisan turnstile di selatan lobi lift
  F.wall(14, 24, 46, 24, 'solid');
  for (const x of [24, 27, 30, 33, 36]) F.door(x, 24, x + 1, 24, { narrow: true });
  for (const x of [25, 26, 28, 29, 31, 32, 34, 35]) F.put('turnstile', x, 23);
  F.wall(14, 12, 14, 24, 'solid');
  F.wall(46, 12, 46, 24, 'solid');
  F.door(14, 18, 14, 20);

  // Sayap barat: kedai kopi (jalan memutar tanpa turnstile)
  F.room(0, 22, 14, 34, { name: 'Kedai Kopi "Kopi Tenggo"', fill: '#f4ecd8', doors: [['n', 6, 2], ['e', 30, 2]] });
  F.room(0, 0, 14, 12, { name: 'Mailroom & Paket', fill: '#e3e6ee', doors: [['s', 6, 2]] });
  F.room(14, 0, 30, 10, { name: 'Pos Satpam & CCTV', kind: 'solid', fill: '#d5d8e0', doors: [['s', 20, 2]] });
  F.room(30, 0, 46, 10, { name: 'Ruang Panel & Genset', kind: 'solid', fill: '#d5d8e0', doors: [['s', 40, 1]] });
  // Sayap timur
  F.room(46, 0, 60, 12, { name: 'Bank & ATM Center', fill: '#dfeaf0', doors: [['s', 50, 2]] });
  F.room(46, 22, 60, 34, { name: 'Minimarket', fill: '#f7ead0', doors: [['w', 28, 2], ['n', 52, 2]] });
  F.wall(46, 24, 46, 34);

  // Gerbang keluar: pintu putar di tengah sisi selatan
  F.door(28, 34, 32, 34, {});

  // Aula lobby
  F.put('reception', 27, 27, 6, 1);
  row(F, 'chair', 28, 26, 4, 1, 0);
  row(F, 'sofa', 17, 27, 2, 4, 0, 3, 1);
  row(F, 'sofa', 17, 31, 2, 4, 0, 3, 1);
  row(F, 'table', 18, 29, 2, 4, 0);
  row(F, 'sofa', 36, 27, 2, 4, 0, 3, 1);
  row(F, 'sofa', 36, 31, 2, 4, 0, 3, 1);
  row(F, 'table', 37, 29, 2, 4, 0);
  for (const [x, z] of [[15, 25], [45, 25], [15, 33], [45, 33], [24, 32], [35, 32], [23, 25], [37, 25]]) F.put('plant', x, z);
  F.put('lamp', 26, 33);
  F.put('lamp', 33, 33);
  F.put('reception', 20, 22, 2, 1);
  F.put('reception', 38, 22, 2, 1);
  // Kedai kopi
  row(F, 'counter', 1, 33, 8, 1, 0);
  F.put('coffee', 9, 33);
  F.put('coffee', 10, 33);
  F.put('fridge', 0, 33);
  cafeTables(F, 2, 24, 12, 31, 4, 4);
  F.put('plant', 13, 33);
  // Mailroom
  row(F, 'shelf', 1, 1, 3, 4, 0, 3, 1);
  row(F, 'shelf', 1, 4, 3, 4, 0, 3, 1);
  row(F, 'locker', 0, 7, 1, 0, 1, 1, 4);
  F.put('counter', 9, 8, 4, 1);
  // Satpam & panel
  row(F, 'desk', 15, 1, 4, 3, 0, 2, 1);
  F.put('tv', 15, 0, 12, 0.3);
  row(F, 'locker', 27, 1, 1, 0, 1, 2, 6);
  row(F, 'server', 31, 1, 7, 2, 0, 1, 3);
  row(F, 'server', 31, 6, 4, 2, 0, 1, 2);
  // Bank
  row(F, 'atm', 47, 0, 6, 2, 0);
  F.put('counter', 47, 5, 8, 1);
  row(F, 'chair', 48, 7, 4, 2, 0);
  F.put('plant', 59, 11);
  // Minimarket
  row(F, 'shelf', 49, 24, 3, 0, 3, 8, 1);
  F.put('counter', 47, 32, 3, 1);
  row(F, 'fridge', 59, 23, 5, 0, 2);
  // Lorong belakang
  for (const [x, z] of [[16, 11], [44, 11], [19, 17], [41, 17], [2, 13], [57, 13]]) F.put('plant', x, z);
  row(F, 'sofa', 6, 15, 1, 1, 0, 3, 1);
  row(F, 'sofa', 50, 15, 1, 1, 0, 3, 1);
  F.put('vending', 13, 13);
  F.put('dispenser', 47, 21);

  // Mengepel di antara lobi lift dan turnstile, jauh dari pintu keluar
  F.janitor = [[22, 22], [37, 22]];
  F.reserveLoop(F.janitor);
  F.wet.push({ x: 6, z: 17, w: 5, h: 3 }); // pintu keluar sengaja dibiarkan kering
  F.spawns = [[30, 22], [10, 17], [50, 18], [22, 29], [40, 29], [7, 25], [53, 30]];
  return F;
}

// =====================================================================================
// AREA LUAR — plaza, penyeberangan berlampu lalu lintas, Halte TransJakarta. FINIS = naik bus.
// Baris z < 3 di sini adalah bagian dalam lobby (lihat portal di map.ts).
// =====================================================================================
export const ZEBRAS: readonly { x0: number; x1: number }[] = [{ x0: 14, x1: 18 }, { x0: 42, x1: 46 }];
export const ROAD = { z0: 11, z1: 17, lanes: [12, 14, 16] } as const;
export const BUS = { x0: 21, z0: 24, x1: 39, z1: 27 } as const;
export const HALTE = { x0: 8, z0: 17, x1: 52, z1: 24 } as const;

function areaLuar() {
  const F = new FloorPlan(0, 'Jalan Raya & Halte TransJakarta');
  F.room(0, 0, W, H, { kind: 'solid' });
  F.wall(0, 3, W, 3, 'solid');
  F.door(28, 3, 32, 3);

  // Plaza depan gedung
  F.rooms.push({ x0: 0, z0: 3, x1: W, z1: 9, name: '', fill: '#dde5d4' });
  F.rooms.push({ x0: 0, z0: 9, x1: W, z1: 11, name: '', fill: '#d8d4cb' });
  for (const x of [3, 9, 15, 21, 38, 44, 50, 56]) F.put('plant', x, 4);
  row(F, 'bench', 5, 6, 2, 6, 0, 3, 1);
  row(F, 'bench', 46, 6, 2, 6, 0, 3, 1);
  row(F, 'motor', 20, 7, 4, 1, 0);
  F.put('cart', 35, 6, 2, 1);
  F.put('cart', 39, 7, 2, 1);
  F.put('reception', 24, 4, 2, 1);
  F.put('plant', 26, 8);
  F.put('plant', 33, 8);
  F.put('lamp', 27, 4);
  F.put('lamp', 32, 4);
  // Pagar sepanjang trotoar: hanya terbuka di dua zebra cross
  for (let x = 0; x < W; x++) if (!ZEBRAS.some((zb) => x >= zb.x0 && x < zb.x1)) F.put('fence', x, 10);
  for (const zb of ZEBRAS) F.reserveRect(zb.x0, 9, zb.x1, 18);
  F.wall(0, 27, W, 27, 'solid'); // pembatas busway: lajur selatan tidak bisa diinjak

  // Halte: lambung memanjang, peron berbayar di tengah, gate tap-in sempit di kedua sisinya
  F.room(HALTE.x0, HALTE.z0, HALTE.x1, HALTE.z1, { doors: [['n', 15, 2], ['n', 43, 2]] });
  F.rooms.push({ x0: 8, z0: 17, x1: 21, z1: 24, name: 'Halte TransJakarta', fill: '#eef3f7' });
  F.rooms.push({ x0: 21, z0: 17, x1: 39, z1: 24, name: 'PERON', fill: '#dbe7f3' });
  F.rooms.push({ x0: 39, z0: 17, x1: 52, z1: 24, name: '', fill: '#eef3f7' });
  for (const gx of [21, 39]) {
    F.wall(gx, 17, gx, 24, 'solid');
    for (const gz of [18, 20, 22]) F.door(gx, gz, gx, gz + 1, { narrow: true });
    for (const gz of [17, 19, 21, 23]) F.put('turnstile', gx === 21 ? 20 : 39, gz);
  }
  // Bus menempel di sisi selatan peron; tiga pintu peron = tiga pintu bus
  F.room(BUS.x0, BUS.z0, BUS.x1, BUS.z1, { kind: 'solid' });
  for (const dx of [24, 29, 34]) F.door(dx, 24, dx + 2, 24, { dyn: BUS_DOOR });
  F.reserveRect(BUS.x0, BUS.z0, BUS.x1, BUS.z1);
  row(F, 'bench', 26, 18, 3, 4, 0, 3, 1);
  F.put('vending', 22, 17);
  F.put('tv', 27, 17, 6, 0.3);
  F.put('plant', 38, 17);
  F.put('topup', 9, 18);
  F.put('topup', 9, 22);
  F.put('counter', 11, 23, 3, 1);
  F.put('bench', 18, 23, 2, 1);
  F.put('topup', 50, 18);
  F.put('topup', 50, 22);
  F.put('counter', 46, 23, 3, 1);
  F.put('bench', 40, 23, 2, 1);
  for (const sx of [10, 47]) F.put('shaft', sx, 20, 3, 1); // kaki tangga ke anjungan

  F.spawns = [[12, 8], [48, 8], [30, 9], [14, 20], [45, 20], [30, 21]];
  return F;
}

/** Indeks = nomor lantai: 0 area luar, 1 lobby, ... 5 ruang kerja. */
export const PLANS: readonly FloorPlan[] = [areaLuar(), lantai1(), lantai2(), lantai3(), lantai4(), lantai5()].map((f) => f.finish());

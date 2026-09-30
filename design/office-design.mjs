// Rancangan denah gedung Tenggo Simulator v2. ARSIP DESAIN: denah yang dipakai game sekarang ada di
// shared/src/building.ts; perubahan di sana tidak otomatis ikut ke gambar ini.
// Jalankan: node design/office-design.mjs  ->  menghasilkan design/index.html
//
// Tiap lantai 60 x 34 tile. Dinding sekarang tipis dan berada di GARIS antar tile (bukan memakan
// satu tile penuh), sehingga ruangan bisa kecil-kecil dan rapat seperti sekat kaca kantor modern.
import { writeFileSync } from 'node:fs';

const W = 60;
const H = 34;
const S = 18; // piksel per tile di gambar

// ---------- Katalog perabot ----------
// solid: menghalangi jalan. Yang tidak solid hanya hiasan (kursi, karpet, sajadah).
const TYPES = {
  desk: { label: 'Meja kerja + komputer', fill: '#c99a5b', solid: true },
  chair: { label: 'Kursi', fill: '#2f3648', solid: false },
  table: { label: 'Meja rapat / makan', fill: '#7a5236', solid: true },
  cabinet: { label: 'Lemari arsip', fill: '#8a93a3', solid: true },
  shelf: { label: 'Rak buku', fill: '#6e4a2c', solid: true },
  locker: { label: 'Loker', fill: '#5f7fa8', solid: true },
  plant: { label: 'Tanaman', fill: '#3f9d57', solid: true },
  sofa: { label: 'Sofa', fill: '#f2b705', solid: true },
  beanbag: { label: 'Bean bag', fill: '#ff8c42', solid: true },
  counter: { label: 'Konter pantry / kasir', fill: '#f3efe6', solid: true },
  coffee: { label: 'Mesin kopi', fill: '#23283a', solid: true },
  vending: { label: 'Mesin jajanan', fill: '#d43c3c', solid: true },
  fridge: { label: 'Kulkas', fill: '#bfe3f5', solid: true },
  dispenser: { label: 'Dispenser air', fill: '#5fb6f0', solid: true },
  printer: { label: 'Printer / fotokopi', fill: '#dfe3ea', solid: true },
  lamp: { label: 'Lampu berdiri', fill: '#ffe2a0', solid: true },
  booth: { label: 'Bilik telepon', fill: '#2ed3c6', solid: true },
  server: { label: 'Rak server', fill: '#15181f', solid: true },
  pingpong: { label: 'Meja pingpong', fill: '#2f8f57', solid: true },
  gym: { label: 'Alat gym', fill: '#555b6b', solid: true },
  bed: { label: 'Nap pod', fill: '#b8a6e8', solid: true },
  sink: { label: 'Wastafel / wudhu', fill: '#ffffff', solid: true },
  toilet: { label: 'Bilik toilet', fill: '#e9e3d6', solid: true },
  reception: { label: 'Meja resepsionis / satpam', fill: '#5a3b26', solid: true },
  turnstile: { label: 'Turnstile', fill: '#9aa3b3', solid: true },
  atm: { label: 'ATM', fill: '#3f7fd1', solid: true },
  shaft: { label: 'Inti gedung (shaft)', fill: '#3a4055', solid: true },
  bench: { label: 'Bangku tunggu', fill: '#8fa3b8', solid: true },
  fence: { label: 'Pagar pembatas jalan', fill: '#6b7280', solid: true },
  cart: { label: 'Gerobak kopi keliling', fill: '#e8590c', solid: true },
  motor: { label: 'Ojol menunggu', fill: '#2f9e44', solid: true },
  topup: { label: 'Mesin isi ulang kartu', fill: '#1c7ed6', solid: true },
  mat: { label: 'Sajadah / karpet', fill: '#c0503f', solid: false },
  tv: { label: 'TV / papan tulis (di dinding)', fill: '#1b2030', solid: false },
};

class Floor {
  constructor(no, title, summary) {
    Object.assign(this, { no, title, summary });
    this.walls = new Map(); // kunci sisi tile -> 'solid' | 'glass'
    this.doors = [];
    this.rooms = [];
    this.solid = new Set();
    this.taken = new Set(); // tile yang sudah ditempati perabot apa pun
    this.reserved = new Set(); // tile yang harus tetap kosong (depan pintu, rute, start)
    this.items = [];
    this.wet = [];
    this.stairs = [];
    this.lifts = [];
    this.starts = [];
    this.spawns = [];
    this.patrols = [];
    this.notes = [];
    this.entries = [];
    this.exits = [];
    this.skipped = 0;
    this.under = []; // gambar bebas di bawah perabot (jalan, zebra cross)
    this.over = []; // gambar bebas di atas perabot (mobil, bus, lampu)
  }

  edges(x0, z0, x1, z1) {
    const out = [];
    if (z0 === z1) for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) out.push(`h,${x},${z0}`);
    else for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z++) out.push(`v,${x0},${z}`);
    return out;
  }

  wall(x0, z0, x1, z1, kind = 'glass') {
    for (const e of this.edges(x0, z0, x1, z1)) if (kind === 'solid' || !this.walls.has(e)) this.walls.set(e, kind);
  }

  /** Pintu = celah di dinding. Tile di kedua sisinya dijaga tetap kosong. */
  door(x0, z0, x1, z1, opt = {}) {
    const edges = this.edges(x0, z0, x1, z1);
    this.doors.push({ x0, z0, x1, z1, edges, ...opt });
    for (const e of edges) {
      const [t, x, z] = e.split(',');
      this.reserve(+x, +z);
      if (t === 'h') this.reserve(+x, +z - 1);
      else this.reserve(+x - 1, +z);
    }
  }

  /** doors: [sisi, posisi, lebar] dengan sisi n/s/e/w; posisi = koordinat tile awal celah. */
  room(x0, z0, x1, z1, { name = '', kind = 'glass', fill = null, doors = [] } = {}) {
    this.wall(x0, z0, x1, z0, kind);
    this.wall(x0, z1, x1, z1, kind);
    this.wall(x0, z0, x0, z1, kind);
    this.wall(x1, z0, x1, z1, kind);
    this.rooms.push({ x0, z0, x1, z1, name, fill });
    for (const [side, at, w = 2] of doors) {
      if (side === 'n') this.door(at, z0, at + w, z0);
      else if (side === 's') this.door(at, z1, at + w, z1);
      else if (side === 'w') this.door(x0, at, x0, at + w);
      else this.door(x1, at, x1, at + w);
    }
  }

  reserve(x, z) {
    this.reserved.add(`${x},${z}`);
  }

  reserveRect(x0, z0, x1, z1) {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.reserve(x, z);
  }

  /** Menaruh perabot. Dilewati (tidak error) bila menimpa perabot lain atau tile yang dijaga kosong. */
  put(type, x, z, w = 1, h = 1, opt = {}) {
    const def = TYPES[type];
    if (!def) throw new Error(`tipe perabot tidak dikenal: ${type}`);
    const cells = [];
    for (let cz = Math.floor(z); cz < Math.ceil(z + h); cz++)
      for (let cx = Math.floor(x); cx < Math.ceil(x + w); cx++) cells.push(`${cx},${cz}`);
    if (x < 0 || z < 0 || x + w > W || z + h > H) return false;
    if (def.solid || opt.strict) {
      if (cells.some((c) => this.taken.has(c) || (def.solid && this.reserved.has(c)))) {
        this.skipped++;
        return false;
      }
      for (const c of cells) {
        this.taken.add(c);
        if (def.solid) this.solid.add(c);
      }
    } else if (cells.some((c) => this.solid.has(c))) return false;
    this.items.push({ type, x, z, w, h, ...opt });
    return true;
  }

  finish() {
    for (const d of this.doors) for (const e of d.edges) this.walls.delete(e);
  }

  canStep(x, z, dx, dz, blocked) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= W || nz >= H || this.solid.has(`${nx},${nz}`)) return false;
    const edge = dx === 1 ? `v,${nx},${z}` : dx === -1 ? `v,${x},${z}` : dz === 1 ? `h,${x},${nz}` : `h,${x},${z}`;
    return !this.walls.has(edge) && !blocked?.has(edge);
  }

  /** Jalur terpendek (dalam langkah tile) dari salah satu sumber ke salah satu tujuan. */
  path(sources, targets, blocked) {
    const key = (x, z) => z * W + x;
    const goal = new Set(targets.map(([x, z]) => key(x, z)));
    const prev = new Map(sources.map(([x, z]) => [key(x, z), -1]));
    const queue = sources.map(([x, z]) => [x, z]);
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      if (goal.has(key(x, z))) {
        const cells = [];
        for (let k = key(x, z); k !== -1; k = prev.get(k)) cells.push([k % W, Math.floor(k / W)]);
        return cells.reverse();
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.canStep(x, z, dx, dz, blocked) || prev.has(key(x + dx, z + dz))) continue;
        prev.set(key(x + dx, z + dz), key(x, z));
        queue.push([x + dx, z + dz]);
      }
    }
    return null;
  }

  /** Pintu-pintu yang dilewati sebuah jalur. */
  doorsOn(cells) {
    const out = [];
    for (let i = 1; i < cells.length; i++) {
      const [x, z] = cells[i - 1];
      const [nx, nz] = cells[i];
      const edge = nx > x ? `v,${nx},${z}` : nx < x ? `v,${x},${z}` : nz > z ? `h,${x},${nz}` : `h,${x},${z}`;
      const d = this.doors.find((door) => door.edges.includes(edge));
      if (d && !out.includes(d)) out.push(d);
    }
    return out;
  }

  /** Rute terpendek plus alternatif yang muncul bila satu pintu di rute itu "dikuasai lawan". */
  routes(sources, targets, max = 3) {
    const best = this.path(sources, targets);
    if (!best) return [];
    const found = [best];
    const alts = [];
    for (const d of this.doorsOn(best)) {
      const alt = this.path(sources, targets, new Set(d.edges));
      if (alt && !alts.some((a) => a.length === alt.length)) alts.push(alt);
    }
    alts.sort((a, b) => a.length - b.length);
    for (const a of alts) if (found.length < max && a.length !== best.length) found.push(a);
    return found;
  }

  unreachable(from) {
    const seen = new Set([from.join(',')]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${z + dz}`;
        if (seen.has(k) || !this.canStep(x, z, dx, dz)) continue;
        seen.add(k);
        queue.push([x + dx, z + dz]);
      }
    }
    const cells = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (!this.solid.has(`${x},${z}`) && !seen.has(`${x},${z}`)) cells.push([x, z]);
    return cells;
  }
}

// ---------- Pembantu penataan perabot ----------

/** Deret meja saling membelakangi, memanjang ke kanan. Kursi di sisi atas dan bawah. */
function benchH(F, x, z, len) {
  for (let i = 0; i + 2 <= len; i += 2) {
    if (F.put('desk', x + i, z, 2, 1)) F.put('chair', x + i + 0.5, z - 1);
    if (F.put('desk', x + i, z + 1, 2, 1)) F.put('chair', x + i + 0.5, z + 2);
  }
}

/** Deret meja memanjang ke bawah. Kursi di kiri dan kanan. */
function benchV(F, x, z, len) {
  for (let i = 0; i + 2 <= len; i += 2) {
    if (F.put('desk', x, z + i, 1, 2)) F.put('chair', x - 1, z + i + 0.5);
    if (F.put('desk', x + 1, z + i, 1, 2)) F.put('chair', x + 2, z + i + 0.5);
  }
}

function meeting(F, x0, z0, x1, z1) {
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

function office(F, x0, z0, x1, z1) {
  if (F.put('desk', x0 + 1, z0 + 1, 2, 1)) F.put('chair', x0 + 1.5, z0 + 2);
  F.put('cabinet', x1 - 1, z0, 1, 2);
  F.put('shelf', x0 + 3, z0, Math.max(1, x1 - x0 - 5), 1);
  F.put('sofa', x0, z1 - 1, 2, 1);
  F.put('plant', x1 - 1, z1 - 1);
  F.put('lamp', x0, z0);
}

function row(F, type, x, z, n, dx, dz, w = 1, h = 1) {
  for (let i = 0; i < n; i++) F.put(type, x + i * dx, z + i * dz, w, h);
}

function cafeTables(F, x0, z0, x1, z1, stepX = 4, stepZ = 4) {
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
const LIFT_A = [25, 13, 29, 17];
const LIFT_B = [31, 13, 35, 17];
const STAIR_W = [0, 14, 5, 20];
const STAIR_E = [55, 14, 60, 20];

/**
 * lift: 'naik' (pemain naik lift di sini), 'tiba' (pemain keluar lift di sini), atau null (lift tidak dipakai).
 * tangga: 'turun' (masuk tangga di sini), 'tiba' (keluar tangga di sini), atau 'tutup'.
 */
function skeleton(F, { lift, tangga, lobbyDoors, liftNote, stairNote }) {
  F.room(0, 0, W, H, { kind: 'solid' });

  // Inti: shaft, dua kabin lift, lobi lift
  for (const [x0, z0, x1, z1] of [[24, 12, 36, 13], [24, 13, 25, 17], [35, 13, 36, 17], [29, 13, 31, 17]])
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) F.put('shaft', x, z);
  for (const [name, [x0, z0, x1, z1]] of [['A', LIFT_A], ['B', LIFT_B]]) {
    F.room(x0, z0, x1, z1, { kind: 'solid' });
    F.reserveRect(x0, z0, x1, z1);
    if (lift) F.door(x0 + 1, z1, x1 - 1, z1, { lift: true });
    F.lifts.push({ name, x0, z0, x1, z1, mode: lift });
  }
  F.room(24, 17, 36, 21, { name: 'Lobi lift', kind: 'solid', fill: '#e6e9f2', doors: lobbyDoors });
  F.reserveRect(25, 17, 35, 20);
  if (liftNote) F.notes.push({ x: 30, z: 12.75, text: liftNote });

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
    F.stairs.push({ x0: x0 + 1, z0: 15, x1: x1 - 1, z1: 19, mode: tangga, note: stairNote });
  }
}

const liftCells = () => [LIFT_A, LIFT_B].flatMap(([x0, z0, x1, z1]) => [[x0 + 1, z1 - 1], [x0 + 2, z1 - 1]]);
const stairTop = () => [[1, 14], [2, 14], [3, 14], [56, 14], [57, 14], [58, 14]];
const stairBottom = (side) => (side === 'W' ? [[2, 19]] : [[57, 19]]);

// =====================================================================================
// LANTAI 5 — RUANG KERJA (start). Turun lewat tangga darurat barat atau timur.
// =====================================================================================
function lantai5() {
  const F = new Floor(5, 'Lantai 5 — Ruang Kerja', 'Semua pemain mulai di sini. Open-plan bersekat kaca; lift hanya untuk direksi, jadi turun lewat tangga darurat di ujung barat atau timur.');
  skeleton(F, { lift: null, tangga: 'turun', lobbyDoors: [['s', 29, 2]], liftNote: 'LIFT KHUSUS DIREKSI', stairNote: 'ke Lt 4' });

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

  F.wet.push({ x: 6, z: 15, w: 4, h: 3, note: 'AC bocor' }, { x: 50, z: 17, w: 4, h: 3, note: 'AC bocor' });
  F.spawns = [[16, 7], [44, 7], [3, 10], [57, 11], [8, 24], [52, 25], [21, 30], [41, 31], [30, 28]];
  F.entries = [
    { name: 'kursi utara', cells: [[30, 8]] },
    { name: 'kursi selatan', cells: [[30, 22]] },
  ];
  F.exits = [{ name: 'tangga', cells: stairTop() }];
  return F;
}

// =====================================================================================
// LANTAI 4 — MEETING & KOLABORASI. Tidak ada tangga turun: hanya 2 lift (zona atas).
// =====================================================================================
function lantai4() {
  const F = new Floor(4, 'Lantai 4 — Meeting & Kolaborasi', 'Labirin ruang rapat kecil bersekat kaca. Tangga ke bawah ditutup, jadi semua berebut DUA LIFT di tengah gedung.');
  skeleton(F, {
    lift: 'naik', tangga: 'tiba',
    lobbyDoors: [['s', 29, 2], ['e', 18, 1]],
    liftNote: 'LIFT ZONA ATAS ▼ Lt 3', stairNote: 'dari Lt 5',
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
    meeting(F, ...r);
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

  F.wet.push({ x: 26, z: 23, w: 8, h: 3, note: 'baru dipel' });
  F.spawns = [[3, 21], [56, 21], [30, 27], [12, 10], [46, 10], [20, 31], [40, 25], [30, 10], [57, 9]];
  F.entries = [
    { name: 'tangga barat', cells: stairBottom('W') },
    { name: 'tangga timur', cells: stairBottom('E') },
  ];
  F.exits = [{ name: 'lift', cells: liftCells() }];
  return F;
}

// =====================================================================================
// LANTAI 3 — HR & DIREKSI (petak umpet). Turun lewat tangga.
// =====================================================================================
function lantai3() {
  const F = new Floor(3, 'Lantai 3 — HR & Direksi (petak umpet)', 'Keluar dari lift langsung masuk wilayah HR. Tiga penjaga berpatroli; yang ketahuan dikembalikan ke lobi lift Lantai 4 dan harus antre lift lagi.');
  skeleton(F, {
    lift: 'tiba', tangga: 'turun',
    lobbyDoors: [['w', 18, 2], ['e', 18, 2]],
    liftNote: 'LIFT ZONA ATAS (tiba)', stairNote: 'ke Lt 2',
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
    { name: 'Direktur', pts: [[22, 9], [37, 9], [37, 10], [22, 10]], mark: [30, 10] },
  ];
  for (const p of F.patrols)
    for (let i = 0; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i];
      const [bx, bz] = p.pts[(i + 1) % p.pts.length];
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) F.reserve(x, z);
    }

  benchH(F, 1, 1, 8);
  benchH(F, 1, 5, 2);
  row(F, 'cabinet', 11, 0, 2, 0, 1);
  F.put('plant', 9, 7);
  row(F, 'shelf', 13, 0, 4, 2, 0, 2, 1);
  row(F, 'cabinet', 13, 3, 4, 2, 0);
  row(F, 'cabinet', 13, 5, 4, 2, 0);
  for (const r of [[7, 10, 13, 15], [13, 10, 18, 15], [38, 0, 48, 8]]) meeting(F, ...r);
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
  F.entries = [
    { name: 'lift → tangga barat', cells: liftCells(), to: stairTop().slice(0, 3) },
    { name: 'lift → tangga timur', cells: liftCells(), to: stairTop().slice(3) },
  ];
  F.exits = [{ name: 'tangga', cells: stairTop() }];
  return F;
}

// =====================================================================================
// LANTAI 2 — SOSIAL: kantin, musholla, game room, gym. Hanya lift (zona bawah).
// =====================================================================================
function lantai2() {
  const F = new Floor(2, 'Lantai 2 — Kantin, Musholla & Game Room', 'Lantai paling licin: petugas kebersihan mengepel kantin, tempat wudhu basah. Tangga ke lobby dikunci, jadi rebutan DUA LIFT lagi.');
  skeleton(F, {
    lift: 'naik', tangga: 'tiba',
    lobbyDoors: [['w', 18, 1], ['e', 18, 2], ['s', 29, 2]],
    liftNote: 'LIFT ZONA BAWAH ▼ Lt 1', stairNote: 'dari Lt 3',
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
  F.patrols = [{ name: 'Petugas kebersihan', janitor: true, pts: [[25, 23], [34, 23], [34, 31], [25, 31]] }];
  for (const p of F.patrols)
    for (let i = 0; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i];
      const [bx, bz] = p.pts[(i + 1) % p.pts.length];
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) F.reserve(x, z);
    }

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
    { x: 12, z: 3, w: 7, h: 5, note: 'wudhu' },
    { x: 13, z: 8, w: 5, h: 2, note: '' },
    { x: 27, z: 25, w: 6, h: 3, note: 'depan lift' },
    { x: 12, z: 22, w: 4, h: 3, note: 'tumpahan kuah' },
  );
  F.spawns = [[3, 21], [56, 21], [30, 30], [30, 10], [10, 21], [45, 10], [22, 23], [57, 23], [18, 10]];
  F.entries = [
    { name: 'tangga barat', cells: stairBottom('W') },
    { name: 'tangga timur', cells: stairBottom('E') },
  ];
  F.exits = [{ name: 'lift', cells: liftCells() }];
  return F;
}

// =====================================================================================
// LANTAI 1 — LOBBY. Turnstile, kedai kopi, gerbang keluar.
// =====================================================================================
function lantai1() {
  const F = new Floor(1, 'Lantai 1 — Lobby Utama', 'Keluar lift, lewati barisan turnstile satu-satu, seberangi lobby yang baru dipel, lalu keluar lewat pintu putar. Ada jalan memutar lewat kedai kopi tanpa turnstile.');
  skeleton(F, {
    lift: 'tiba', tangga: 'tutup',
    lobbyDoors: [['s', 28, 4], ['w', 18, 2]],
    liftNote: 'LIFT ZONA BAWAH (tiba)', stairNote: 'terkunci',
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
  F.door(28, 34, 32, 34, { gate: true });

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

  F.patrols = [{ name: 'Petugas kebersihan', janitor: true, pts: [[16, 30], [44, 30], [44, 28], [16, 28]] }];
  F.wet.push({ x: 26, z: 30, w: 8, h: 3, note: 'depan pintu putar' }, { x: 6, z: 17, w: 5, h: 3, note: '' });
  F.extraRoutes = [{ name: 'lewat kedai kopi, tanpa turnstile', block: (d) => d.narrow }];
  F.spawns = [[30, 22], [10, 17], [50, 18], [22, 29], [40, 29], [7, 25], [53, 30]];
  F.entries = [{ name: 'lift', cells: liftCells() }];
  F.exits = [{ name: 'gerbang', cells: [[28, 33], [29, 33], [30, 33], [31, 33]] }];
  F.gate = { x0: 28, x1: 32, z: 34 };
  return F;
}

// =====================================================================================
// AREA LUAR — plaza, penyeberangan berlampu lalu lintas, Halte TransJakarta. FINIS = naik bus.
// =====================================================================================
function areaLuar() {
  const F = new Floor(0, 'Area Luar — Jalan Raya & Halte TransJakarta', 'Keluar pintu putar, seberangi jalan lewat zebra cross (aman saat lampu hijau, atau nekat menyelip di antara mobil saat merah), tap-in di halte berbentuk kapal (gaya Halte Bundaran HI), lalu masuk bus. FINIS dihitung saat masuk bus.');
  const px = (v) => v * S;
  F.room(0, 0, W, H, { kind: 'solid' });

  // Gedung kantor di utara; pemain muncul dari pintu putar
  F.rooms.push({ x0: 0, z0: 0, x1: W, z1: 3, name: 'Gedung kantor (lobby)', fill: '#c9ccd4' });
  F.wall(0, 3, W, 3, 'solid');
  F.door(28, 3, 32, 3, { gate: true });
  for (let x = 0; x < W; x++) if (x < 28 || x >= 32) for (let z = 0; z < 3; z++) F.put('shaft', x, z);

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
  for (let x = 0; x < W; x++) if (!(x >= 14 && x < 18) && !(x >= 42 && x < 46)) F.put('fence', x, 10);

  // Jalan: tiga lajur mobil (z 11-17), pulau halte (z 17-24), jalur busway (z 24-27), lajur arah sebaliknya
  F.under.push(`<rect x="0" y="${px(11)}" width="${px(W)}" height="${px(6)}" fill="#4a4f5c"/>`);
  F.under.push(`<rect x="0" y="${px(24)}" width="${px(W)}" height="${px(3)}" fill="#a8453a"/>`);
  F.under.push(`<rect x="0" y="${px(27)}" width="${px(W)}" height="${px(7)}" fill="#4a4f5c"/>`);
  for (const z of [13, 15, 29, 31]) F.under.push(`<line x1="0" y1="${px(z)}" x2="${px(W)}" y2="${px(z)}" stroke="#fff" stroke-width="2" stroke-dasharray="14 12" opacity="0.7"/>`);
  F.under.push(`<text x="${px(30)}" y="${px(25.9)}" text-anchor="middle" font-size="13" font-weight="900" fill="#ffffffaa" letter-spacing="6">JALUR BUSWAY</text>`);
  for (const zx of [14, 42]) {
    for (let i = 0; i < 6; i++) F.under.push(`<rect x="${px(zx)}" y="${px(11) + i * S + 3}" width="${px(4)}" height="${S - 8}" fill="#fff"/>`);
    F.reserveRect(zx, 9, zx + 4, 18);
  }
  F.wall(0, 27, W, 27, 'solid'); // pembatas busway: lajur selatan tidak bisa diinjak

  // Halte: lambung kapal memanjang dengan haluan lancip di kedua ujung
  F.under.push(`<polygon points="${px(8)},${px(17)} ${px(52)},${px(17)} ${px(58)},${px(20.5)} ${px(52)},${px(24)} ${px(8)},${px(24)} ${px(2)},${px(20.5)}" fill="#eef3f7" stroke="#2a2f3d" stroke-width="3"/>`);
  F.room(8, 17, 52, 24, { name: '', kind: 'glass', doors: [['n', 15, 2], ['n', 43, 2]] });
  F.rooms.push({ x0: 21, z0: 17, x1: 39, z1: 24, name: 'PERON (area berbayar)', fill: '#dbe7f3' });
  F.rooms.push({ x0: 8, z0: 17, x1: 21, z1: 24, name: 'Halte TransJakarta — sayap barat', fill: null });
  F.rooms.push({ x0: 39, z0: 17, x1: 52, z1: 24, name: 'sayap timur', fill: null });
  // Gate tap-in: tiga celah sempit di tiap sisi peron
  for (const gx of [21, 39]) {
    F.wall(gx, 17, gx, 24, 'solid');
    for (const gz of [18, 20, 22]) F.door(gx, gz, gx, gz + 1, { narrow: true });
    for (const gz of [17, 19, 21, 23]) F.put('turnstile', gx === 21 ? 20 : 39, gz);
  }
  // Bus menempel di sisi selatan peron; tiga pintu peron = tiga pintu bus
  F.room(21, 24, 39, 27, { name: '', kind: 'solid', fill: '#f4f6f8' });
  for (const dx of [24, 29, 34]) F.door(dx, 24, dx + 2, 24, { lift: true });
  F.reserveRect(21, 24, 39, 27);
  // Isi halte
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
  for (const sx of [10, 47]) {
    F.put('shaft', sx, 20, 3, 1);
    F.over.push(`<rect x="${px(sx)}" y="${px(20)}" width="${px(3)}" height="${S}" fill="#ffd21f"/><text x="${px(sx + 1.5)}" y="${px(20) + 12}" text-anchor="middle" font-size="8" font-weight="800">▲ anjungan</text>`);
  }

  // Bus, mobil, lampu lalu lintas
  F.over.push(`<rect x="${px(21) + 2}" y="${px(24) + 3}" width="${px(18) - 4}" height="${px(3) - 6}" rx="8" fill="#f4f6f8" stroke="#1c4f9c" stroke-width="3"/>`);
  F.over.push(`<rect x="${px(21) + 2}" y="${px(26) - 2}" width="${px(18) - 4}" height="9" fill="#1c4f9c"/>`);
  F.over.push(`<text x="${px(30)}" y="${px(25.7)}" text-anchor="middle" font-size="13" font-weight="900" fill="#1c4f9c">BUS TRANSJAKARTA — FINIS</text>`);
  const cars = [[4, 11.3, '#d43c3c'], [22, 13.3, '#f2b705'], [33, 11.3, '#3f7fd1'], [8, 15.3, '#ffffff'], [49, 13.3, '#2f9e44'], [38, 15.3, '#15181f'],
    [5, 27.4, '#ffffff'], [17, 29.4, '#d43c3c'], [29, 31.4, '#15181f'], [41, 27.4, '#f2b705'], [50, 29.4, '#3f7fd1'], [24, 27.4, '#9aa3b3']];
  for (const [cx, cz, color] of cars)
    F.over.push(`<rect x="${px(cx)}" y="${px(cz)}" width="${px(2.6)}" height="${px(1.4)}" rx="5" fill="${color}" stroke="#0006"/><rect x="${px(cx + 0.6)}" y="${px(cz) + 3}" width="${px(1.3)}" height="${px(1.4) - 6}" rx="2" fill="#0005"/>`);
  for (const [lx, green] of [[13, true], [47, false]]) {
    F.over.push(`<rect x="${px(lx) + 2}" y="${px(9) - 2}" width="14" height="30" rx="3" fill="#15181f"/><circle cx="${px(lx) + 9}" cy="${px(9) + 6}" r="5" fill="${green ? '#3a1414' : '#ff3b3b'}"/><circle cx="${px(lx) + 9}" cy="${px(9) + 20}" r="5" fill="${green ? '#40e070' : '#143a1c'}"/>`);
  }
  F.notes.push({ x: 16, z: 10.2, text: '' });
  F.over.push(`<text x="${px(16)}" y="${px(8.8)}" text-anchor="middle" font-size="10" font-weight="900" fill="#16a34a">ZEBRA A · hijau</text>`);
  F.over.push(`<text x="${px(44)}" y="${px(8.8)}" text-anchor="middle" font-size="10" font-weight="900" fill="#e03131">ZEBRA B · merah</text>`);
  F.over.push(`<circle cx="${px(30)}" cy="${px(4.5)}" r="9" fill="none" stroke="#e03131" stroke-width="2.5" stroke-dasharray="4 3"/><text x="${px(30)}" y="${px(6.1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#e03131">tertabrak → kembali ke sini</text>`);

  F.spawns = [[12, 8], [48, 8], [30, 9], [14, 20], [45, 20], [30, 21]];
  F.entries = [{ name: 'pintu putar', cells: [[29, 3], [30, 3]] }];
  F.exits = [{ name: 'bus', cells: [[24, 24], [25, 24], [29, 24], [30, 24], [34, 24], [35, 24]] }];
  return F;
}

// =====================================================================================
// Render ke SVG
// =====================================================================================
const ROUTE_COLORS = ['#16a34a', '#f97316', '#9333ea'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function drawItem(it) {
  const def = TYPES[it.type];
  const x = it.x * S;
  const y = it.z * S;
  const w = it.w * S;
  const h = it.h * S;
  const round = ['plant', 'beanbag', 'lamp', 'chair', 'dispenser'].includes(it.type);
  if (it.type === 'chair') return `<circle cx="${x + S / 2}" cy="${y + S / 2}" r="${S * 0.27}" fill="${def.fill}"/>`;
  if (it.type === 'mat') return `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="2" fill="${def.fill}" opacity="0.55"/>`;
  if (it.type === 'tv') return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(3, h)}" fill="${def.fill}"/>`;
  let out = round
    ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 - 2}" ry="${h / 2 - 2}" fill="${def.fill}" stroke="#0003"/>`
    : `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="2.5" fill="${def.fill}" stroke="#0004"/>`;
  // Detail kecil supaya tiap perabot bisa dikenali
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (it.type === 'desk') out += `<rect x="${cx - 4}" y="${cy - 2.5}" width="8" height="5" rx="1" fill="#23283a"/>`;
  if (it.type === 'shelf') for (let i = 3; i < w - 3; i += 4) out += `<rect x="${x + i}" y="${y + 3}" width="2.5" height="${h - 6}" fill="${['#c0392b', '#2e86c1', '#f39c12', '#ecf0f1'][(i / 4) % 4 | 0]}"/>`;
  if (it.type === 'server') out += `<circle cx="${cx}" cy="${y + 4}" r="1.5" fill="#4cd37b"/>`;
  if (it.type === 'pingpong') out += `<line x1="${cx}" y1="${y + 2}" x2="${cx}" y2="${y + h - 2}" stroke="#fff" stroke-width="1.5"/>`;
  if (it.type === 'coffee') out += `<circle cx="${cx}" cy="${cy}" r="3" fill="#c98b4b"/>`;
  if (it.type === 'vending') out += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" fill="#cfefff"/>`;
  if (it.type === 'atm') out += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="4" fill="#cfefff"/>`;
  if (it.type === 'sofa') out += `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="2" fill="#ffd95a"/>`;
  if (it.type === 'fence') out = `<rect x="${x}" y="${cy - 2}" width="${w}" height="4" fill="${def.fill}"/><rect x="${cx - 1.5}" y="${cy - 6}" width="3" height="12" fill="${def.fill}"/>`;
  if (it.type === 'motor') out += `<circle cx="${cx}" cy="${cy}" r="3" fill="#15181f"/>`;
  if (it.type === 'topup') out += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="5" fill="#cfefff"/>`;
  if (it.type === 'turnstile') out += `<line x1="${x + 3}" y1="${cy}" x2="${x + w - 3}" y2="${cy}" stroke="#23283a" stroke-width="2"/>`;
  if (it.type === 'shaft') out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${def.fill}"/>`;
  return out;
}

function polyline(cells, color, offset) {
  const pts = cells.map(([x, z]) => `${(x + 0.5) * S + offset},${(z + 0.5) * S + offset}`).join(' ');
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
}

function renderFloor(F) {
  F.finish();
  const PAD = 14;
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W * S}" height="${H * S}" fill="#f6f4ee"/>`);
  for (const r of F.rooms) if (r.fill) parts.push(`<rect x="${r.x0 * S}" y="${r.z0 * S}" width="${(r.x1 - r.x0) * S}" height="${(r.z1 - r.z0) * S}" fill="${r.fill}"/>`);
  // Kisi tipis
  for (let x = 1; x < W; x++) parts.push(`<line x1="${x * S}" y1="0" x2="${x * S}" y2="${H * S}" stroke="#0000000b"/>`);
  for (let z = 1; z < H; z++) parts.push(`<line x1="0" y1="${z * S}" x2="${W * S}" y2="${z * S}" stroke="#0000000b"/>`);

  for (const w of F.wet) {
    parts.push(`<rect x="${w.x * S}" y="${w.z * S}" width="${w.w * S}" height="${w.h * S}" rx="${S}" fill="#5bb8f5" opacity="0.5" stroke="#2f8fd6" stroke-dasharray="4 3"/>`);
  }
  parts.push(...F.under);
  for (const it of F.items) parts.push(drawItem(it));
  parts.push(...F.over);

  // Tangga
  for (const s of F.stairs) {
    const x = s.x0 * S;
    const y = s.z0 * S;
    const w = (s.x1 - s.x0) * S;
    const h = (s.z1 - s.z0) * S;
    const closed = s.mode === 'tutup';
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${closed ? '#c9ccd4' : '#ffd21f'}"/>`);
    for (let i = 1; i < 8; i++) parts.push(`<line x1="${x}" y1="${y + (h * i) / 8}" x2="${x + w}" y2="${y + (h * i) / 8}" stroke="#0005"/>`);
    parts.push(`<text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="15" font-weight="900" fill="#1b2030">${closed ? '✕' : '▼'}</text>`);
    const label = closed ? 'TANGGA DIKUNCI' : s.mode === 'turun' ? `TANGGA ▼ ${s.note}` : `TIBA ${s.note}`;
    const labelY = s.mode === 'tiba' ? (s.z0 - 1) * S - 5 : (s.z1 + 1) * S + 13;
    parts.push(`<text x="${x + w / 2}" y="${labelY}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#1b2030" stroke="#ffffffcc" stroke-width="3" paint-order="stroke">${esc(label)}</text>`);
  }
  // Lift
  for (const l of F.lifts) {
    const x = l.x0 * S;
    const y = l.z0 * S;
    const w = (l.x1 - l.x0) * S;
    const h = (l.z1 - l.z0) * S;
    const on = !!l.mode;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${on ? '#ffb347' : '#c9ccd4'}"/>`);
    parts.push(`<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="#0004"/><line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="#0004"/>`);
    parts.push(`<text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="13" font-weight="900" fill="#1b2030">LIFT ${l.name}</text>`);
  }

  // Dinding
  for (const [key, kind] of F.walls) {
    const [t, xs, zs] = key.split(',');
    const x = +xs * S;
    const y = +zs * S;
    const [x2, y2] = t === 'h' ? [x + S, y] : [x, y + S];
    parts.push(
      kind === 'solid'
        ? `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="#2a2f3d" stroke-width="4" stroke-linecap="square"/>`
        : `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="#3f9bd8" stroke-width="2.5" stroke-linecap="square"/>`,
    );
  }
  // Pintu: garis putus-putus; pintu sempit oranye, pintu lift/gerbang diberi warna sendiri
  for (const d of F.doors) {
    const color = d.gate ? '#16a34a' : d.lift ? '#d9480f' : d.narrow ? '#f59f00' : '#9aa3b3';
    parts.push(`<line x1="${d.x0 * S}" y1="${d.z0 * S}" x2="${d.x1 * S}" y2="${d.z1 * S}" stroke="${color}" stroke-width="${d.gate || d.lift ? 5 : 3}" stroke-dasharray="${d.gate || d.lift ? '' : '3 3'}"/>`);
  }
  if (F.gate && F.no === 1) parts.push(`<text x="${((F.gate.x0 + F.gate.x1) / 2) * S}" y="${H * S + 13}" text-anchor="middle" font-size="12" font-weight="900" fill="#16a34a">PINTU PUTAR ▼ ke jalan raya</text>`);

  // Rute: terpendek dan alternatif dari tiap titik masuk
  const captions = [];
  F.entries.forEach((entry, ei) => {
    const routes = F.routes(entry.cells, entry.to ?? F.exits.flatMap((e) => e.cells), entry.to ? 2 : 3);
    if (!routes.length) captions.push(`<b>${entry.name}</b>: TIDAK ADA RUTE!`);
    routes.forEach((cells, i) => parts.push(polyline(cells, ROUTE_COLORS[i], (i - 1) * 3 + ei)));
    if (routes.length)
      captions.push(
        `dari <b>${entry.name}</b>: ` +
          routes.map((c, i) => `<span style="color:${ROUTE_COLORS[i]}">■</span> ${i === 0 ? 'terpendek' : 'alternatif'} ${c.length - 1} langkah`).join(' · '),
      );
  });

  for (const extra of F.extraRoutes ?? []) {
    const blocked = new Set(F.doors.filter(extra.block).flatMap((d) => d.edges));
    const cells = F.path(F.entries[0].cells, F.exits.flatMap((e) => e.cells), blocked);
    if (!cells) continue;
    parts.push(polyline(cells, ROUTE_COLORS[2], 3));
    captions.push(`<span style="color:${ROUTE_COLORS[2]}">■</span> ${extra.name}: ${cells.length - 1} langkah`);
  }

  // Patroli
  for (const p of F.patrols) {
    const pts = p.pts.map(([x, z]) => `${(x + 0.5) * S},${(z + 0.5) * S}`).join(' ');
    const color = p.janitor ? '#1c7ed6' : '#e03131';
    parts.push(`<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="7 5"/>`);
    const [x, z] = p.mark ?? p.pts[0];
    if (!p.janitor) parts.push(`<path d="M ${(x + 0.5) * S} ${(z + 0.5) * S} l -70 -22 a 74 74 0 0 0 0 44 z" fill="#e03131" opacity="0.22"/>`);
    parts.push(`<circle cx="${(x + 0.5) * S}" cy="${(z + 0.5) * S}" r="7" fill="${color}" stroke="#fff" stroke-width="2"/>`);
    parts.push(`<text x="${(x + 0.5) * S}" y="${(z + 0.5) * S - 11}" text-anchor="middle" font-size="10" font-weight="900" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(p.name)}</text>`);
  }
  for (const [x, z] of F.spawns) parts.push(`<text x="${(x + 0.5) * S}" y="${(z + 0.5) * S + 5}" text-anchor="middle" font-size="14" fill="#e8a500" stroke="#7a5200" stroke-width="0.6">★</text>`);
  for (const [x, z] of F.starts)
    parts.push(`<circle cx="${(x + 0.5) * S}" cy="${(z + 0.5) * S}" r="7.5" fill="#ff5a5f" stroke="#fff" stroke-width="2"/><text x="${(x + 0.5) * S}" y="${(z + 0.5) * S + 3.5}" text-anchor="middle" font-size="9" font-weight="900" fill="#fff">S</text>`);

  // Nama ruangan
  for (const r of F.rooms) {
    if (!r.name) continue;
    parts.push(`<text x="${((r.x0 + r.x1) / 2) * S}" y="${r.z0 * S + 12}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#1b2030" stroke="#ffffffcc" stroke-width="3" paint-order="stroke">${esc(r.name)}</text>`);
  }
  for (const n of F.notes) parts.push(`<text x="${n.x * S}" y="${n.z * S}" text-anchor="middle" font-size="8.5" font-weight="900" fill="#ffd21f">${esc(n.text)}</text>`);
  for (const w of F.wet) if (w.note) parts.push(`<text x="${(w.x + w.w / 2) * S}" y="${(w.z + w.h / 2) * S + 3}" text-anchor="middle" font-size="9" font-weight="800" fill="#0b4f8a">${esc(w.note)}</text>`);

  // DEBUG=1 menandai tile yang tidak bisa dicapai dari titik masuk
  const unreachable = F.unreachable(F.entries[0].cells[0]);
  if (process.env.DEBUG) for (const [x, z] of unreachable) parts.push(`<rect x="${x * S}" y="${z * S}" width="${S}" height="${S}" fill="#ff0000" opacity="0.45"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${W * S + PAD * 2} ${H * S + PAD * 2 + 10}" font-family="system-ui, sans-serif">${parts.join('')}</svg>`;

  const doors = F.doors.filter((d) => !d.lift && !d.gate);
  const stats = {
    rooms: F.rooms.filter((r) => r.name).length,
    doors: doors.length,
    narrow: doors.filter((d) => d.narrow || d.edges.length === 1).length,
    furniture: F.items.filter((i) => i.type !== 'shaft').length,
    unreachable: unreachable.length,
    skipped: F.skipped,
  };
  return { svg, captions, stats };
}

// ---------- Potongan gedung ----------
function section() {
  const rows = [
    ['5', 'Ruang Kerja', 'START · sekat kaca zig-zag', 'tangga'],
    ['4', 'Meeting & Kolaborasi', 'labirin ruang rapat', 'lift'],
    ['3', 'HR & Direksi', 'petak umpet · 3 penjaga', 'tangga'],
    ['2', 'Kantin, Musholla, Game Room', 'lantai licin · petugas kebersihan', 'lift'],
    ['1', 'Lobby Utama', 'turnstile · pintu putar', 'door'],
    ['0', 'Jalan Raya & Halte TransJakarta', 'lampu merah · tap-in · naik bus', 'gate'],
  ];
  const RW = 760;
  const RH = 64;
  let out = '';
  rows.forEach(([no, name, note, exit], i) => {
    const y = i * RH;
    out += `<rect x="60" y="${y}" width="${RW}" height="${RH - 8}" rx="6" fill="#fffaf2" stroke="#2a2f3d" stroke-width="2"/>`;
    out += `<text x="30" y="${y + 36}" text-anchor="middle" font-size="26" font-weight="900" fill="#ff7a1a">${no}</text>`;
    out += `<text x="${60 + RW / 2}" y="${y + 24}" text-anchor="middle" font-size="15" font-weight="900" fill="#1b2030">${esc(name)}</text>`;
    out += `<text x="${60 + RW / 2}" y="${y + 43}" text-anchor="middle" font-size="12" fill="#6f7687">${esc(note)}</text>`;
    // Tangga di kedua ujung, lift di tengah
    const stairOn = exit === 'tangga';
    const liftOn = exit === 'lift';
    for (const sx of [70, 60 + RW - 70]) {
      out += `<rect x="${sx}" y="${y + 8}" width="60" height="${RH - 24}" rx="4" fill="${stairOn ? '#ffd21f' : '#e1e3e8'}" stroke="#0003"/>`;
      out += `<text x="${sx + 30}" y="${y + 33}" text-anchor="middle" font-size="11" font-weight="800" fill="${stairOn ? '#1b2030' : '#9aa3b3'}">${stairOn ? 'TANGGA ▼' : no === '0' ? 'zebra cross' : exit === 'door' ? 'terkunci' : 'ditutup'}</text>`;
    }
    for (const lx of [60 + RW / 2 - 190, 60 + RW / 2 + 130]) {
      out += `<rect x="${lx}" y="${y + 8}" width="60" height="${RH - 24}" rx="4" fill="${liftOn ? '#ffb347' : '#e1e3e8'}" stroke="#0003"/>`;
      out += `<text x="${lx + 30}" y="${y + 33}" text-anchor="middle" font-size="11" font-weight="800" fill="${liftOn ? '#1b2030' : '#9aa3b3'}">${liftOn ? 'LIFT ▼' : no === '0' ? 'tap-in' : 'lift'}</text>`;
    }
    if (exit === 'gate') out += `<text x="${60 + RW / 2}" y="${y + RH + 8}" text-anchor="middle" font-size="14" font-weight="900" fill="#16a34a">▼ NAIK BUS = FINIS</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${RW + 80} ${rows.length * RH + 20}" font-family="system-ui, sans-serif">${out}</svg>`;
}

// ---------- Halaman ----------
const floors = [lantai5(), lantai4(), lantai3(), lantai2(), lantai1(), areaLuar()];
const rendered = floors.map((F) => ({ F, ...renderFloor(F) }));

const legend = Object.entries(TYPES)
  .map(([type, def]) => `<span class="lg"><svg width="20" height="20" viewBox="0 0 ${S} ${S}">${drawItem({ type, x: 0, z: 0, w: 1, h: type === 'tv' ? 0.3 : 1 })}</svg>${def.label}</span>`)
  .join('');

const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rancangan Gedung Tenggo v2</title>
<style>
  body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; background: #1b2030; color: #1b2030; }
  main { max-width: 1180px; margin: 0 auto; display: grid; gap: 20px; }
  section { background: #fffaf2; border-radius: 16px; padding: 20px 22px; }
  h1 { margin: 0 0 6px; font-size: 30px; color: #ff7a1a; }
  h2 { margin: 0 0 4px; font-size: 21px; }
  p { margin: 6px 0; line-height: 1.5; }
  .sub { color: #6f7687; }
  .cap { font-size: 14px; margin-top: 8px; }
  .stats { font-size: 13px; color: #6f7687; }
  .lg { display: inline-flex; align-items: center; gap: 5px; margin: 0 12px 6px 0; font-size: 13px; }
  .keys span { display: inline-flex; align-items: center; gap: 6px; margin: 0 14px 6px 0; font-size: 13px; }
  .sw { display: inline-block; width: 26px; height: 0; border-top: 4px solid; }
  ol, ul { margin: 6px 0; padding-left: 22px; line-height: 1.55; }
  svg { width: 100%; height: auto; display: block; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 800px) { .two { grid-template-columns: 1fr; } }
</style></head><body><main>
<section>
  <h1>Rancangan Gedung Tenggo v2</h1>
  <p class="sub">Draf denah untuk ditinjau sebelum dibangun jadi 3D. Gaya menara perkantoran SCBD: inti gedung di tengah (lift dan toilet), tangga darurat di ujung, ruang kerja open-plan bersekat kaca.</p>
  ${section()}
  <p class="cap">Tiap lantai 60 × 34 tile — luasnya sekitar 4× lantai yang sekarang (30 × 18). Urutan turun berselang-seling: <b>tangga → lift → tangga → lift → pintu putar → seberang jalan → bus</b>.</p>
</section>
<section class="two">
  <div>
    <h2>Rebutan lift</h2>
    <ol>
      <li>Hanya ada <b>2 lift</b> (A dan B). Tiap kabin muat <b>4 pemain</b>.</li>
      <li>Kabin menunggu dengan pintu terbuka. Siapa pun di dalam bisa menekan <b>TUTUP PINTU</b> supaya langsung berangkat; kalau tidak, pintu menutup sendiri 4 detik setelah orang pertama masuk.</li>
      <li>Pintu menutup ±0,7 detik, kabin turun ±3 detik, pintu terbuka di lantai bawah.</li>
      <li>Kabin baru naik lagi setelah semua penumpang keluar (atau paling lama 3 detik), lalu butuh ±3 detik untuk kembali. Yang terlambat <b>menunggu ±8–10 detik</b>, atau pindah ke lift satunya.</li>
      <li>Layar di atas pintu menunjukkan posisi kabin dan hitung mundur.</li>
      <li>Dorong dan lempar tetap berlaku: lawan bisa didorong keluar sebelum pintu menutup.</li>
    </ol>
  </div>
  <div>
    <h2>Perubahan dari versi sekarang</h2>
    <ul>
      <li><b>Dinding tipis.</b> Sekat berada di garis antar tile, bukan memakan satu tile penuh, jadi ruangan bisa kecil dan rapat.</li>
      <li><b>Banyak pintu, beda jarak.</b> Garis hijau = rute terpendek; oranye dan ungu = rute pengganti kalau pintu di rute terpendek dikuasai lawan. Pintu oranye hanya muat satu orang.</li>
      <li><b>5 lantai</b> (sekarang 3). Dua di antaranya hanya bisa ditinggalkan lewat lift.</li>
      <li><b>3 penjaga</b> di lantai HR (sekarang 2); yang ketahuan kembali ke Lantai 4 dan harus naik lift lagi.</li>
      <li>Perkiraan satu ronde: <b>1,5–2,5 menit</b> (sekarang ±30 detik).</li>
    </ul>
  </div>
</section>
<section class="two">
  <div>
    <h2>Menyeberang jalan</h2>
    <ol>
      <li>Trotoar dipagari; jalan hanya bisa diseberangi di <b>dua zebra cross</b> (A dan B).</li>
      <li>Tiap zebra punya lampu sendiri dan <b>bergantian</b>: saat A hijau untuk pejalan kaki, B merah. Satu putaran: ±5 detik hijau, ±7 detik merah.</li>
      <li>Saat lampu pejalan kaki merah, mobil melaju di tiga lajur dengan <b>jarak antar mobil yang cukup longgar</b>. Menerobos tetap boleh: pemain yang jago bisa menyelip di celahnya.</li>
      <li><b>Tertabrak = kembali ke depan pintu putar.</b> Hukumannya hanya kalau kena mobil, bukan karena melanggar lampu.</li>
      <li>Lampu berkedip 1,5 detik sebelum berganti, jadi yang sudah di tengah jalan masih sempat lari.</li>
      <li>Dorong tetap berlaku: lawan bisa didorong ke jalan saat lampu merah.</li>
    </ol>
  </div>
  <div>
    <h2>Halte & bus</h2>
    <ol>
      <li>Halte berbentuk kapal dua lantai seperti Halte Bundaran HI: peron di bawah, anjungan pandang di atas (hiasan).</li>
      <li>Masuk peron lewat <b>gate tap-in</b> sempit, satu orang per gate, tiga gate di tiap sisi.</li>
      <li>Bus berhenti ±6 detik dengan tiga pintu terbuka, lalu berangkat. Bus berikutnya datang ±10 detik kemudian.</li>
      <li><b>Finis = masuk ke dalam bus.</b> Peringkat mengikuti urutan masuk; yang ketinggalan menunggu bus berikutnya.</li>
    </ol>
  </div>
</section>
<section>
  <h2>Legenda</h2>
  <p class="keys">
    <span><i class="sw" style="border-color:#2a2f3d"></i>dinding masif</span>
    <span><i class="sw" style="border-color:#3f9bd8;border-top-width:3px"></i>sekat kaca</span>
    <span><i class="sw" style="border-color:#9aa3b3;border-top-style:dashed"></i>pintu</span>
    <span><i class="sw" style="border-color:#f59f00;border-top-style:dashed"></i>pintu sempit (1 orang)</span>
    <span><i class="sw" style="border-color:#d9480f"></i>pintu lift / pintu bus</span>
    <span><b style="color:#ff5a5f">●S</b> kursi start</span>
    <span><b style="color:#e8a500">★</b> titik item</span>
    <span><b style="color:#2f8fd6">▢</b> lantai basah</span>
    <span><b style="color:#e03131">- -</b> patroli penjaga</span>
    <span><b style="color:#1c7ed6">- -</b> rute petugas kebersihan</span>
  </p>
  <p>${legend}</p>
</section>
${rendered
  .map(
    ({ F, svg, captions, stats }) => `<section>
  <h2>${esc(F.title)}</h2>
  <p class="sub">${esc(F.summary)}</p>
  ${svg}
  <p class="cap">${captions.join('<br>')}</p>
  <p class="stats">${stats.rooms} ruangan · ${stats.doors} pintu (${stats.narrow} sempit) · ${stats.furniture} perabot</p>
</section>`,
  )
  .join('\n')}
</main></body></html>`;

writeFileSync(new URL('./index.html', import.meta.url), html);
// Tiap denah juga disimpan sebagai gambar SVG tersendiri.
for (const { F, svg } of rendered) writeFileSync(new URL(`./lantai-${F.no}.svg`, import.meta.url), svg);
writeFileSync(new URL('./potongan-gedung.svg', import.meta.url), section());
for (const { F, stats, captions } of rendered) {
  console.log(`Lt ${F.no}: ${JSON.stringify(stats)}`);
  for (const c of captions) console.log('   ' + c.replace(/<[^>]+>/g, ''));
}

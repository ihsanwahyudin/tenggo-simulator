// Denah kantor tiga lantai. Satu karakter = satu tile 1x1; x ke kanan, z ke bawah.
// Semua lantai memakai koordinat x/z yang sama dan ditumpuk ke atas.
//   # dinding      . lantai        S kursi (titik start)   D meja kerja
//   C lemari       P tanaman       T meja pantry           R meja resepsionis/meeting
//   K rak buku     M mesin kopi/jajanan  A dispenser air   O sofa
//   F printer      L lampu berdiri
//   W lantai basah I titik item    G gerbang keluar
//   > < v ^  tangga, panah menunjuk arah turun. Tangga digambar di lantai atas DAN lantai
//            bawahnya pada tile yang sama: lantai atas membuka ujung atasnya, lantai bawah
//            membuka ujung bawahnya.

// Lantai 1: lobby dan gerbang keluar
const LOBBY = [
  '##############################',
  '#OO..L.......KK......M..OO..L#',
  '#....TT..........P.......I...#',
  '#....TT......................#',
  '#............................#',
  '#.I.........RRRR.............#',
  '#............................#',
  '#......P..............TT.....#',
  '#.....................TT.....#',
  '#OO..........................#',
  '#............................#',
  '#........####..########WW#####',
  '#........#.................OO#',
  '#........#......P............#',
  '#..######....................#',
  '#..<<<<<#..............WWWW..#',
  '#..<<<<<#....I.........WWWW..#',
  '#######################GGGG###',
];

// Lantai 2: pantry (kiri atas), ruang meeting (kanan atas), lorong
const MIDDLE = [
  '##############################',
  '#MMA..........KK..#.K......L.#',
  '#..TT....TT.......#...CCC....#',
  '#..TT....TT.......#..........#',
  '#.................#....RR....#',
  '#....I.................RR....#',
  '#............................#',
  '#..TT....TT.......#......I...#',
  '#..TT....TT.....P.#P.........#',
  '#####..################..#####',
  '#F.............#............O#',
  '#....P.........#......P......#',
  '#............WWWWW...........#',
  '#............WWWWW...........#',
  '#########..###############...#',
  '###<<<<<.....########>>>>>...#',
  '###<<<<<.....########>>>>>...#',
  '##############################',
];

// Lantai 3: ruang kerja, tempat semua pemain mulai
const WORKROOM = [
  '##############################',
  '#KK..........F.........KKK..L#',
  '#..S...S...S...S......C......#',
  '#..DD..DD..DD..DD.....C...P..#',
  '#.....................C......#',
  '#.I.......................I..#',
  '#..S...S...S...S.............#',
  '#..DD..DD..DD..DD....WWW.....#',
  '#....................WWW.....#',
  '#.......................TT..O#',
  '#..PCCCC...CCCCCC.......TT..O#',
  '#L...........................#',
  '#.......I....................#',
  '#....................P....MA.#',
  '#....................#########',
  '#....................>>>>>####',
  '#KKK..F..............>>>>>####',
  '##############################',
];

export const FLOORS: readonly (readonly string[])[] = [LOBBY, MIDDLE, WORKROOM];
export const FLOOR_COUNT = FLOORS.length;
export const TOP_FLOOR = FLOOR_COUNT - 1;
export const FLOOR_HEIGHT = 2.4;
export const MAP_W = LOBBY[0].length;
export const MAP_H = LOBBY.length;
const FLOOR_TILES = MAP_W * MAP_H;

export interface Point {
  x: number;
  z: number;
}

export interface FloorPoint extends Point {
  f: number;
}

export function tileAt(f: number, tx: number, tz: number): string {
  if (f < 0 || f >= FLOOR_COUNT || tz < 0 || tz >= MAP_H || tx < 0 || tx >= MAP_W) return '#';
  return FLOORS[f][tz][tx];
}

const SOLID = '#DCPTRKMAOFL';
const STAIR_CHARS = '><v^';
export const isSolid = (f: number, tx: number, tz: number) => SOLID.includes(tileAt(f, tx, tz));
export const isWall = (f: number, tx: number, tz: number) => tileAt(f, tx, tz) === '#';
export const isStaticWet = (f: number, tx: number, tz: number) => tileAt(f, tx, tz) === 'W';
export const isGate = (f: number, tx: number, tz: number) => tileAt(f, tx, tz) === 'G';
export const isStairTile = (f: number, tx: number, tz: number) => STAIR_CHARS.includes(tileAt(f, tx, tz));

/** Kunci unik tile di seluruh gedung. */
export const tileKey = (f: number, tx: number, tz: number) => f * FLOOR_TILES + tz * MAP_W + tx;
export const keyFloor = (key: number) => Math.floor(key / FLOOR_TILES);
/** Kunci tile di dalam lantainya sendiri (tz * MAP_W + tx). */
export const keyLocal = (key: number) => key % FLOOR_TILES;

function pointsOf(ch: string): FloorPoint[] {
  const out: FloorPoint[] = [];
  FLOORS.forEach((rows, f) =>
    rows.forEach((row, tz) => [...row].forEach((c, tx) => c === ch && out.push({ f, x: tx + 0.5, z: tz + 0.5 }))),
  );
  return out;
}

export const SEATS = pointsOf('S');
export const ITEM_SPAWNS = pointsOf('I');

// Petugas kebersihan berkeliling di lobby, di depan sekat menuju gerbang.
export const JANITOR_FLOOR = 0;
export const JANITOR_ROUTE: readonly Point[] = [
  { x: 3.5, z: 10.5 },
  { x: 27.5, z: 10.5 },
  { x: 27.5, z: 9.5 },
  { x: 3.5, z: 9.5 },
];

// ---------- Tangga ----------

export interface Stair {
  upper: number; // lantai di ujung atas; ujung bawah ada di lantai upper - 1
  dir: string; // arah turun: > < v ^
  minX: number;
  maxX: number; // eksklusif
  minZ: number;
  maxZ: number; // eksklusif
}

export const STAIRS: Stair[] = [];
const stairByKey = new Map<number, Stair>();

for (let f = 1; f < FLOOR_COUNT; f++) {
  for (let tz = 0; tz < MAP_H; tz++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const dir = tileAt(f, tx, tz);
      // Tangga turun dari lantai f adalah yang juga tergambar di lantai f - 1.
      if (!STAIR_CHARS.includes(dir) || tileAt(f - 1, tx, tz) !== dir || stairByKey.has(tileKey(f, tx, tz))) continue;
      let maxX = tx;
      while (tileAt(f, maxX, tz) === dir) maxX++;
      let maxZ = tz;
      while (tileAt(f, tx, maxZ) === dir) maxZ++;
      const stair: Stair = { upper: f, dir, minX: tx, maxX, minZ: tz, maxZ };
      STAIRS.push(stair);
      for (let z = tz; z < maxZ; z++)
        for (let x = tx; x < maxX; x++) {
          stairByKey.set(tileKey(f, x, z), stair);
          stairByKey.set(tileKey(f - 1, x, z), stair);
        }
    }
  }
}

export function stairAt(f: number, x: number, z: number): Stair | undefined {
  return stairByKey.get(tileKey(f, Math.floor(x), Math.floor(z)));
}

/** Seberapa jauh sudah turun: 0 di ujung atas, 1 di ujung bawah. */
export function stairProgress(s: Stair, x: number, z: number): number {
  const p =
    s.dir === '>' ? (x - s.minX) / (s.maxX - s.minX)
    : s.dir === '<' ? (s.maxX - x) / (s.maxX - s.minX)
    : s.dir === 'v' ? (z - s.minZ) / (s.maxZ - s.minZ)
    : (s.maxZ - z) / (s.maxZ - s.minZ);
  return Math.max(0, Math.min(1, p));
}

/** Lantai tempat sesuatu berada setelah bergerak: di tangga, pindah lantai terjadi di tengah tangga. */
export function floorAt(f: number, x: number, z: number): number {
  const s = stairAt(f, x, z);
  if (!s) return f;
  return stairProgress(s, x, z) >= 0.5 ? s.upper - 1 : s.upper;
}

/** Ketinggian lantai di suatu titik, termasuk kemiringan tangga. */
export function heightAt(f: number, x: number, z: number): number {
  const s = stairAt(f, x, z);
  return (s ? s.upper - stairProgress(s, x, z) : f) * FLOOR_HEIGHT;
}

// ---------- Jarak ke gerbang ----------

// Jarak jalan kaki (dalam tile) dari tiap tile ke gerbang, menembus tangga. Untuk posisi balapan.
const GATE_DIST: number[] = (() => {
  const dist = new Array<number>(FLOOR_TILES * FLOOR_COUNT).fill(Infinity);
  const queue: number[] = [];
  for (let f = 0; f < FLOOR_COUNT; f++)
    for (let tz = 0; tz < MAP_H; tz++)
      for (let tx = 0; tx < MAP_W; tx++)
        if (isGate(f, tx, tz)) {
          dist[tileKey(f, tx, tz)] = 0;
          queue.push(f, tx, tz);
        }
  for (let i = 0; i < queue.length; i += 3) {
    const f = queue[i];
    const tx = queue[i + 1];
    const tz = queue[i + 2];
    const d = dist[tileKey(f, tx, tz)] + 1;
    const next = [[f, tx + 1, tz], [f, tx - 1, tz], [f, tx, tz + 1], [f, tx, tz - 1]];
    const stair = stairByKey.get(tileKey(f, tx, tz));
    if (stair) next.push([f === stair.upper ? f - 1 : f + 1, tx, tz]);
    for (const [nf, nx, nz] of next) {
      if (isSolid(nf, nx, nz) || dist[tileKey(nf, nx, nz)] <= d) continue;
      dist[tileKey(nf, nx, nz)] = d;
      queue.push(nf, nx, nz);
    }
  }
  return dist;
})();

export function gateDist(f: number, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (f < 0 || f >= FLOOR_COUNT || tx < 0 || tx >= MAP_W || tz < 0 || tz >= MAP_H) return Infinity;
  return GATE_DIST[tileKey(f, tx, tz)];
}

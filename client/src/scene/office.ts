import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ALL_OPEN,
  BUS,
  FLOOR_HEIGHT,
  HALTE,
  LIFT_RECTS,
  LIFT_ZONES,
  MAP_H,
  MAP_W,
  OUTDOOR,
  PLANS,
  ROAD,
  STAIRS,
  ZEBRAS,
  canStep,
  floorOffsetZ,
  floorY,
  type FloorPlan,
  type Furniture,
  type ItemType,
  type Stair,
} from '@tenggo/shared';

const WALL_H = 1.15;
const GLASS_H = 1.0;
const WALL_T = 0.16;
const FLOOR_PX = 24; // piksel tekstur lantai per tile

// Acak tapi tetap, supaya dekorasi selalu sama di semua pemain dan tiap muat ulang.
function hash(a: number, b: number, c: number, n = 0): number {
  const s = Math.sin(a * 91.7 + b * 127.1 + c * 311.7 + n * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const pick = <T>(items: readonly T[], h: number): T => items[Math.floor(h * items.length) % items.length];

interface AddOpts {
  glow?: boolean; // menyala sendiri (layar, lampu), tidak terpengaruh cahaya
  glass?: boolean; // tembus pandang
  rx?: number;
  ry?: number;
  rz?: number;
}

/** Penambah bentuk dalam koordinat lokal sebuah perabot (sudah diputar dan digeser ke tempatnya). */
interface Local {
  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, o?: AddOpts): void;
  cyl(rTop: number, rBottom: number, h: number, color: number, x: number, y: number, z: number, o?: AddOpts): void;
  add(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o?: AddOpts): void;
}

/**
 * Mengumpulkan ribuan bentuk kecil lalu menggabungkannya jadi segelintir mesh berwarna per-vertex,
 * supaya gedung yang penuh detail tetap digambar dengan sedikit draw call.
 */
class Batch {
  private lit: THREE.BufferGeometry[] = [];
  private glow: THREE.BufferGeometry[] = [];
  private glass: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o: AddOpts = {}): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    (o.glow ? this.glow : o.glass ? this.glass : this.lit).push(g);
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, o?: AddOpts): void {
    this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, o);
  }

  /** Bingkai lokal berpusat di (cx, cz) dan diputar ry; +z lokal adalah "depan" perabot. */
  at(cx: number, cz: number, ry = 0): Local {
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const place = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o: AddOpts = {}) =>
      this.add(geo, color, cx + x * cos + z * sin, y, cz - x * sin + z * cos, { ...o, ry: (o.ry ?? 0) + ry });
    return {
      add: place,
      box: (w, h, d, color, x, y, z, o) => place(new THREE.BoxGeometry(w, h, d), color, x, y, z, o),
      cyl: (rTop, rBottom, h, color, x, y, z, o) => place(new THREE.CylinderGeometry(rTop, rBottom, h, 10), color, x, y, z, o),
    };
  }

  build(parent: THREE.Object3D): void {
    if (this.lit.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.lit), new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    }
    if (this.glow.length) parent.add(new THREE.Mesh(mergeGeometries(this.glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
    if (this.glass.length) {
      const mesh = new THREE.Mesh(
        mergeGeometries(this.glass),
        new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false }),
      );
      mesh.renderOrder = 3;
      parent.add(mesh);
    }
  }
}

// =====================================================================================
// Tekstur lantai
// =====================================================================================

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Warna dasar lorong tiap lantai: area luar, lobby marmer, kantin ubin, lalu karpet kantor.
const BASE = ['#cfcabd', '#dccdb0', '#e6dcc6', '#8e98ad', '#8a97ae', '#7f8da8'];

/** Satu tekstur per lantai. Lubang tangga dan lubang lift dibiarkan transparan agar lantai bawah terlihat. */
function floorTexture(plan: FloorPlan): THREE.CanvasTexture {
  const P = FLOOR_PX;
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * P;
  canvas.height = MAP_H * P;
  const g = canvas.getContext('2d')!;
  const rand = rng(31 + plan.no);
  const f = plan.no;

  g.fillStyle = BASE[f];
  g.fillRect(0, 0, canvas.width, canvas.height);

  if (f === OUTDOOR) {
    for (const r of plan.rooms) {
      if (!r.fill) continue;
      g.fillStyle = r.fill;
      g.fillRect(r.x0 * P, r.z0 * P, (r.x1 - r.x0) * P, (r.z1 - r.z0) * P);
    }
    // Jalan, jalur busway, dan lajur arah sebaliknya
    g.fillStyle = '#4a4f5c';
    g.fillRect(0, ROAD.z0 * P, canvas.width, (ROAD.z1 - ROAD.z0) * P);
    g.fillRect(0, BUS.z1 * P, canvas.width, (MAP_H - BUS.z1) * P);
    g.fillStyle = '#a8453a';
    g.fillRect(0, BUS.z0 * P, canvas.width, (BUS.z1 - BUS.z0) * P);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const z of [ROAD.z0 + 2, ROAD.z0 + 4, BUS.z1 + 2.3, BUS.z1 + 4.6])
      for (let x = 0; x < MAP_W; x += 2) g.fillRect(x * P + 6, z * P - 2, P, 4);
    for (const zb of ZEBRAS)
      for (let i = 0; i < ROAD.z1 - ROAD.z0; i++) g.fillRect(zb.x0 * P, (ROAD.z0 + i) * P + 5, (zb.x1 - zb.x0) * P, P - 10);
    // Ubin pemandu kuning di trotoar dan garis aman peron
    g.fillStyle = '#ffd21f';
    g.fillRect(0, 9.35 * P, canvas.width, 0.3 * P);
    g.fillRect(BUS.x0 * P, (BUS.z0 - 0.45) * P, (BUS.x1 - BUS.x0) * P, 0.2 * P);
  } else {
    // Bintik serat/karpet supaya lantai tidak polos
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(rand() * canvas.width, rand() * canvas.height, 1 + rand() * 3, 1 + rand());
    }
    for (const r of plan.rooms) {
      if (!r.fill) continue;
      g.globalAlpha = 0.82;
      g.fillStyle = r.fill;
      g.fillRect(r.x0 * P, r.z0 * P, (r.x1 - r.x0) * P, (r.z1 - r.z0) * P);
      g.globalAlpha = 1;
    }
    // Garis ubin untuk lantai keras (lobby, kantin)
    if (f <= 2) {
      g.strokeStyle = 'rgba(110,90,60,0.22)';
      g.lineWidth = 1;
      for (let x = 0; x <= MAP_W; x += 2) g.strokeRect(x * P + 0.5, 0, 0, canvas.height);
      for (let z = 0; z <= MAP_H; z += 2) g.strokeRect(0, z * P + 0.5, canvas.width, 0);
    }
    if (f === 1) {
      g.strokeStyle = 'rgba(150,125,90,0.22)';
      for (let i = 0; i < 260; i++) {
        const x = rand() * canvas.width;
        const y = rand() * canvas.height;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + rand() * 30, y + 10, x - rand() * 30, y + 25, x + (rand() - 0.5) * 40, y + 40);
        g.stroke();
      }
    }
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Nama ruangan, tertulis di lantai
  g.fillStyle = 'rgba(20,24,36,0.42)';
  for (const r of plan.rooms) {
    if (!r.name || r.x1 - r.x0 < 4) continue;
    const size = Math.min(P * 0.62, ((r.x1 - r.x0) * P * 1.5) / r.name.length);
    g.font = `800 ${size}px system-ui, sans-serif`;
    g.fillText(r.name.toUpperCase(), ((r.x0 + r.x1) / 2) * P, (r.z1 - 0.55) * P);
  }

  // Ambang pintu: pintu sempit diberi garis oranye
  for (const d of plan.doors) {
    if (d.dyn !== undefined) continue;
    g.fillStyle = d.narrow ? '#ff9f1a' : 'rgba(255,255,255,0.35)';
    if (d.z0 === d.z1) g.fillRect(d.x0 * P, d.z0 * P - 3, (d.x1 - d.x0) * P, 6);
    else g.fillRect(d.x0 * P - 3, d.z0 * P, 6, (d.z1 - d.z0) * P);
  }

  // Tangga: bordes kuning berpanah di lantai atas, lubang di atas anak tangganya
  for (const s of plan.stairs) {
    if (s.mode === 'turun') {
      g.clearRect(s.x0 * P, s.z0 * P, (s.x1 - s.x0) * P, (s.z1 - s.z0) * P);
      g.fillStyle = '#ffd21f';
      g.fillRect((s.x0 - 1) * P, (s.z0 - 1) * P, (s.x1 - s.x0 + 2) * P, P);
      g.fillStyle = '#1b2030';
      g.font = `900 ${P * 0.8}px system-ui, sans-serif`;
      g.fillText('▼ TANGGA ▼', ((s.x0 + s.x1) / 2) * P, (s.z0 - 0.5) * P);
    } else if (s.mode === 'tutup') {
      g.fillStyle = '#6b7280';
      g.fillRect((s.x0 - 1) * P, (s.z0 - 1) * P, (s.x1 - s.x0 + 2) * P, (s.z1 - s.z0 + 2) * P);
    }
  }

  // Lift: kabin punya lantai sendiri, jadi lubang lift selalu transparan; depan pintunya ditandai
  const zone = LIFT_ZONES.find((z) => z.top === f || z.bottom === f);
  for (const [x0, z0, x1, z1] of LIFT_RECTS) {
    if (zone) {
      g.clearRect(x0 * P, z0 * P, (x1 - x0) * P, (z1 - z0) * P);
      g.fillStyle = zone.top === f ? '#ffb347' : '#9fb4c8';
      g.fillRect((x0 + 1) * P, z1 * P, (x1 - x0 - 2) * P, P * 0.8);
      g.fillStyle = '#1b2030';
      g.font = `900 ${P * 0.55}px system-ui, sans-serif`;
      g.fillText(zone.top === f ? 'LIFT ▼' : 'KELUAR', ((x0 + x1) / 2) * P, (z1 + 0.42) * P);
    } else {
      g.fillStyle = '#3a4055';
      g.fillRect(x0 * P, z0 * P, (x1 - x0) * P, (z1 - z0) * P);
    }
  }

  // Bagian utara denah area luar adalah lobby; pintu putar ditandai di kedua sisi
  if (f === OUTDOOR) g.clearRect(0, 0, canvas.width, 3 * P);
  if (f === 1) {
    g.fillStyle = '#43c773';
    g.fillRect(28 * P, (MAP_H - 1) * P, 4 * P, P);
    g.fillStyle = '#0f5132';
    g.font = `900 ${P * 0.6}px system-ui, sans-serif`;
    g.fillText('▼ KELUAR ▼', 30 * P, (MAP_H - 0.5) * P);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// =====================================================================================
// Perabot
// =====================================================================================

const WOOD = 0xc99a5b;
const DARK = 0x23283a;
const STEEL = 0x9aa3b3;
const SCREEN = 0x9fe3ff;
const MUGS = [0xe2574c, 0x3f8fd1, 0xf2b705, 0xffffff, 0x4cd37b] as const;
const BOOKS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400] as const;

function monitor(L: Local, x: number, y: number, z: number, w = 0.56): void {
  // Layar menghadap -z lokal (ke arah kursi)
  L.box(w, 0.34, 0.04, DARK, x, y + 0.27, z);
  L.box(w - 0.06, 0.28, 0.01, SCREEN, x, y + 0.27, z - 0.026, { glow: true });
  L.box(0.06, 0.1, 0.05, DARK, x, y + 0.05, z + 0.02);
  L.box(0.22, 0.02, 0.14, DARK, x, y + 0.01, z + 0.02);
}

function laptop(L: Local, x: number, y: number, z: number, ry = 0): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  L.box(0.36, 0.02, 0.25, 0xb9bec9, x, y + 0.01, z, { ry });
  L.box(0.36, 0.24, 0.02, 0xb9bec9, x + s * 0.14, y + 0.13, z + c * 0.14, { rx: 0.25, ry });
  L.box(0.31, 0.19, 0.01, SCREEN, x + s * 0.125, y + 0.135, z + c * 0.125, { rx: 0.25, ry, glow: true });
}

function mug(L: Local, x: number, y: number, z: number, h: number): void {
  L.cyl(0.045, 0.04, 0.09, pick(MUGS, h), x, y + 0.045, z);
  L.cyl(0.035, 0.035, 0.005, 0x4a2c17, x, y + 0.091, z);
}

function smallPlant(L: Local, x: number, y: number, z: number): void {
  L.cyl(0.06, 0.045, 0.09, 0xb5633c, x, y + 0.045, z);
  L.add(new THREE.IcosahedronGeometry(0.1, 0), 0x3f9d57, x, y + 0.16, z);
}

function deskLamp(L: Local, x: number, y: number, z: number): void {
  L.cyl(0.07, 0.08, 0.02, DARK, x, y + 0.01, z);
  L.box(0.02, 0.3, 0.02, DARK, x, y + 0.16, z);
  L.box(0.02, 0.02, 0.18, DARK, x, y + 0.31, z - 0.08);
  L.cyl(0.04, 0.08, 0.07, 0xf2b705, x, y + 0.28, z - 0.17);
  L.cyl(0.06, 0.06, 0.01, 0xfff2b0, x, y + 0.245, z - 0.17, { glow: true });
}

/** Sudut putar agar +z lokal menghadap sisi yang terbuka (bisa didatangi orang). */
function frontAngle(plan: FloorPlan, it: Furniture): number {
  const x = Math.floor(it.x);
  const z = Math.floor(it.z);
  const x1 = Math.floor(it.x + it.w - 0.01);
  const z1 = Math.floor(it.z + it.h - 0.01);
  const open = (cx: number, cz: number, dx: number, dz: number) => canStep(plan.no, cx, cz, dx, dz, ALL_OPEN);
  if (open(x, z1, 0, 1)) return 0;
  if (open(x, z, 0, -1)) return Math.PI;
  if (open(x1, z, 1, 0)) return Math.PI / 2;
  if (open(x, z, -1, 0)) return -Math.PI / 2;
  return 0;
}

type Grid = (ItemType | undefined)[];

function furnish(b: Batch, plan: FloorPlan, it: Furniture, grid: Grid, glows: THREE.Vector3[]): void {
  const f = plan.no;
  const cx = it.x + it.w / 2;
  const cz = it.z + it.h / 2;
  const h = (n: number) => hash(f, it.x, it.z, n);
  const typeAt = (x: number, z: number) => (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H ? undefined : grid[Math.floor(z) * MAP_W + Math.floor(x)]);
  const wide = it.w >= it.h; // memanjang ke arah x
  // Bingkai yang sumbu x lokalnya mengikuti sisi panjang perabot
  const along = b.at(cx, cz, wide ? 0 : Math.PI / 2);
  const len = Math.max(it.w, it.h);
  const dep = Math.min(it.w, it.h);

  switch (it.type) {
    case 'desk': {
      // Kursi ada di sisi yang tidak menempel meja lain; layar menghadap ke kursi.
      let ry: number;
      if (wide) ry = typeAt(it.x, it.z - 1) === 'desk' ? Math.PI : typeAt(it.x, it.z + 1) === 'desk' ? 0 : typeAt(it.x + 0.5, it.z + 1.5) === undefined ? Math.PI : 0;
      else ry = typeAt(it.x + 1, it.z) === 'desk' ? Math.PI / 2 : -Math.PI / 2;
      const L = b.at(cx, cz, ry);
      L.box(len, 0.06, 1, WOOD, 0, 0.75, 0);
      L.box(len, 0.3, 0.04, 0xa87d45, 0, 0.57, 0.46);
      for (const lx of [-len / 2 + 0.06, len / 2 - 0.06]) for (const lz of [-0.42, 0.42]) L.box(0.06, 0.72, 0.06, 0x6b6f7a, lx, 0.36, lz);
      const top = 0.78;
      const kind = Math.floor(h(1) * 3);
      if (kind === 0) monitor(L, 0, top, 0.22);
      else if (kind === 1) {
        monitor(L, -0.3, top, 0.24, 0.5);
        monitor(L, 0.3, top, 0.24, 0.5);
      } else laptop(L, 0, top, 0.02);
      if (kind !== 2) {
        L.box(0.42, 0.02, 0.14, 0x3a4055, 0, top + 0.01, -0.2);
        L.box(0.06, 0.025, 0.1, DARK, 0.32, top + 0.012, -0.2);
      }
      mug(L, -0.7, top, -0.1 + h(2) * 0.3, h(3));
      if (h(4) < 0.7) L.box(0.22, 0.03 + h(5) * 0.05, 0.3, 0xffffff, 0.72, top + 0.03, -0.05, { ry: (h(5) - 0.5) * 0.6 });
      if (h(6) < 0.4) deskLamp(L, -0.8, top, 0.3);
      else if (h(6) < 0.75) smallPlant(L, -0.82, top, 0.3);
      if (h(7) < 0.4) L.box(0.12, 0.05, 0.2, DARK, 0.78, top + 0.025, 0.3);
      break;
    }
    case 'chair': {
      // Menghadap meja terdekat
      const near = (dx: number, dz: number) => {
        const t = typeAt(cx + dx * 0.8, cz + dz * 0.8) ?? typeAt(cx + dx * 0.8 - 0.4, cz + dz * 0.8 - 0.4);
        return t === 'desk' || t === 'table' || t === 'reception' || t === 'counter';
      };
      const ry = near(0, 1) ? 0 : near(0, -1) ? Math.PI : near(1, 0) ? Math.PI / 2 : near(-1, 0) ? -Math.PI / 2 : 0;
      const L = b.at(cx, cz, ry);
      L.box(0.44, 0.07, 0.44, 0x2f3648, 0, 0.42, 0);
      L.box(0.44, 0.46, 0.07, 0x2f3648, 0, 0.7, -0.22);
      L.cyl(0.035, 0.035, 0.34, 0x555b6b, 0, 0.2, 0);
      L.box(0.46, 0.04, 0.07, 0x555b6b, 0, 0.04, 0);
      L.box(0.07, 0.04, 0.46, 0x555b6b, 0, 0.04, 0);
      break;
    }
    case 'table': {
      along.box(len - 0.12, 0.07, dep - 0.12, 0x7a5236, 0, 0.78, 0);
      along.box(Math.max(0.3, len - 1), 0.74, Math.max(0.3, dep * 0.4), 0x5a3b26, 0, 0.37, 0);
      for (let i = 0; i < len; i++) {
        const lx = -len / 2 + 0.5 + i;
        const k = hash(f, it.x + i, it.z, 9);
        if (k < 0.3) laptop(along, lx, 0.82, (hash(f, it.x, it.z, i) - 0.5) * dep * 0.5, k < 0.15 ? 0 : Math.PI);
        else if (k < 0.6) mug(along, lx, 0.82, (k - 0.45) * dep, k * 3);
        else if (k < 0.75) along.cyl(0.14, 0.1, 0.03, 0xffffff, lx, 0.835, 0);
      }
      break;
    }
    case 'cabinet':
      for (let i = 0; i < len; i++) {
        const L = b.at(wide ? it.x + i + 0.5 : cx, wide ? cz : it.z + i + 0.5, frontAngle(plan, it));
        L.box(0.94, 1.3, 0.94, 0x8a93a3, 0, 0.65, 0);
        for (const y of [0.28, 0.68, 1.08]) {
          L.box(0.84, 0.34, 0.02, 0x9aa3b3, 0, y, 0.475);
          L.box(0.26, 0.04, 0.03, 0x4f5665, 0, y + 0.06, 0.49);
        }
        if (hash(f, it.x + i, it.z, 1) < 0.5) L.box(0.4, 0.22, 0.3, 0xb98d5a, (hash(f, it.x, it.z + i, 2) - 0.5) * 0.3, 1.41, 0);
      }
      break;
    case 'shelf': {
      along.box(len - 0.04, 1.5, dep * 0.5, 0x6e4a2c, 0, 0.75, 0);
      for (let row = 0; row < 3; row++) {
        const y = 0.12 + row * 0.47;
        along.box(len - 0.04, 0.04, dep - 0.08, 0x8a5f3a, 0, y, 0);
        for (const side of [-1, 1]) {
          let bx = -len / 2 + 0.08;
          for (let i = 0; bx < len / 2 - 0.14; i++) {
            const w = 0.07 + hash(f, it.x + row, it.z + i, side) * 0.07;
            const bh = 0.24 + hash(f, it.x + i, it.z + row, side + 5) * 0.14;
            if (hash(f, it.x + i, it.z, row * 7 + side) > 0.12)
              along.box(w - 0.01, bh, 0.16, pick(BOOKS, hash(f, it.x + i * 3, it.z + row, side + 9)), bx + w / 2, y + 0.02 + bh / 2, side * (dep / 2 - 0.13));
            bx += w;
          }
        }
      }
      along.box(len - 0.04, 0.04, dep - 0.08, 0x8a5f3a, 0, 1.52, 0);
      break;
    }
    case 'locker':
      for (let i = 0; i < len; i++) {
        const L = b.at(wide ? it.x + i + 0.5 : cx, wide ? cz : it.z + i + 0.5, frontAngle(plan, it));
        L.box(0.96, 1.7, 0.8, pick([0x5f7fa8, 0x557299, 0x6a8ab3], hash(f, it.x + i, it.z + i, 3)), 0, 0.85, -0.05);
        L.box(0.02, 1.6, 0.02, 0x3a4f6e, 0, 0.85, 0.36);
        for (const lx of [-0.24, 0.24]) {
          L.box(0.06, 0.12, 0.03, 0xdfe3ea, lx + 0.14, 0.95, 0.37);
          L.box(0.3, 0.06, 0.02, 0x3a4f6e, lx, 1.5, 0.36);
        }
      }
      break;
    case 'plant': {
      const L = b.at(cx, cz);
      L.cyl(0.28, 0.2, 0.45, 0xb5633c, 0, 0.225, 0);
      L.cyl(0.25, 0.25, 0.03, 0x4a2c17, 0, 0.44, 0);
      for (const [ox, oy, oz, r] of [[0, 0.95, 0, 0.36], [0.18, 0.75, 0.1, 0.24], [-0.16, 0.8, -0.12, 0.26]])
        L.add(new THREE.IcosahedronGeometry(r, 0), f === OUTDOOR ? 0x2f8a48 : 0x3f9d57, ox, oy + (f === OUTDOOR ? 0.35 : 0), oz);
      if (f === OUTDOOR) L.cyl(0.07, 0.09, 0.7, 0x6e4a2c, 0, 0.75, 0); // pohon kecil di plaza
      break;
    }
    case 'sofa': {
      // Sandaran di sisi panjang yang menempel dinding/perabot
      const x = Math.floor(it.x);
      const z = Math.floor(it.z);
      const backFree = wide ? canStep(f, x, z, 0, -1, ALL_OPEN) : canStep(f, x, z, -1, 0, ALL_OPEN);
      const frontFree = wide ? canStep(f, x, Math.floor(it.z + it.h - 0.01), 0, 1, ALL_OPEN) : canStep(f, Math.floor(it.x + it.w - 0.01), z, 1, 0, ALL_OPEN);
      const flip = backFree && !frontFree ? Math.PI : 0;
      const L = b.at(cx, cz, (wide ? 0 : Math.PI / 2) + flip);
      L.box(len, 0.36, 1, 0xf2b705, 0, 0.18, 0);
      L.box(len, 0.8, 0.24, 0xd99e00, 0, 0.4, -0.38);
      L.box(len - 0.3, 0.12, 0.62, 0xffcf33, 0, 0.42, 0.1);
      for (const s of [-1, 1]) L.box(0.16, 0.56, 0.9, 0xd99e00, s * (len / 2 - 0.08), 0.28, 0);
      if (h(1) < 0.6) L.box(0.3, 0.3, 0.12, pick([0x3f8fd1, 0xe2574c, 0xffffff], h(2)), (h(3) - 0.5) * (len - 1), 0.62, -0.18, { rx: -0.3 });
      break;
    }
    case 'beanbag': {
      const geo = new THREE.SphereGeometry(0.42, 12, 8);
      geo.scale(1, 0.6, 1);
      b.add(geo, pick([0xff8c42, 0x3f8fd1, 0x4cd37b, 0xb86bff], h(1)), cx, 0.26, cz);
      break;
    }
    case 'counter': {
      along.box(len, 0.85, dep, 0xf3efe6, 0, 0.425, 0);
      along.box(len, 0.05, dep, 0x4f5665, 0, 0.875, 0);
      for (let i = 0; i < len; i++) {
        const k = hash(f, it.x + i, it.z + i, 4);
        const lx = -len / 2 + 0.5 + i;
        if (k < 0.3) mug(along, lx, 0.9, (k - 0.15) * dep, k * 3);
        else if (k < 0.5) along.cyl(0.09, 0.09, 0.2, pick([0xe9c46a, 0xd9903d, 0xffffff], k * 2), lx, 1.0, 0);
        else if (k < 0.62) along.box(0.34, 0.1, 0.24, 0xe9c46a, lx, 0.95, 0, { ry: k });
      }
      break;
    }
    case 'coffee': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      L.box(1, 0.85, 1, 0xf3efe6, 0, 0.425, 0);
      L.box(1, 0.05, 1, 0x4f5665, 0, 0.875, 0);
      L.box(0.46, 0.5, 0.4, DARK, -0.1, 1.15, -0.1);
      L.box(0.46, 0.08, 0.42, 0xb9bec9, -0.1, 1.42, -0.1);
      L.box(0.3, 0.04, 0.2, 0xb9bec9, -0.1, 0.92, 0.18);
      L.box(0.04, 0.04, 0.02, 0x4cd37b, -0.22, 1.3, 0.105, { glow: true });
      L.box(0.04, 0.04, 0.02, 0xff5a5f, -0.14, 1.3, 0.105, { glow: true });
      mug(L, -0.1, 0.94, 0.18, h(1));
      mug(L, 0.32, 0.9, 0.25, h(2));
      break;
    }
    case 'vending': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      L.box(0.92, 1.7, 0.8, 0x2b2f3a, 0, 0.85, 0);
      L.box(0.92, 0.14, 0.82, 0xd43c3c, 0, 1.63, 0);
      L.box(0.56, 0.95, 0.02, 0xcfefff, -0.12, 1.0, 0.41, { glow: true });
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 4; col++)
          L.box(0.1, 0.16, 0.03, pick(BOOKS, hash(f, it.x + row, it.z + col, 6)), -0.33 + col * 0.14, 0.7 + row * 0.3, 0.42, { glow: true });
      L.box(0.14, 0.3, 0.02, 0x4f5665, 0.32, 1.1, 0.41);
      L.box(0.5, 0.16, 0.02, 0x15181f, -0.12, 0.3, 0.41);
      break;
    }
    case 'fridge': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      L.box(0.86, 1.75, 0.8, 0xe8f1f6, 0, 0.875, 0);
      L.box(0.8, 0.02, 0.02, 0x9aa3b3, 0, 1.15, 0.41);
      L.box(0.05, 0.4, 0.04, 0x6b7280, 0.3, 1.45, 0.42);
      L.box(0.05, 0.5, 0.04, 0x6b7280, 0.3, 0.7, 0.42);
      break;
    }
    case 'dispenser': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      L.box(0.42, 0.95, 0.42, 0xf3f5f8, 0, 0.475, 0);
      L.cyl(0.19, 0.19, 0.42, 0x5fb6f0, 0, 1.17, 0);
      L.cyl(0.07, 0.19, 0.08, 0x5fb6f0, 0, 1.42, 0);
      L.box(0.06, 0.06, 0.04, 0x3f8fd1, -0.08, 0.7, 0.22);
      L.box(0.06, 0.06, 0.04, 0xe2574c, 0.08, 0.7, 0.22);
      break;
    }
    case 'printer': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      L.box(0.84, 0.72, 0.72, 0xdfe3ea, 0, 0.36, 0);
      L.box(0.88, 0.12, 0.76, 0x3a4055, 0, 0.78, 0);
      L.box(0.6, 0.03, 0.5, 0xf3f5f8, -0.05, 0.855, 0);
      L.box(0.5, 0.03, 0.3, 0xffffff, 0, 0.46, 0.46);
      L.box(0.16, 0.06, 0.02, 0x7fe0ff, 0.28, 0.62, 0.365, { glow: true });
      L.box(0.04, 0.04, 0.02, 0x4cd37b, 0.12, 0.62, 0.365, { glow: true });
      break;
    }
    case 'lamp': {
      const L = b.at(cx, cz);
      L.cyl(0.2, 0.22, 0.05, DARK, 0, 0.025, 0);
      L.cyl(0.025, 0.025, f === OUTDOOR ? 2.4 : 1.45, 0x6b6f7a, 0, f === OUTDOOR ? 1.2 : 0.75, 0);
      L.cyl(0.17, 0.28, 0.32, 0xffe2a0, 0, f === OUTDOOR ? 2.5 : 1.6, 0, { glow: true });
      glows.push(new THREE.Vector3(cx, 0.03, cz));
      break;
    }
    case 'booth': {
      // Bilik telepon kedap suara: kotak tinggi dengan pintu kaca
      const L = b.at(cx, cz, frontAngle(plan, it));
      const w = it.w - 0.1;
      const d = it.h - 0.1;
      const [bw, bd] = Math.abs(Math.sin(frontAngle(plan, it))) > 0.5 ? [d, w] : [w, d];
      L.box(bw, 1.9, 0.08, 0x1f9d93, 0, 0.95, -bd / 2 + 0.04);
      for (const s of [-1, 1]) L.box(0.08, 1.9, bd, 0x1f9d93, s * (bw / 2 - 0.04), 0.95, 0);
      L.box(bw, 0.08, bd, 0x178077, 0, 1.94, 0);
      L.box(bw - 0.16, 1.7, 0.03, 0xbfeee9, 0, 0.9, bd / 2 - 0.03, { glass: true });
      L.box(bw - 0.3, 0.06, 0.3, 0x6e4a2c, 0, 0.75, -bd / 2 + 0.25);
      L.cyl(0.14, 0.14, 0.05, 0x2f3648, 0, 0.45, 0);
      L.box(0.12, 0.04, 0.02, 0xfff2b0, 0, 1.86, bd / 2 - 0.02, { glow: true });
      break;
    }
    case 'server': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      const [bw, bd] = Math.abs(Math.sin(frontAngle(plan, it))) > 0.5 ? [it.h, it.w] : [it.w, it.h];
      L.box(bw - 0.1, 1.8, bd - 0.1, 0x15181f, 0, 0.9, 0);
      for (let row = 0; row < 7; row++)
        for (let col = 0; col < Math.round(bw * 3); col++)
          if (hash(f, it.x + col, it.z + row, 8) > 0.35)
            L.box(0.05, 0.03, 0.02, hash(f, it.x + row, it.z + col, 2) > 0.2 ? 0x4cd37b : 0xff9f1a, -bw / 2 + 0.2 + col * 0.3, 0.3 + row * 0.22, bd / 2 - 0.04, { glow: true });
      break;
    }
    case 'pingpong':
      along.box(len - 0.1, 0.06, dep - 0.1, 0x2f8f57, 0, 0.76, 0);
      along.box(len - 0.1, 0.061, 0.03, 0xffffff, 0, 0.762, 0);
      along.box(0.03, 0.061, dep - 0.1, 0xffffff, -len / 2 + 0.07, 0.762, 0);
      along.box(0.03, 0.061, dep - 0.1, 0xffffff, len / 2 - 0.07, 0.762, 0);
      along.box(0.02, 0.16, dep, 0x1b2030, 0, 0.87, 0);
      for (const lx of [-len / 2 + 0.4, len / 2 - 0.4]) for (const lz of [-dep / 2 + 0.3, dep / 2 - 0.3]) along.box(0.06, 0.74, 0.06, 0x555b6b, lx, 0.37, lz);
      along.cyl(0.03, 0.03, 0.03, 0xff8c42, len * 0.2, 0.81, dep * 0.15);
      break;
    case 'gym':
      // Treadmill: landasan, tiang, dan panel
      along.box(len - 0.15, 0.18, dep - 0.2, 0x3a4055, 0, 0.09, 0);
      along.box(len - 0.5, 0.02, dep - 0.35, 0x15181f, -0.1, 0.19, 0);
      for (const s of [-1, 1]) along.box(0.06, 1.1, 0.06, STEEL, len / 2 - 0.2, 0.6, s * (dep / 2 - 0.16));
      along.box(0.1, 0.3, dep - 0.3, DARK, len / 2 - 0.2, 1.15, 0);
      along.box(0.02, 0.2, dep - 0.45, 0x7fe0ff, len / 2 - 0.26, 1.17, 0, { glow: true });
      break;
    case 'bed':
      // Nap pod: kasur, bantal, dan tudung di bagian kepala
      along.box(len - 0.1, 0.35, dep - 0.12, 0xf3f5f8, 0, 0.175, 0);
      along.box(len - 0.2, 0.12, dep - 0.2, 0xb8a6e8, 0, 0.41, 0);
      along.box(0.4, 0.1, dep - 0.35, 0xffffff, -len / 2 + 0.35, 0.5, 0);
      along.box(0.7, 0.7, 0.06, 0x8f7fd0, -len / 2 + 0.4, 0.7, -dep / 2 + 0.08);
      along.box(0.7, 0.7, 0.06, 0x8f7fd0, -len / 2 + 0.4, 0.7, dep / 2 - 0.08);
      along.box(0.7, 0.06, dep - 0.1, 0x8f7fd0, -len / 2 + 0.4, 1.05, 0);
      break;
    case 'sink': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      const [bw, bd] = Math.abs(Math.sin(frontAngle(plan, it))) > 0.5 ? [it.h, it.w] : [it.w, it.h];
      L.box(bw, 0.8, bd * 0.8, 0xf3f5f8, 0, 0.4, -bd * 0.1);
      for (let i = 0; i < bw; i++) {
        L.box(0.5, 0.04, 0.34, 0xbfd3e0, -bw / 2 + 0.5 + i, 0.8, -0.05);
        L.box(0.04, 0.16, 0.04, STEEL, -bw / 2 + 0.5 + i, 0.9, -0.26);
        L.box(0.04, 0.04, 0.14, STEEL, -bw / 2 + 0.5 + i, 0.97, -0.2);
      }
      break;
    }
    case 'toilet': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      for (const s of [-1, 1]) L.box(0.05, 1.5, 0.95, 0xe9e3d6, s * 0.47, 0.75, 0);
      L.box(0.9, 1.4, 0.04, 0xd8d2c4, 0, 0.75, 0.46);
      L.box(0.34, 0.36, 0.44, 0xffffff, 0, 0.18, -0.12);
      L.box(0.4, 0.34, 0.16, 0xffffff, 0, 0.52, -0.38);
      break;
    }
    case 'reception': {
      along.box(len, 1.0, dep, 0x5a3b26, 0, 0.5, 0);
      along.box(len, 0.06, dep, 0x7a5236, 0, 1.03, 0);
      along.box(len - 0.2, 0.04, 0.04, 0xffcf33, 0, 0.8, dep / 2 + 0.01, { glow: true });
      for (let i = 0; i < len; i += 2) {
        const L = b.at(wide ? it.x + i + 0.7 : cx, wide ? cz : it.z + i + 0.7, wide ? Math.PI : Math.PI / 2);
        monitor(L, 0, 1.06, -0.1, 0.5);
      }
      along.cyl(0.07, 0.09, 0.05, 0xd4af37, len / 2 - 0.3, 1.085, 0.2);
      break;
    }
    case 'turnstile': {
      // Badan gate berjajar; celah di sebelahnya adalah lorong sempit yang bisa dilewati
      const L = b.at(cx, cz, f === OUTDOOR ? Math.PI / 2 : 0);
      L.box(0.7, 0.95, 0.9, STEEL, 0, 0.475, 0);
      L.box(0.72, 0.04, 0.92, 0x6b7280, 0, 0.97, 0);
      L.box(0.3, 0.02, 0.3, 0x4cd37b, 0, 1.0, 0.2, { glow: true });
      L.box(0.3, 0.02, 0.3, 0x15181f, 0, 1.0, -0.2);
      for (const s of [-1, 1]) L.box(0.34, 0.5, 0.04, 0xbfe3f5, s * 0.5, 0.6, 0, { glass: true });
      break;
    }
    case 'atm':
    case 'topup': {
      const L = b.at(cx, cz, frontAngle(plan, it));
      const body = it.type === 'atm' ? 0x3f7fd1 : 0x1c5fb0;
      L.box(0.8, 1.6, 0.6, body, 0, 0.8, -0.1);
      L.box(0.82, 0.22, 0.62, it.type === 'atm' ? 0xffffff : 0xff7a1a, 0, 1.55, -0.1);
      L.box(0.5, 0.36, 0.02, 0xcfefff, 0, 1.15, 0.21, { glow: true });
      L.box(0.5, 0.06, 0.2, 0x23283a, 0, 0.88, 0.26);
      L.box(0.3, 0.03, 0.02, 0x15181f, 0, 0.7, 0.21);
      break;
    }
    case 'shaft':
      b.box(it.w, 1.7, it.h, 0x3a4055, cx, 0.85, cz);
      if (f === OUTDOOR) {
        // Kaki tangga menuju anjungan halte
        for (let i = 0; i < 5; i++) b.box(it.w / 5, 0.1, it.h, 0xffd21f, it.x + (i + 0.5) * (it.w / 5), 1.75 + i * 0.02, cz);
      }
      break;
    case 'bench':
      along.box(len - 0.1, 0.07, 0.5, 0x8fa3b8, 0, 0.45, 0);
      along.box(len - 0.1, 0.4, 0.06, 0x8fa3b8, 0, 0.72, -0.25);
      for (const s of [-1, 1]) along.box(0.06, 0.45, 0.46, 0x555b6b, s * (len / 2 - 0.2), 0.225, 0);
      break;
    case 'fence':
      b.box(0.08, 0.9, 0.08, 0x6b7280, cx, 0.45, cz);
      for (const y of [0.35, 0.8]) b.box(1, 0.05, 0.05, 0x6b7280, cx, y, cz);
      break;
    case 'cart': {
      // Gerobak kopi keliling dengan payung
      along.box(len - 0.3, 0.6, 0.7, 0xe8590c, 0, 0.6, 0);
      along.box(len - 0.2, 0.05, 0.8, 0xf3efe6, 0, 0.92, 0);
      for (const s of [-1, 1]) along.cyl(0.2, 0.2, 0.06, 0x15181f, s * (len / 2 - 0.4), 0.2, 0.36, { rx: Math.PI / 2 });
      along.cyl(0.02, 0.02, 1.4, 0x6b6f7a, 0, 1.5, 0);
      along.add(new THREE.ConeGeometry(0.9, 0.4, 8), pick([0xd43c3c, 0x2e86c1], h(1)), 0, 2.3, 0);
      for (let i = 0; i < 3; i++) along.cyl(0.07, 0.07, 0.16, pick(MUGS, h(i + 2)), -0.4 + i * 0.35, 1.03, 0.1);
      break;
    }
    case 'motor': {
      // Ojol menunggu penumpang
      const L = b.at(cx, cz, 0);
      for (const s of [-1, 1]) L.cyl(0.18, 0.18, 0.08, 0x15181f, 0, 0.18, s * 0.34, { rz: Math.PI / 2 });
      L.box(0.22, 0.26, 0.6, 0x2f9e44, 0, 0.42, 0);
      L.box(0.2, 0.08, 0.34, 0x15181f, 0, 0.6, -0.08);
      L.box(0.06, 0.4, 0.06, 0x555b6b, 0, 0.62, 0.3);
      L.box(0.4, 0.04, 0.04, 0x555b6b, 0, 0.82, 0.3);
      L.box(0.3, 0.26, 0.26, 0x2f9e44, 0, 0.75, -0.34);
      break;
    }
    case 'mat':
      b.box(it.w - 0.1, 0.02, it.h - 0.1, f === 2 ? pick([0xc0503f, 0x2f8f57, 0x3f6fa8], hash(f, it.x, 0, 1)) : 0xb0483c, cx, 0.02, cz);
      b.box(it.w - 0.3, 0.021, 0.08, 0xf2d48a, cx, 0.021, it.z + 0.25);
      break;
    case 'tv': {
      // Layar di dinding: menempel di garis tile terdekat
      const onSouth = it.z - Math.floor(it.z) > 0.5;
      const z = onSouth ? Math.ceil(it.z) - 0.14 : Math.floor(it.z) + 0.14;
      b.box(it.w - 0.2, 0.52, 0.06, DARK, cx, 0.72, z);
      b.box(it.w - 0.3, 0.42, 0.02, 0x7fb8e6, cx, 0.72, z + (onSouth ? -0.04 : 0.04), { glow: true });
      break;
    }
  }
}

// =====================================================================================
// Dinding, tangga, halte
// =====================================================================================

function walls(b: Batch, plan: FloorPlan): void {
  const f = plan.no;
  const onBus = (horizontal: boolean, x: number, z: number) =>
    f === OUTDOOR &&
    (horizontal ? (z === BUS.z0 || z === BUS.z1) && x >= BUS.x0 && x < BUS.x1 : (x === BUS.x0 || x === BUS.x1) && z >= BUS.z0 && z < BUS.z1);
  const draw = (horizontal: boolean, x: number, z: number, kind: number) => {
    const edge = horizontal ? z === 0 || z === MAP_H : x === 0 || x === MAP_W;
    if (f === OUTDOOR && (edge || (horizontal && z === 3))) return; // jalan terbuka; fasad digambar oleh lobby
    if (onBus(horizontal, x, z)) return; // badan bus digambar terpisah karena bergerak
    const w = horizontal ? 1 + WALL_T : WALL_T;
    const d = horizontal ? WALL_T : 1 + WALL_T;
    const px = horizontal ? x + 0.5 : x;
    const pz = horizontal ? z : z + 0.5;
    if (f === OUTDOOR && horizontal && z === BUS.z1) {
      b.box(w, 0.45, 0.3, 0xb9bec9, px, 0.225, pz); // pembatas beton busway
      return;
    }
    if (edge) {
      // Fasad kaca gedung dengan kusen putih
      b.box(w, WALL_H + 0.1, d, 0x4a9bd1, px, (WALL_H + 0.1) / 2, pz);
      b.box(w, 0.08, d + 0.06, 0xfaf7f0, px, WALL_H + 0.14, pz);
      return;
    }
    if (kind === 2) {
      b.box(w, WALL_H, d, 0xe9e3d6, px, WALL_H / 2, pz);
      b.box(w, 0.06, d + 0.04, 0xfaf7f0, px, WALL_H + 0.03, pz);
    } else {
      // Sekat kaca: panel tembus pandang dengan rel bawah dan atas
      b.box(w, GLASS_H, d * 0.5, 0x9fd3f5, px, GLASS_H / 2, pz, { glass: true });
      b.box(w, 0.08, d, 0xdfe6ee, px, 0.04, pz);
      b.box(w, 0.05, d, 0xdfe6ee, px, GLASS_H, pz);
    }
  };
  for (let z = 0; z <= MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      const i = z * MAP_W + x;
      if (plan.h[i] && plan.hDyn[i] < 0) draw(true, x, z, plan.h[i]);
    }
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x <= MAP_W; x++) {
      const i = z * (MAP_W + 1) + x;
      if (plan.v[i] && plan.vDyn[i] < 0) draw(false, x, z, plan.v[i]);
    }
}

/** Anak tangga dari lantai bawah naik ke lantai atas, dalam koordinat lokal lantai bawah. Menurun ke arah +z. */
function stairs(b: Batch, s: Stair): void {
  const length = s.maxZ - s.minZ;
  const width = s.maxX - s.minX;
  const steps = length * 3;
  const depth = length / steps;
  const cx = (s.minX + s.maxX) / 2;
  for (let i = 0; i < steps; i++) {
    const top = FLOOR_HEIGHT * (1 - (i + 0.5) / steps);
    const z = s.minZ + (i + 0.5) * depth;
    b.box(width, top, depth, i % 2 === 0 ? 0xc3c8d2 : 0xb3b9c5, cx, top / 2, z);
    b.box(width, 0.02, 0.05, 0xffd21f, cx, top + 0.01, z + depth / 2 - 0.03);
  }
}

/** Halte berbentuk kapal ala Bundaran HI: haluan lancip di kedua ujung dengan anjungan di atasnya. */
function halte(b: Batch): void {
  const midZ = (HALTE.z0 + HALTE.z1) / 2;
  const halfD = (HALTE.z1 - HALTE.z0) / 2;
  for (const [baseX, tipX] of [[HALTE.x0, HALTE.x0 - 6], [HALTE.x1, HALTE.x1 + 6]]) {
    const shape = new THREE.Shape();
    shape.moveTo(baseX, -halfD);
    shape.lineTo(tipX, 0);
    shape.lineTo(baseX, halfD);
    shape.closePath();
    // Geladak bawah dan anjungan di atasnya (di luar area bermain, jadi tidak menutupi pemain)
    for (const [y, thick, color] of [[0, 0.3, 0xeef3f7], [1.9, 0.18, 0xffffff]] as const) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      b.add(geo, color, 0, y + thick, midZ);
    }
    const dir = Math.sign(tipX - baseX);
    // Pagar anjungan dan tiang penyangga
    for (let i = 0; i <= 5; i++) {
      const x = baseX + dir * i;
      const half = halfD * (1 - i / 6);
      for (const s of [-1, 1]) {
        b.box(0.06, 0.6, 0.06, STEEL, x, 2.4, midZ + s * half);
        if (i % 2 === 0) b.box(0.12, 1.9, 0.12, 0xdfe6ee, x, 0.95, midZ + s * half * 0.9);
      }
    }
    b.box(0.08, 1.6, 0.08, STEEL, tipX - dir * 0.6, 2.9, midZ);
    b.box(0.6, 0.35, 0.03, 0xd43c3c, tipX - dir * 0.95, 3.5, midZ);
  }
  // Rangka atap tipis melintang, supaya bentuk halte terbaca tanpa menutupi peron
  for (let x = HALTE.x0; x <= HALTE.x1; x += 4) {
    for (const z of [HALTE.z0, HALTE.z1]) b.box(0.12, 2.3, 0.12, 0xdfe6ee, x, 1.15, z);
    b.box(0.1, 0.1, HALTE.z1 - HALTE.z0, 0xdfe6ee, x, 2.3, midZ);
  }
  for (const z of [HALTE.z0, HALTE.z1]) b.box(HALTE.x1 - HALTE.x0, 0.1, 0.1, 0x1c4f9c, (HALTE.x0 + HALTE.x1) / 2, 2.3, z);
}

/** Menara kantor di atas lobby, terlihat saat pemain berada di jalan. */
export function buildTower(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#2f6fa5';
  g.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 30; col++) {
      g.fillStyle = hash(row, col, 3) > 0.35 ? '#ffe9a8' : '#4a90c8';
      g.fillRect(col * 17 + 3, row * 32 + 5, 12, 22);
    }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const height = 16;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(MAP_W, height, MAP_H), [
    new THREE.MeshLambertMaterial({ color: 0x2f6fa5 }),
    new THREE.MeshLambertMaterial({ color: 0x2f6fa5 }),
    new THREE.MeshLambertMaterial({ color: 0x3a4055 }),
    new THREE.MeshLambertMaterial({ color: 0x3a4055 }),
    new THREE.MeshBasicMaterial({ map: tex }), // sisi selatan, menghadap jalan
    new THREE.MeshLambertMaterial({ color: 0x2f6fa5 }),
  ]);
  tower.position.set(MAP_W / 2, FLOOR_HEIGHT + height / 2, MAP_H / 2);
  return tower;
}

/** Cahaya hangat di lantai sekitar lampu berdiri. */
function lampGlow(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 214, 130, 0.55)');
  grad.addColorStop(1, 'rgba(255, 214, 130, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

function buildFloor(plan: FloorPlan): THREE.Group {
  const group = new THREE.Group();
  group.position.set(0, floorY(plan.no), floorOffsetZ(plan.no));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: floorTexture(plan), alphaTest: 0.5 }),
  );
  floor.position.set(MAP_W / 2, 0, MAP_H / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const grid: Grid = new Array(MAP_W * MAP_H);
  for (const it of plan.items) {
    if (it.type === 'chair' || it.type === 'mat' || it.type === 'tv') continue;
    for (let z = Math.floor(it.z); z < Math.ceil(it.z + it.h); z++)
      for (let x = Math.floor(it.x); x < Math.ceil(it.x + it.w); x++) grid[z * MAP_W + x] = it.type;
  }

  const batch = new Batch();
  const glows: THREE.Vector3[] = [];
  walls(batch, plan);
  for (const it of plan.items) furnish(batch, plan, it, grid, glows);
  for (const s of STAIRS) if (s.upper - 1 === plan.no) stairs(batch, s);
  if (plan.no === OUTDOOR) halte(batch);
  batch.build(group);

  const glow = lampGlow();
  for (const at of glows) {
    const pool = glow.clone();
    pool.position.copy(at);
    group.add(pool);
  }
  return group;
}

/** Membangun seluruh gedung; satu grup per lantai supaya lantai di atas pemain bisa disembunyikan. */
export function buildOffice(): THREE.Group[] {
  return PLANS.map(buildFloor);
}

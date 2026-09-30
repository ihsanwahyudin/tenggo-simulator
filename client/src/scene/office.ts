import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLOORS, FLOOR_COUNT, FLOOR_HEIGHT, MAP_H, MAP_W, STAIRS, tileAt, type Stair } from '@tenggo/shared';

const WALL_H = 1.1;
const FLOOR_PX = 32; // piksel tekstur lantai per tile

// Acak tapi tetap per tile, supaya dekorasi selalu sama di semua pemain dan tiap muat ulang.
function hash(f: number, tx: number, tz: number, n = 0): number {
  const s = Math.sin(f * 91.7 + tx * 127.1 + tz * 311.7 + n * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const pick = <T>(items: readonly T[], h: number): T => items[Math.floor(h * items.length) % items.length];

interface AddOpts {
  glow?: boolean; // menyala sendiri (layar, lampu), tidak terpengaruh cahaya
  rx?: number;
  ry?: number;
  rz?: number;
}

/**
 * Mengumpulkan ratusan bentuk kecil lalu menggabungkannya jadi satu mesh berwarna per-vertex,
 * supaya kantor yang penuh detail tetap digambar dengan segelintir draw call.
 */
class Batch {
  private lit: THREE.BufferGeometry[] = [];
  private glow: THREE.BufferGeometry[] = [];

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
    (o.glow ? this.glow : this.lit).push(g);
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, o?: AddOpts): void {
    this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, o);
  }

  cyl(rTop: number, rBottom: number, h: number, color: number, x: number, y: number, z: number, o?: AddOpts): void {
    this.add(new THREE.CylinderGeometry(rTop, rBottom, h, 10), color, x, y, z, o);
  }

  build(parent: THREE.Object3D): void {
    if (this.lit.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.lit), new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    }
    if (this.glow.length) parent.add(new THREE.Mesh(mergeGeometries(this.glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }
}

// ---------- Tekstur lantai ----------

// Generator acak berbenih supaya tekstur lantai selalu sama.
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Zone = 'work' | 'meeting' | 'pantry' | 'hall' | 'lobby';
function zoneOf(f: number, tx: number, tz: number): Zone {
  if (f === 2) return 'work';
  if (f === 0) return 'lobby';
  return tz >= 9 ? 'hall' : tx <= 17 ? 'pantry' : 'meeting';
}

const inStair = (s: Stair, tx: number, tz: number) => tx >= s.minX && tx < s.maxX && tz >= s.minZ && tz < s.maxZ;
const ARROW: Record<string, string> = { '>': '→', '<': '←', v: '↓', '^': '↑' };

/** Satu tekstur per lantai. Lubang tangga dibiarkan transparan agar lantai bawah terlihat. */
function floorTexture(f: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * FLOOR_PX;
  canvas.height = MAP_H * FLOOR_PX;
  const g = canvas.getContext('2d')!;
  const rand = rng(17 + f);
  const P = FLOOR_PX;

  for (let tz = 0; tz < MAP_H; tz++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const ch = FLOORS[f][tz][tx];
      const x = tx * P;
      const y = tz * P;
      if (STAIRS.some((s) => s.upper === f && inStair(s, tx, tz))) continue; // lubang tangga
      if (ch === '#') {
        g.fillStyle = '#2a2f3d';
        g.fillRect(x, y, P, P);
        continue;
      }
      if (ch === 'G') {
        g.fillStyle = '#43c773';
        g.fillRect(x, y, P, P);
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 3;
        for (const oy of [8, 18]) {
          g.beginPath();
          g.moveTo(x + 6, y + oy);
          g.lineTo(x + P / 2, y + oy + 8);
          g.lineTo(x + P - 6, y + oy);
          g.stroke();
        }
        continue;
      }
      const zone = zoneOf(f, tx, tz);
      if (zone === 'work' || zone === 'meeting') {
        // Karpet: warna dasar dengan serat acak
        g.fillStyle = zone === 'work' ? '#566a8f' : '#5f7f78';
        g.fillRect(x, y, P, P);
        for (let i = 0; i < 70; i++) {
          g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.10)';
          g.fillRect(x + rand() * P, y + rand() * P, 1 + rand() * 2, 1);
        }
        if ((tx + tz) % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.035)';
          g.fillRect(x, y, P, P);
        }
      } else if (zone === 'pantry') {
        g.fillStyle = (tx + tz) % 2 === 0 ? '#f1e7cf' : '#e3d6b6';
        g.fillRect(x, y, P, P);
        g.strokeStyle = 'rgba(120,100,70,0.35)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, P - 1, P - 1);
      } else if (zone === 'hall') {
        const shade = 196 + Math.floor(rand() * 10);
        g.fillStyle = `rgb(${shade},${shade + 3},${shade + 9})`;
        g.fillRect(x, y, P, P);
        g.strokeStyle = 'rgba(90,96,110,0.4)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, P - 1, P - 1);
      } else {
        // Marmer: dasar krem dengan urat tipis
        const shade = Math.floor(rand() * 8);
        g.fillStyle = `rgb(${226 - shade},${212 - shade},${184 - shade})`;
        g.fillRect(x, y, P, P);
        g.strokeStyle = 'rgba(150,125,90,0.28)';
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.moveTo(x + rand() * P, y);
          g.bezierCurveTo(x + rand() * P, y + P * 0.3, x + rand() * P, y + P * 0.7, x + rand() * P, y + P);
          g.stroke();
        }
        g.fillStyle = 'rgba(120,100,70,0.3)';
        if (tx % 2 === 0) g.fillRect(x, y, 1, P);
        if (tz % 2 === 0) g.fillRect(x, y, P, 1);
      }
    }
  }

  // Karpet kecil di bawah sofa
  g.fillStyle = 'rgba(176, 72, 60, 0.55)';
  for (let tz = 0; tz < MAP_H; tz++)
    for (let tx = 0; tx < MAP_W; tx++)
      if (FLOORS[f][tz][tx] === 'O' && tileAt(f, tx, tz + 1) === '.') g.fillRect(tx * P + 2, (tz + 1) * P + 2, P - 4, P - 6);

  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Tanda kuning di mulut tangga turun
  for (const s of STAIRS) {
    if (s.upper !== f) continue;
    const alongX = s.dir === '>' || s.dir === '<';
    const ex = s.dir === '>' ? s.minX - 1 : s.dir === '<' ? s.maxX : s.minX;
    const ez = s.dir === 'v' ? s.minZ - 1 : s.dir === '^' ? s.maxZ : s.minZ;
    const w = alongX ? 1 : s.maxX - s.minX;
    const h = alongX ? s.maxZ - s.minZ : 1;
    g.fillStyle = '#ffd21f';
    g.fillRect(ex * P, ez * P, w * P, h * P);
    g.fillStyle = '#1b2030';
    g.font = `900 ${P * 0.9}px system-ui, sans-serif`;
    g.fillText(ARROW[s.dir], (ex + w / 2) * P, (ez + h / 2) * P);
  }

  // Tulisan di lantai depan gerbang
  const gateRow = FLOORS[f].findIndex((row) => row.includes('G'));
  if (gateRow > 0) {
    const first = FLOORS[f][gateRow].indexOf('G');
    const last = FLOORS[f][gateRow].lastIndexOf('G');
    g.font = `900 ${P * 0.8}px system-ui, sans-serif`;
    g.fillStyle = '#1f7a45';
    g.fillText('PULANG ↓', ((first + last + 1) / 2) * P, (gateRow - 3.5) * P);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- Perabot ----------

const WOOD = 0xc99a5b;
const DARK = 0x23283a;
const SCREEN = 0x9fe3ff;
const MUGS = [0xe2574c, 0x3f8fd1, 0xf2b705, 0xffffff, 0x4cd37b] as const;
const BOOKS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400] as const;

function monitor(b: Batch, x: number, y: number, z: number, w = 0.56): void {
  b.box(w, 0.34, 0.04, DARK, x, y + 0.27, z);
  b.box(w - 0.06, 0.28, 0.01, SCREEN, x, y + 0.27, z - 0.026, { glow: true });
  b.box(0.06, 0.1, 0.05, DARK, x, y + 0.05, z + 0.02);
  b.box(0.22, 0.02, 0.14, DARK, x, y + 0.01, z + 0.02);
}

/** Laptop terbuka; layarnya menghadap -z bila ry = 0. */
function laptop(b: Batch, x: number, y: number, z: number, ry = 0): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  b.box(0.36, 0.02, 0.25, 0xb9bec9, x, y + 0.01, z, { ry });
  b.box(0.36, 0.24, 0.02, 0xb9bec9, x + s * 0.14, y + 0.13, z + c * 0.14, { rx: 0.25, ry });
  b.box(0.31, 0.19, 0.01, SCREEN, x + s * 0.125, y + 0.135, z + c * 0.125, { rx: 0.25, ry, glow: true });
}

function mug(b: Batch, x: number, y: number, z: number, h: number): void {
  b.cyl(0.045, 0.04, 0.09, pick(MUGS, h), x, y + 0.045, z);
  b.cyl(0.035, 0.035, 0.005, 0x4a2c17, x, y + 0.091, z);
}

function smallPlant(b: Batch, x: number, y: number, z: number): void {
  b.cyl(0.06, 0.045, 0.09, 0xb5633c, x, y + 0.045, z);
  b.add(new THREE.IcosahedronGeometry(0.1, 0), 0x3f9d57, x, y + 0.16, z);
}

function deskLamp(b: Batch, x: number, y: number, z: number): void {
  b.cyl(0.07, 0.08, 0.02, DARK, x, y + 0.01, z);
  b.box(0.02, 0.3, 0.02, DARK, x, y + 0.16, z);
  b.box(0.02, 0.02, 0.18, DARK, x, y + 0.31, z - 0.08);
  b.cyl(0.04, 0.08, 0.07, 0xf2b705, x, y + 0.28, z - 0.17);
  b.cyl(0.06, 0.06, 0.01, 0xfff2b0, x, y + 0.245, z - 0.17, { glow: true });
}

function paperStack(b: Batch, x: number, y: number, z: number, h: number): void {
  b.box(0.22, 0.02 + h * 0.05, 0.3, 0xffffff, x, y + 0.01 + h * 0.025, z, { ry: (h - 0.5) * 0.6 });
}

function furnish(b: Batch, f: number, tx: number, tz: number, ch: string): void {
  const x = tx + 0.5;
  const z = tz + 0.5;
  const h = (n: number) => hash(f, tx, tz, n);
  const same = (dx: number, dz: number) => tileAt(f, tx + dx, tz + dz) === ch;

  switch (ch) {
    case 'D': {
      b.box(1, 0.06, 1, WOOD, x, 0.75, z);
      b.box(1, 0.3, 0.04, 0xa87d45, x, 0.57, z + 0.46); // papan depan
      const legX = same(-1, 0) ? 0.44 : -0.44;
      for (const lz of [-0.42, 0.42]) b.box(0.06, 0.72, 0.06, 0x6b6f7a, x + legX, 0.36, z + lz);
      if (same(-1, 0)) break;
      // Isi meja untuk sepasang tile; kursi ada di sisi -z, jadi layar menghadap ke sana.
      const cx = x + 0.5;
      const top = 0.78;
      const kind = Math.floor(h(1) * 3);
      if (kind === 0) {
        monitor(b, cx, top, z + 0.22);
      } else if (kind === 1) {
        monitor(b, cx - 0.3, top, z + 0.24, 0.5);
        monitor(b, cx + 0.3, top, z + 0.24, 0.5);
      } else {
        laptop(b, cx, top, z + 0.02);
      }
      if (kind !== 2) {
        b.box(0.42, 0.02, 0.14, 0x3a4055, cx, top + 0.01, z - 0.2); // keyboard
        b.box(0.06, 0.025, 0.1, DARK, cx + 0.32, top + 0.012, z - 0.2); // mouse
      }
      mug(b, cx - 0.7, top, z - 0.1 + h(2) * 0.3, h(3));
      if (h(4) < 0.7) paperStack(b, cx + 0.72, top, z - 0.05, h(5));
      if (h(6) < 0.5) deskLamp(b, cx - 0.8, top, z + 0.3);
      else smallPlant(b, cx - 0.82, top, z + 0.3);
      if (h(7) < 0.5) b.box(0.12, 0.05, 0.2, DARK, cx + 0.75, top + 0.025, z + 0.3); // telepon
      break;
    }
    case 'S':
      // Kursi kantor beroda
      b.box(0.46, 0.07, 0.46, 0x2f3648, x, 0.42, z);
      b.box(0.46, 0.5, 0.07, 0x2f3648, x, 0.72, z - 0.24);
      b.cyl(0.035, 0.035, 0.34, 0x555b6b, x, 0.2, z);
      b.box(0.5, 0.04, 0.07, 0x555b6b, x, 0.04, z);
      b.box(0.07, 0.04, 0.5, 0x555b6b, x, 0.04, z);
      break;
    case 'C':
      // Lemari arsip dengan laci
      b.box(0.94, 1.3, 0.94, 0x8a93a3, x, 0.65, z);
      for (const y of [0.28, 0.68, 1.08]) {
        b.box(0.84, 0.34, 0.02, 0x9aa3b3, x, y, z + 0.475);
        b.box(0.26, 0.04, 0.03, 0x4f5665, x, y + 0.06, z + 0.49);
      }
      if (h(1) < 0.6) b.box(0.4, 0.22, 0.3, 0xb98d5a, x + (h(2) - 0.5) * 0.3, 1.41, z); // kardus
      if (h(3) < 0.4) smallPlant(b, x + 0.25, 1.3, z + 0.2);
      break;
    case 'K': {
      // Rak buku: rangka kayu dan deretan buku di sisi depan
      b.box(0.98, 1.5, 0.7, 0x6e4a2c, x, 0.75, z - 0.12);
      for (let row = 0; row < 3; row++) {
        const y = 0.12 + row * 0.47;
        b.box(0.98, 0.04, 0.96, 0x8a5f3a, x, y, z);
        let bx = -0.42;
        for (let i = 0; bx < 0.36; i++) {
          const w = 0.07 + hash(f, tx, tz, row * 20 + i) * 0.07;
          const bh = 0.24 + hash(f, tx, tz, row * 20 + i + 50) * 0.14;
          if (hash(f, tx, tz, row * 20 + i + 90) > 0.12)
            b.box(w - 0.01, bh, 0.22, pick(BOOKS, hash(f, tx, tz, row * 20 + i + 7)), x + bx + w / 2, y + 0.02 + bh / 2, z + 0.34);
          bx += w;
        }
      }
      b.box(0.98, 0.04, 0.96, 0x8a5f3a, x, 1.52, z);
      break;
    }
    case 'T': {
      b.box(1, 0.06, 1, 0xffffff, x, 0.8, z);
      b.box(0.86, 0.76, 0.86, 0xd8d2c4, x, 0.38, z);
      const top = 0.83;
      const kind = Math.floor(h(1) * 4);
      if (kind === 0) {
        mug(b, x - 0.2, top, z + 0.1, h(2));
        mug(b, x + 0.15, top, z - 0.2, h(3));
      } else if (kind === 1) {
        b.cyl(0.16, 0.12, 0.03, 0xffffff, x, top + 0.015, z); // piring gorengan
        b.cyl(0.1, 0.1, 0.04, 0xd9903d, x, top + 0.045, z);
      } else if (kind === 2) {
        b.cyl(0.09, 0.11, 0.24, 0x2b2f3a, x, top + 0.12, z); // termos
        b.cyl(0.05, 0.09, 0.05, 0xb9bec9, x, top + 0.265, z);
        mug(b, x + 0.25, top, z + 0.2, h(2));
      } else {
        b.box(0.34, 0.1, 0.24, 0xe9c46a, x, top + 0.05, z, { ry: h(2) }); // kotak makan
        b.box(0.18, 0.015, 0.18, 0xffffff, x - 0.3, top + 0.008, z + 0.25); // tisu
      }
      // Bangku di sisi luar meja
      if (!same(0, 1) && tileAt(f, tx, tz + 1) === '.') b.cyl(0.16, 0.16, 0.06, 0xe2574c, x, 0.5, z + 0.62);
      if (!same(0, 1) && tileAt(f, tx, tz + 1) === '.') b.cyl(0.03, 0.06, 0.48, 0x555b6b, x, 0.24, z + 0.62);
      break;
    }
    case 'R': {
      b.box(1, 1.0, 1, 0x5a3b26, x, 0.5, z);
      b.box(1, 0.06, 1, 0x7a5236, x, 1.03, z);
      const top = 1.06;
      if (f === 0) {
        // Meja resepsionis
        if (!same(-1, 0)) monitor(b, x + 0.1, top, z + 0.1);
        else if (!same(1, 0)) {
          b.cyl(0.07, 0.09, 0.05, 0xd4af37, x, top + 0.025, z + 0.2); // bel
          b.box(0.3, 0.2, 0.02, 0xffffff, x - 0.1, top + 0.1, z - 0.2, { rx: -0.3 }); // papan nama
        } else if (h(1) < 0.5) paperStack(b, x, top, z, h(2));
        else b.box(0.12, 0.05, 0.2, DARK, x, top + 0.025, z);
      } else {
        // Meja meeting: laptop menghadap ke luar meja
        laptop(b, x, top, z, same(0, 1) ? 0 : Math.PI);
        mug(b, x + (same(1, 0) ? -0.32 : 0.32), top, z, h(3));
      }
      break;
    }
    case 'M':
      if ((tx + f) % 2 === 0) {
        // Mesin jajanan
        b.box(0.92, 1.7, 0.8, 0x2b2f3a, x, 0.85, z);
        b.box(0.92, 0.14, 0.82, 0xd43c3c, x, 1.63, z);
        b.box(0.56, 0.95, 0.02, 0xcfefff, x - 0.12, 1.0, z + 0.41, { glow: true });
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 4; col++)
            b.box(0.1, 0.16, 0.03, pick(BOOKS, hash(f, tx, tz, row * 4 + col)), x - 0.33 + col * 0.14, 0.7 + row * 0.3, z + 0.42, { glow: true });
        b.box(0.14, 0.3, 0.02, 0x4f5665, x + 0.32, 1.1, z + 0.41);
        b.box(0.5, 0.16, 0.02, 0x15181f, x - 0.12, 0.3, z + 0.41);
      } else {
        // Konter dengan mesin kopi
        b.box(1, 0.85, 1, 0xf3efe6, x, 0.425, z);
        b.box(1, 0.05, 1, 0x4f5665, x, 0.875, z);
        b.box(0.46, 0.5, 0.4, 0x23283a, x - 0.1, 1.15, z - 0.1);
        b.box(0.46, 0.08, 0.42, 0xb9bec9, x - 0.1, 1.42, z - 0.1);
        b.box(0.3, 0.04, 0.2, 0xb9bec9, x - 0.1, 0.92, z + 0.18);
        b.box(0.04, 0.04, 0.02, 0x4cd37b, x - 0.22, 1.3, z + 0.105, { glow: true });
        b.box(0.04, 0.04, 0.02, 0xff5a5f, x - 0.14, 1.3, z + 0.105, { glow: true });
        mug(b, x - 0.1, 0.94, z + 0.18, h(1));
        mug(b, x + 0.32, 0.9, z + 0.25, h(2));
        mug(b, x + 0.32, 0.9, z + 0.05, h(3));
      }
      break;
    case 'A':
      // Dispenser air galon
      b.box(0.42, 0.95, 0.42, 0xf3f5f8, x, 0.475, z);
      b.cyl(0.19, 0.19, 0.42, 0x5fb6f0, x, 1.17, z);
      b.cyl(0.07, 0.19, 0.08, 0x5fb6f0, x, 1.42, z);
      b.box(0.06, 0.06, 0.04, 0x3f8fd1, x - 0.08, 0.7, z + 0.22);
      b.box(0.06, 0.06, 0.04, 0xe2574c, x + 0.08, 0.7, z + 0.22);
      b.box(0.3, 0.03, 0.12, 0xb9bec9, x, 0.52, z + 0.25);
      break;
    case 'O': {
      // Sofa; sandarannya menempel ke dinding terdekat
      const vertical = same(0, 1) || same(0, -1);
      b.box(1, 0.36, 1, 0xf2b705, x, 0.18, z);
      if (vertical) {
        const side = tileAt(f, tx + 1, tz) === '#' ? 1 : -1;
        b.box(0.24, 0.8, 1, 0xd99e00, x + side * 0.38, 0.4, z);
        b.box(0.62, 0.12, 0.86, 0xffcf33, x - side * 0.1, 0.42, z);
        if (!same(0, -1)) b.box(0.9, 0.56, 0.16, 0xd99e00, x, 0.28, z - 0.42);
        if (!same(0, 1)) b.box(0.9, 0.56, 0.16, 0xd99e00, x, 0.28, z + 0.42);
      } else {
        b.box(1, 0.8, 0.24, 0xd99e00, x, 0.4, z - 0.38);
        b.box(0.86, 0.12, 0.62, 0xffcf33, x, 0.42, z + 0.1);
        if (!same(-1, 0)) b.box(0.16, 0.56, 0.9, 0xd99e00, x - 0.42, 0.28, z);
        if (!same(1, 0)) b.box(0.16, 0.56, 0.9, 0xd99e00, x + 0.42, 0.28, z);
      }
      if (h(1) < 0.5) b.box(0.3, 0.3, 0.12, 0x3f8fd1, x + (h(2) - 0.5) * 0.3, 0.6, z, { rx: -0.3, ry: vertical ? Math.PI / 2 : 0 }); // bantal
      break;
    }
    case 'F':
      // Printer / mesin fotokopi
      b.box(0.84, 0.72, 0.72, 0xdfe3ea, x, 0.36, z);
      b.box(0.88, 0.12, 0.76, 0x3a4055, x, 0.78, z);
      b.box(0.6, 0.03, 0.5, 0xf3f5f8, x - 0.05, 0.855, z);
      b.box(0.5, 0.03, 0.3, 0xffffff, x, 0.46, z + 0.46);
      b.box(0.7, 0.02, 0.02, 0x4f5665, x, 0.2, z + 0.365);
      b.box(0.16, 0.06, 0.02, 0x7fe0ff, x + 0.28, 0.62, z + 0.365, { glow: true });
      b.box(0.04, 0.04, 0.02, 0x4cd37b, x + 0.12, 0.62, z + 0.365, { glow: true });
      break;
    case 'L':
      // Lampu berdiri
      b.cyl(0.2, 0.22, 0.05, DARK, x, 0.025, z);
      b.cyl(0.025, 0.025, 1.45, 0x6b6f7a, x, 0.75, z);
      b.cyl(0.17, 0.28, 0.32, 0xffe2a0, x, 1.6, z, { glow: true });
      break;
    case 'P': {
      b.cyl(0.28, 0.2, 0.45, 0xb5633c, x, 0.225, z);
      b.cyl(0.25, 0.25, 0.03, 0x4a2c17, x, 0.44, z);
      for (const [ox, oy, oz, r] of [[0, 0.95, 0, 0.36], [0.18, 0.75, 0.1, 0.24], [-0.16, 0.8, -0.12, 0.26]])
        b.add(new THREE.IcosahedronGeometry(r, 0), 0x3f9d57, x + ox, oy, z + oz);
      break;
    }
    case 'W':
      // Papan kuning di sudut kiri-atas tiap genangan (genangannya digambar oleh WetLayer)
      if (!same(-1, 0) && !same(0, -1)) b.add(new THREE.ConeGeometry(0.22, 0.6, 4), 0xffd400, x - 0.2, 0.3, z - 0.2);
      break;
    case 'G':
      if (!same(-1, 0)) b.box(0.25, 2.0, 0.25, 0x2f8f57, x - 0.5, 1.0, z);
      if (!same(1, 0)) b.box(0.25, 2.0, 0.25, 0x2f8f57, x + 0.5, 1.0, z);
      break;
  }
}

/** Dinding beserta hiasan yang menempel di sisi yang menghadap kamera (sisi +z). */
function wall(b: Batch, f: number, tx: number, tz: number): void {
  const x = tx + 0.5;
  const z = tz + 0.5;
  const outer = tx === 0 || tz === 0 || tx === MAP_W - 1 || tz === MAP_H - 1;
  // Dinding luar berupa kaca biru seperti gedung kantor; dinding dalam putih gading.
  b.box(1, WALL_H, 1, outer ? 0x4a9bd1 : 0xe9e3d6, x, WALL_H / 2, z);
  b.box(1, 0.08, 1, 0xfaf7f0, x, WALL_H + 0.04, z);

  const south = tileAt(f, tx, tz + 1);
  if (south === '#' || tz === MAP_H - 1) return;
  const face = z + 0.51;
  if (outer) {
    b.box(0.06, WALL_H, 0.04, 0xfaf7f0, tx, WALL_H / 2, face); // kusen jendela
    return;
  }
  if (south !== '.' && south !== 'S' && south !== 'I') return; // tertutup perabot
  const h = hash(f, tx, tz, 3);
  const kind = Math.floor(hash(f, tx, tz, 4) * 6);
  if (h > 0.45) return;
  if (kind === 0) {
    // Papan tulis
    b.box(0.86, 0.56, 0.03, 0xb9bec9, x, 0.62, face);
    b.box(0.8, 0.5, 0.01, 0xffffff, x, 0.62, face + 0.02);
    b.box(0.4, 0.02, 0.01, 0x3f8fd1, x - 0.1, 0.72, face + 0.03, { glow: true });
    b.box(0.5, 0.02, 0.01, 0xe2574c, x, 0.6, face + 0.03, { glow: true });
  } else if (kind === 1) {
    // Jam dinding
    b.cyl(0.2, 0.2, 0.04, DARK, x, 0.72, face, { rx: Math.PI / 2 });
    b.cyl(0.17, 0.17, 0.01, 0xffffff, x, 0.72, face + 0.025, { rx: Math.PI / 2 });
    b.box(0.02, 0.12, 0.01, DARK, x, 0.77, face + 0.035);
    b.box(0.09, 0.02, 0.01, DARK, x + 0.04, 0.72, face + 0.035);
  } else if (kind === 2) {
    // AC
    b.box(0.86, 0.24, 0.2, 0xf3f5f8, x, 0.9, face + 0.08);
    b.box(0.7, 0.03, 0.02, 0x9aa3b3, x, 0.82, face + 0.185);
    b.box(0.04, 0.03, 0.02, 0x4cd37b, x + 0.34, 0.95, face + 0.185, { glow: true });
  } else if (kind === 3) {
    // Papan pengumuman
    b.box(0.8, 0.56, 0.03, 0xb98d5a, x, 0.62, face);
    for (let i = 0; i < 4; i++)
      b.box(0.16, 0.2, 0.01, pick([0xffffff, 0xfff2a0, 0xffc9de, 0xc9f0ff], hash(f, tx, tz, 10 + i)), x - 0.27 + i * 0.18, 0.58 + hash(f, tx, tz, 20 + i) * 0.12, face + 0.02);
  } else {
    // Poster berbingkai
    b.box(0.46, 0.6, 0.03, DARK, x, 0.62, face);
    b.box(0.4, 0.54, 0.01, pick(BOOKS, hash(f, tx, tz, 5)), x, 0.62, face + 0.02);
    b.box(0.24, 0.2, 0.01, 0xffffff, x, 0.7, face + 0.03);
  }
}

/** Anak tangga dari lantai bawah naik ke lantai atas, dalam koordinat lokal lantai bawah. */
function stairs(b: Batch, s: Stair): void {
  const alongX = s.dir === '>' || s.dir === '<';
  const length = alongX ? s.maxX - s.minX : s.maxZ - s.minZ;
  const width = alongX ? s.maxZ - s.minZ : s.maxX - s.minX;
  const steps = length * 3;
  const depth = length / steps;
  for (let i = 0; i < steps; i++) {
    // i = 0 adalah anak tangga paling atas
    const top = FLOOR_HEIGHT * (1 - (i + 0.5) / steps);
    const along = (i + 0.5) * depth;
    const pos = s.dir === '>' ? s.minX + along : s.dir === '<' ? s.maxX - along : s.dir === 'v' ? s.minZ + along : s.maxZ - along;
    const color = i % 2 === 0 ? 0xc3c8d2 : 0xb3b9c5;
    if (alongX) b.box(depth, top, width, color, pos, top / 2, (s.minZ + s.maxZ) / 2);
    else b.box(width, top, depth, color, (s.minX + s.maxX) / 2, top / 2, pos);
    // Lis kuning di tepi anak tangga
    if (alongX) b.box(0.05, 0.02, width, 0xffd21f, pos + (s.dir === '>' ? 1 : -1) * (depth / 2 - 0.03), top + 0.01, (s.minZ + s.maxZ) / 2);
    else b.box(width, 0.02, 0.05, 0xffd21f, (s.minX + s.maxX) / 2, top + 0.01, pos + (s.dir === 'v' ? 1 : -1) * (depth / 2 - 0.03));
  }
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

function buildFloor(f: number): THREE.Group {
  const group = new THREE.Group();
  group.position.y = f * FLOOR_HEIGHT;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: floorTexture(f), alphaTest: 0.5 }),
  );
  floor.position.set(MAP_W / 2, 0, MAP_H / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const batch = new Batch();
  const glow = lampGlow();
  for (let tz = 0; tz < MAP_H; tz++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const ch = FLOORS[f][tz][tx];
      if (ch === '#') wall(batch, f, tx, tz);
      else furnish(batch, f, tx, tz, ch);
      if (ch === 'L') {
        const pool = glow.clone();
        pool.position.set(tx + 0.5, 0.03, tz + 0.5);
        group.add(pool);
      }
    }
  }
  for (const s of STAIRS) if (s.upper - 1 === f) stairs(batch, s);
  batch.build(group);
  return group;
}

/** Membangun seluruh gedung; satu grup per lantai supaya lantai di atas pemain bisa disembunyikan. */
export function buildOffice(): THREE.Group[] {
  return Array.from({ length: FLOOR_COUNT }, (_, f) => buildFloor(f));
}

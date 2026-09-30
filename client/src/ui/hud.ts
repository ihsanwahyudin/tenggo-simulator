import {
  BUS,
  GUARD_FLOOR,
  LIFT_RECTS,
  LIFT_ZONES,
  MAP_H,
  MAP_W,
  OUTDOOR,
  PLANS,
  PUSH_COOLDOWN,
  ROAD,
  ZEBRAS,
  type FloorPlan,
  type ItemKind,
  type Phase,
  type PlayerState,
} from '@tenggo/shared';
import { ITEM_LABEL } from '../palette';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = (n: number) => String(n).padStart(2, '0');

const MINI = 4; // piksel minimap per tile
const WET_COLOR = '#6ec6ff';

// Petunjuk singkat di bawah jam, per lantai (indeks = nomor lantai)
const HINTS = ['seberangi jalan, naik bus!', 'lewati turnstile ke pintu putar', 'rebut lift!', 'jangan ketahuan HR · cari tangga', 'rebut lift!', 'cari tangga darurat'];
const FLOOR_NAMES = ['Jalan raya', 'Lobby', 'Lantai 2', 'Lantai 3', 'Lantai 4', 'Lantai 5'];

export interface HudState {
  phase: Phase;
  time: number;
  floor: number;
  place: number;
  total: number;
  state: PlayerState;
  stateT: number;
  rank: number;
  pushCd: number;
  item: ItemKind | null;
  dots: { x: number; z: number; color: string; me: boolean }[];
  wet: number[]; // kunci tile lokal di lantai ini
  det: number; // 0..1, seberapa dekat ketahuan penjaga
  guards: { x: number; z: number }[]; // penjaga di lantai yang sedang dilihat
  info: string; // keterangan situasi: lift, lampu penyeberangan, bus
  canUse: boolean; // sedang di dalam lift yang pintunya masih terbuka
}

/** Gambar dasar minimap satu lantai: ruangan, perabot, dinding, tangga, lift. */
function miniBase(plan: FloorPlan): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * MINI;
  canvas.height = MAP_H * MINI;
  const g = canvas.getContext('2d')!;
  const f = plan.no;
  g.fillStyle = '#59627a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (f === OUTDOOR) {
    g.fillStyle = '#2c3347';
    g.fillRect(0, 0, canvas.width, 3 * MINI);
    g.fillStyle = '#3a3f4c';
    g.fillRect(0, ROAD.z0 * MINI, canvas.width, (ROAD.z1 - ROAD.z0) * MINI);
    g.fillRect(0, BUS.z0 * MINI, canvas.width, (MAP_H - BUS.z0) * MINI);
    g.fillStyle = '#fff';
    for (const zb of ZEBRAS) g.fillRect(zb.x0 * MINI, ROAD.z0 * MINI, (zb.x1 - zb.x0) * MINI, (ROAD.z1 - ROAD.z0) * MINI);
    g.fillStyle = '#4cd37b';
    g.fillRect(BUS.x0 * MINI, BUS.z0 * MINI, (BUS.x1 - BUS.x0) * MINI, (BUS.z1 - BUS.z0) * MINI);
  }
  g.fillStyle = '#2c3347';
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) if (plan.solid[z * MAP_W + x]) g.fillRect(x * MINI, z * MINI, MINI, MINI);
  g.fillStyle = WET_COLOR;
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) if (plan.wetCells[z * MAP_W + x]) g.fillRect(x * MINI, z * MINI, MINI, MINI);

  // Tujuan lantai ini: tangga turun (kuning), lift turun (oranye), pintu putar (hijau)
  g.fillStyle = '#ffd21f';
  for (const s of plan.stairs) if (s.mode === 'turun') g.fillRect(s.x0 * MINI, (s.z0 - 1) * MINI, (s.x1 - s.x0) * MINI, (s.z1 - s.z0 + 1) * MINI);
  if (LIFT_ZONES.some((z) => z.top === f)) {
    g.fillStyle = '#ffb347';
    for (const [x0, z0, x1, z1] of LIFT_RECTS) g.fillRect(x0 * MINI, z0 * MINI, (x1 - x0) * MINI, (z1 - z0) * MINI);
  }
  if (f === 1) {
    g.fillStyle = '#4cd37b';
    g.fillRect(28 * MINI, (MAP_H - 1) * MINI, 4 * MINI, MINI);
  }

  // Dinding: sisi atas (h) dan sisi kiri (v) tiap tile
  g.fillStyle = '#0f131d';
  for (let z = 0; z <= MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) if (plan.h[z * MAP_W + x] && plan.hDyn[z * MAP_W + x] < 0) g.fillRect(x * MINI, z * MINI - 0.5, MINI, 1.5);
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x <= MAP_W; x++) if (plan.v[z * (MAP_W + 1) + x] && plan.vDyn[z * (MAP_W + 1) + x] < 0) g.fillRect(x * MINI - 0.5, z * MINI, 1.5, MINI);
  return canvas;
}

export class Hud {
  private root = $('hud');
  private clock = $('clock');
  private clockTime = $('clock-time');
  private clockSub = $('clock-sub');
  private banner = $('banner');
  private status = $('status');
  private alert = $('alert');
  private info = $('info');
  private pushBtn = $('btn-push');
  private throwBtn = $('btn-throw');
  private useBtn = $('btn-use');
  private mini = $<HTMLCanvasElement>('minimap');
  private miniBases = PLANS.map(miniBase);
  private lastSecond = -1;

  constructor(private onSecond: () => void) {
    this.mini.width = MAP_W * MINI;
    this.mini.height = MAP_H * MINI;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  flash(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // mengulang animasi
    this.banner.classList.add('show');
  }

  update(s: HudState): void {
    if (s.phase === 'desk') {
      const left = Math.max(0, Math.ceil(s.time));
      this.clock.classList.add('waiting');
      this.clockTime.textContent = left > 0 ? `16:59:${pad(60 - left)}` : '17:00:00';
      this.clockSub.textContent = 'Belum jam pulang… pura-pura kerja dulu';
      if (left !== this.lastSecond) {
        this.lastSecond = left;
        this.onSecond();
      }
    } else {
      this.clock.classList.remove('waiting');
      this.clockTime.textContent = `${pad(Math.floor(s.time / 60))}:${pad(Math.floor(s.time % 60))}.${Math.floor((s.time * 10) % 10)}`;
      this.clockSub.textContent = `Posisi ${s.place} dari ${s.total} · ${FLOOR_NAMES[s.floor]} · ${HINTS[s.floor]}`;
    }

    this.status.textContent =
      s.state === 'done'
        ? `Kamu sudah naik bus! Peringkat #${s.rank}. Menunggu yang lain…`
        : s.state === 'down'
          ? `Jatuh! Bangun dalam ${s.stateT.toFixed(1)}`
          : s.state === 'slip'
            ? 'Waduh…'
            : s.det > 0.05
              ? 'HR melihatmu! Sembunyi!'
              : '';
    this.alert.style.opacity = String(s.floor === GUARD_FLOOR ? s.det : 0);
    this.info.textContent = s.phase === 'race' ? s.info : '';
    this.useBtn.hidden = !s.canUse;

    this.pushBtn.style.setProperty('--cd', String(Math.min(1, s.pushCd / PUSH_COOLDOWN)));
    this.throwBtn.classList.toggle('off', !s.item);
    this.throwBtn.innerText = s.item ? ITEM_LABEL[s.item] : 'LEMPAR';

    const g = this.mini.getContext('2d')!;
    g.drawImage(this.miniBases[s.floor], 0, 0);
    g.fillStyle = WET_COLOR;
    for (const key of s.wet) g.fillRect((key % MAP_W) * MINI, Math.floor(key / MAP_W) * MINI, MINI, MINI);
    g.fillStyle = '#ff3b3b';
    for (const gd of s.guards) g.fillRect(gd.x * MINI - 3, gd.z * MINI - 3, 6, 6);
    for (const d of s.dots) {
      const r = d.me ? 4.5 : 3.5;
      g.beginPath();
      g.arc(d.x * MINI, d.z * MINI, r, 0, Math.PI * 2);
      g.fillStyle = d.color;
      g.fill();
      if (d.me) {
        g.lineWidth = 1.5;
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
  }
}

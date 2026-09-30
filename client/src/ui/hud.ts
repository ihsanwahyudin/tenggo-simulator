import { FLOORS, GUARD_FLOOR, MAP_H, MAP_W, PUSH_COOLDOWN, type ItemKind, type Phase, type PlayerState } from '@tenggo/shared';
import { ITEM_LABEL } from '../palette';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = (n: number) => String(n).padStart(2, '0');

const MINI_SCALE = 4;
const FLOOR_COLOR = '#59627a';
const STAIR_COLOR = '#ffd21f';
const MINI_COLORS: Record<string, string> = {
  '#': '#0f131d', W: '#6ec6ff', G: '#4cd37b',
  '.': FLOOR_COLOR, S: FLOOR_COLOR, I: FLOOR_COLOR,
  '>': STAIR_COLOR, '<': STAIR_COLOR, v: STAIR_COLOR, '^': STAIR_COLOR,
};

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
}

export class Hud {
  private root = $('hud');
  private clock = $('clock');
  private clockTime = $('clock-time');
  private clockSub = $('clock-sub');
  private banner = $('banner');
  private status = $('status');
  private alert = $('alert');
  private pushBtn = $('btn-push');
  private throwBtn = $('btn-throw');
  private mini = $<HTMLCanvasElement>('minimap');
  private miniBases: HTMLCanvasElement[];
  private lastSecond = -1;

  constructor(private onSecond: () => void) {
    this.mini.width = MAP_W * MINI_SCALE;
    this.mini.height = MAP_H * MINI_SCALE;
    // Satu gambar dasar per lantai
    this.miniBases = FLOORS.map((rows) => {
      const base = document.createElement('canvas');
      base.width = this.mini.width;
      base.height = this.mini.height;
      const g = base.getContext('2d')!;
      rows.forEach((row, tz) =>
        [...row].forEach((ch, tx) => {
          g.fillStyle = MINI_COLORS[ch] ?? '#2c3347'; // perabot
          g.fillRect(tx * MINI_SCALE, tz * MINI_SCALE, MINI_SCALE, MINI_SCALE);
        }),
      );
      return base;
    });
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
      this.clockSub.textContent = `Posisi ${s.place} dari ${s.total} · Lantai ${s.floor + 1}${s.floor === GUARD_FLOOR ? ' · jangan ketahuan HR!' : s.floor > 0 ? ' · cari tangga ▼' : ' · ke gerbang!'}`;
    }

    this.status.textContent =
      s.state === 'done'
        ? `Kamu sudah pulang! Peringkat #${s.rank}. Menunggu yang lain…`
        : s.state === 'down'
          ? `Jatuh! Bangun dalam ${s.stateT.toFixed(1)}`
          : s.state === 'slip'
            ? 'Waduh…'
            : s.det > 0.05
              ? 'HR melihatmu! Sembunyi!'
              : '';
    this.alert.style.opacity = String(s.det);

    this.pushBtn.style.setProperty('--cd', String(Math.min(1, s.pushCd / PUSH_COOLDOWN)));
    this.throwBtn.classList.toggle('off', !s.item);
    this.throwBtn.innerText = s.item ? ITEM_LABEL[s.item] : 'LEMPAR';

    const g = this.mini.getContext('2d')!;
    g.drawImage(this.miniBases[s.floor], 0, 0);
    g.fillStyle = MINI_COLORS.W;
    for (const key of s.wet) g.fillRect((key % MAP_W) * MINI_SCALE, Math.floor(key / MAP_W) * MINI_SCALE, MINI_SCALE, MINI_SCALE);
    g.fillStyle = '#ff3b3b';
    for (const gd of s.guards) g.fillRect(gd.x * MINI_SCALE - 3, gd.z * MINI_SCALE - 3, 6, 6);
    for (const d of s.dots) {
      const r = d.me ? 4 : 3;
      g.beginPath();
      g.arc(d.x * MINI_SCALE, d.z * MINI_SCALE, r, 0, Math.PI * 2);
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

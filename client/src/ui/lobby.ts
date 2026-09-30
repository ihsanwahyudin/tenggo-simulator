import type { RoomMsg } from '@tenggo/shared';
import { PLAYER_COLORS } from '../palette';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function playerRow(name: string, color: number, tag = ''): HTMLLIElement {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = PLAYER_COLORS[color % PLAYER_COLORS.length];
  const label = document.createElement('span');
  label.textContent = name;
  li.append(dot, label);
  if (tag) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    li.append(t);
  }
  return li;
}

export interface LobbyHandlers {
  create(name: string): void;
  join(code: string, name: string): void;
  start(): void;
}

export class LobbyUI {
  private home = $('home');
  private room = $('room');
  private error = $('home-error');
  private nameInput = $<HTMLInputElement>('name');
  private codeInput = $<HTMLInputElement>('code');

  constructor(handlers: LobbyHandlers) {
    this.nameInput.value = localStorage.getItem('tenggo-name') ?? '';
    this.codeInput.value = new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 4) ?? '';

    const name = () => {
      const n = this.nameInput.value.trim();
      localStorage.setItem('tenggo-name', n);
      return n;
    };
    $('create').addEventListener('click', () => handlers.create(name()));
    const join = () => {
      const code = this.codeInput.value.trim().toUpperCase();
      if (code.length !== 4) return this.showError('Kode room terdiri dari 4 huruf');
      handlers.join(code, name());
    };
    $('join').addEventListener('click', join);
    this.codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    $('start').addEventListener('click', () => handlers.start());
    $('copy').addEventListener('click', async () => {
      const btn = $('copy');
      try {
        await navigator.clipboard.writeText(location.href);
        btn.textContent = 'Link tersalin';
      } catch {
        btn.textContent = location.href;
      }
    });
  }

  showError(msg: string): void {
    this.error.textContent = msg;
  }

  showHome(error = ''): void {
    this.home.hidden = false;
    this.room.hidden = true;
    this.showError(error);
  }

  showRoom(room: RoomMsg, myId: number): void {
    this.home.hidden = true;
    this.room.hidden = false;
    $('room-code').textContent = room.code;
    $('copy').textContent = 'Salin link undangan';
    const list = $('players');
    list.replaceChildren(
      ...room.players.map((p) =>
        playerRow(p.name, p.color, [p.id === room.host ? 'host' : '', p.id === myId ? 'kamu' : ''].filter(Boolean).join(' · ')),
      ),
    );
    const isHost = room.host === myId;
    $('start').hidden = !isHost;
    $('room-hint').textContent = isHost
      ? room.players.length < 2
        ? 'Bagikan kode ke teman kantor, atau mulai sendiri untuk latihan.'
        : `${room.players.length} karyawan siap tenggo.`
      : 'Menunggu host memulai…';
  }

  hide(): void {
    this.home.hidden = true;
    this.room.hidden = true;
  }
}

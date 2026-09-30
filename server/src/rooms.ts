import type { WebSocket } from 'ws';
import { Room, send, type Member } from './game';

const rooms = new Map<string, Room>();
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return name || 'Karyawan';
}

export function handleConnection(ws: WebSocket): void {
  let room: Room | null = null;
  let me: Member | null = null;

  ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'create':
        if (room) return;
        room = new Room(newCode());
        rooms.set(room.code, room);
        me = room.add(nextId++, cleanName(msg.name), ws);
        break;
      case 'join': {
        if (room) return;
        const found = rooms.get(String(msg.code ?? '').toUpperCase());
        if (!found) return send(ws, { t: 'err', msg: 'Room tidak ditemukan' });
        const error = found.joinError;
        if (error) return send(ws, { t: 'err', msg: error });
        room = found;
        me = room.add(nextId++, cleanName(msg.name), ws);
        break;
      }
      case 'start':
        if (room && me) room.start(me.id);
        break;
      case 'lobby':
        if (room && me) room.toLobby(me.id);
        break;
      case 'in':
        if (room && me) room.input(me, msg);
        break;
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.remove(me.id);
    if (room.members.size === 0) rooms.delete(room.code);
  });
  ws.on('error', () => ws.close());
}

export function tickRooms(): void {
  for (const room of rooms.values()) room.tick();
}

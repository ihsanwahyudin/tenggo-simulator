import type { ItemKind, PlayerInput, PlayerState } from './physics';

export type Phase = 'lobby' | 'desk' | 'race' | 'result';

// Client -> server
export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'start' }
  | { t: 'lobby' }
  | ({ t: 'in' } & PlayerInput);

// Server -> client
export interface RosterPlayer {
  id: number;
  name: string;
  color: number;
}

export interface ResultRow extends RosterPlayer {
  rank: number; // 0 = tidak finis
  time: number;
}

export interface RoomMsg {
  t: 'room';
  code: string;
  phase: Phase;
  host: number;
  players: RosterPlayer[];
  results?: ResultRow[];
}

export interface SnapPlayer {
  id: number;
  fl: number; // lantai
  x: number;
  z: number;
  f: number;
  st: PlayerState;
  sT: number;
  dT: number;
  vx: number;
  vz: number;
  inv: number;
  cd: number;
  item: ItemKind | null;
  rank: number;
  det: number; // 0..1, seberapa dekat ketahuan penjaga
}

export interface SnapItem {
  id: number;
  k: ItemKind;
  f: number;
  x: number;
  z: number;
}

export interface SnapMsg {
  t: 'snap';
  phase: Phase;
  time: number; // fase desk: sisa detik menuju jam pulang; fase race: detik sejak teng
  ack: number; // nomor urut input terakhir milik penerima yang sudah diproses
  players: SnapPlayer[];
  items: SnapItem[];
  projs: SnapItem[];
  wet: number[]; // tileKey lantai basah dinamis
  jan: [number, number]; // petugas kebersihan, selalu di JANITOR_FLOOR
  hr: [number, number, number][]; // penjaga di GUARD_FLOOR: x, z, arah hadap
}

export type ServerMsg = RoomMsg | SnapMsg | { t: 'joined'; id: number; code: string } | { t: 'err'; msg: string };

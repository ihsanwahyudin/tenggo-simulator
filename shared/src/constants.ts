export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2;
export const MAX_PLAYERS = 8;

export const PLAYER_RADIUS = 0.35;
export const RUN_SPEED = 6;
export const WALK_SPEED = 2.6;

// Terpeleset di lantai basah
export const SLIP_SPEED = 7.5;
export const SLIP_TIME = 0.5;
export const SLIP_DOWN_TIME = 1.5;
export const SLIDE_DAMPING = 0.92;

// Dorong
export const PUSH_RANGE = 1.4;
export const PUSH_CONE = 0.4; // dot product minimum antara arah hadap dan arah ke target
export const PUSH_COOLDOWN = 1.5;
export const PUSH_DOWN_TIME = 2;
export const PUSH_SLIDE_SPEED = 5;
export const PUSH_SLIDE_TIME = 0.25;

// Lempar
export const THROW_DOWN_TIME = 2.5;
export const THROW_SLIDE_SPEED = 4;
export const THROW_SLIDE_TIME = 0.2;
export const PROJECTILE_HIT_RADIUS = PLAYER_RADIUS + 0.25;
export const PICKUP_RANGE = 0.8;
export const ITEM_RESPAWN = 8;
export const SPILL_TIME = 8;

export const INVULN_TIME = 1.5;

// Ronde
export const DESK_MIN = 5;
export const DESK_MAX = 10;
export const FINISH_GRACE = 45;
export const MAX_RACE_TIME = 180;

// Petugas kebersihan
export const JANITOR_SPEED = 1.6;
export const JANITOR_WET_TIME = 6;

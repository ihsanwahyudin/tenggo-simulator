export interface Move {
  x: number;
  z: number;
  walk: boolean;
}

/** Aksi sekali tekan; diambil lalu direset tiap tick. */
export interface Actions {
  push: boolean;
  throw: boolean;
}

const MAX_R = 45;
const DEAD_ZONE = 0.15;
const RUN_THRESHOLD = 0.6; // di bawah ini joystick dianggap jalan pelan

export class Joystick {
  active = false;
  private x = 0;
  private z = 0;
  private mag = 0;

  constructor(zone: HTMLElement, private knob: HTMLElement) {
    const update = (e: PointerEvent) => {
      const r = zone.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > MAX_R) {
        dx *= MAX_R / d;
        dy *= MAX_R / d;
      }
      this.mag = Math.min(d, MAX_R) / MAX_R;
      this.x = dx / MAX_R;
      this.z = dy / MAX_R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const release = () => {
      this.active = false;
      this.mag = 0;
      knob.style.transform = '';
    };
    zone.addEventListener('pointerdown', (e) => {
      this.active = true;
      update(e);
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => this.active && update(e));
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
  }

  move(): Move {
    if (this.mag < DEAD_ZONE) return { x: 0, z: 0, walk: false };
    // Dibulatkan supaya nilai yang dikirim ke server sama persis dengan yang dipakai prediksi.
    return {
      x: Math.round(this.x * 100) / 100,
      z: Math.round(this.z * 100) / 100,
      walk: this.mag < RUN_THRESHOLD,
    };
  }
}

export function bindActionButtons(actions: Actions, pushBtn: HTMLElement, throwBtn: HTMLElement): void {
  pushBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    actions.push = true;
  });
  throwBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    actions.throw = true;
  });
}

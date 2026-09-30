import type { Actions, Move } from './touch';

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Keyboard {
  private down = new Set<string>();

  constructor(actions: Actions) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === 'Space') actions.push = true;
      if (e.code === 'KeyE') actions.throw = true;
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private axis(neg: string[], pos: string[]): number {
    const has = (codes: string[]) => codes.some((c) => this.down.has(c));
    return (has(pos) ? 1 : 0) - (has(neg) ? 1 : 0);
  }

  move(): Move {
    return {
      x: this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
      z: this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      walk: this.down.has('ShiftLeft') || this.down.has('ShiftRight'),
    };
  }
}

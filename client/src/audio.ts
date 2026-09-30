// Semua efek suara disintesis dengan WebAudio, tanpa file aset.
let ctx: AudioContext | null = null;

/** Harus dipanggil dari gesture pengguna (klik tombol) agar browser mengizinkan suara. */
export function unlockAudio(): void {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, delay = 0, slideTo?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function noise(dur: number, gain: number) {
  if (!ctx) return;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buffer;
  g.gain.value = gain;
  src.connect(g).connect(ctx.destination);
  src.start();
}

export const sfx = {
  teng() {
    tone(1046, 1.8, 'sine', 0.35);
    tone(1568, 1.3, 'sine', 0.15);
    tone(2093, 0.9, 'triangle', 0.08);
  },
  tick: () => tone(900, 0.04, 'square', 0.04),
  bonk: () => tone(180, 0.2, 'square', 0.18, 0, 60),
  slip: () => tone(900, 0.35, 'sine', 0.15, 0, 200),
  whoosh: () => noise(0.15, 0.2),
  pickup() {
    tone(660, 0.07, 'triangle', 0.15);
    tone(990, 0.1, 'triangle', 0.15, 0.07);
  },
  caught() {
    tone(740, 0.16, 'square', 0.16);
    tone(520, 0.3, 'square', 0.16, 0.16);
  },
  finish: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.2, i * 0.1)),
};

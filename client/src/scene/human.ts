import * as THREE from 'three';
import { RUN_SPEED } from '@tenggo/shared';

export interface HumanStyle {
  shirt: THREE.ColorRepresentation;
  pants?: number;
  hair?: number;
  tie?: number | null;
  cap?: number; // topi menggantikan rambut
}

/** Tangan atau kaki dua ruas: pangkal (bahu/pinggul) dan sendi tengah (siku/lutut). */
interface Limb {
  root: THREE.Group;
  joint: THREE.Group;
}

export interface Human {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group; // badan; tas dan aksesori ditempel di sini agar ikut condong
  head: THREE.Group;
  legL: Limb;
  legR: Limb;
  armL: Limb;
  armR: Limb;
  phase: number; // posisi dalam siklus langkah
  seed: number; // supaya gerakan kecil tiap orang tidak serempak
  last: number; // waktu pose terakhir
}

export type HumanPose = 'stand' | 'seated' | 'slip' | 'down' | 'mop';

/** Ayunan pel kiri-kanan, -1..1. Dipakai pose 'mop' dan gagang pelnya supaya serempak. */
export const mopSway = (time: number) => Math.sin(time * 4.2);

/** Gerakan sesaat di atas pose dasar; t berjalan dari 0 ke 1. */
export interface HumanAction {
  kind: 'push' | 'throw';
  t: number;
}

const SKIN = 0xf2c9a0;
const HIP_Y = 0.44;
const mat = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });

function part(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** Dua ruas yang menggantung dari titik putarnya, dengan ujung (tangan atau sepatu) di ruas kedua. */
function limb(x: number, y: number, radius: number, upper: number, lower: number, color: THREE.ColorRepresentation, end: THREE.Mesh): Limb {
  const root = new THREE.Group();
  root.position.set(x, y, 0);
  const joint = new THREE.Group();
  joint.position.y = -upper;
  const segment = (length: number) => part(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 8), color, 0, -length / 2, 0);
  end.position.y -= lower;
  joint.add(segment(lower), end);
  root.add(segment(upper), part(new THREE.SphereGeometry(radius * 1.05, 8, 6), color, 0, -upper, 0), joint);
  return { root, joint };
}

/** Karyawan kartun: kepala besar, kemeja, celana, sepatu. Menghadap +z. */
export function buildHuman(style: HumanStyle): Human {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  const spine = new THREE.Group();
  spine.position.y = 0.02;
  const head = new THREE.Group();
  head.position.y = 0.6;
  const pants = style.pants ?? 0x2b3350;

  const leg = (x: number) => limb(x, 0, 0.085, 0.2, 0.2, pants, part(new THREE.BoxGeometry(0.15, 0.09, 0.25), 0x1a1a1f, 0, 0.005, 0.04));
  const arm = (x: number) => limb(x, 0.44, 0.065, 0.18, 0.17, style.shirt, part(new THREE.SphereGeometry(0.072, 10, 8), SKIN, 0, -0.01, 0));
  const legL = leg(-0.11);
  const legR = leg(0.11);
  const armL = arm(-0.29);
  const armR = arm(0.29);

  const torso = part(new THREE.CapsuleGeometry(0.2, 0.2, 4, 12), style.shirt, 0, 0.24, 0);
  torso.scale.set(1.15, 1, 0.8);
  spine.add(torso, armL.root, armR.root, head);
  if (style.tie !== null) {
    spine.add(
      part(new THREE.BoxGeometry(0.2, 0.06, 0.04), 0xffffff, 0, 0.46, 0.13), // kerah
      part(new THREE.BoxGeometry(0.065, 0.24, 0.03), style.tie ?? 0x23283a, 0, 0.31, 0.165),
    );
  }

  head.add(
    part(new THREE.SphereGeometry(0.23, 18, 14), SKIN, 0, 0.14, 0),
    part(new THREE.SphereGeometry(0.03, 8, 6), 0x1a1a1f, -0.085, 0.16, 0.205),
    part(new THREE.SphereGeometry(0.03, 8, 6), 0x1a1a1f, 0.085, 0.16, 0.205),
  );
  if (style.cap !== undefined) {
    head.add(
      part(new THREE.SphereGeometry(0.245, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), style.cap, 0, 0.16, 0),
      part(new THREE.BoxGeometry(0.3, 0.03, 0.2), style.cap, 0, 0.23, 0.24),
    );
  } else {
    // Rambut: tudung setengah bola yang dimiringkan ke belakang agar wajah terlihat.
    const hair = part(new THREE.SphereGeometry(0.248, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), style.hair ?? 0x2a1d16, 0, 0.15, 0);
    hair.rotation.x = -0.4;
    head.add(hair);
  }

  hips.add(part(new THREE.BoxGeometry(0.3, 0.1, 0.22), pants, 0, 0.01, 0), legL.root, legR.root, spine);
  root.add(hips);
  return { root, hips, spine, head, legL, legR, armL, armR, phase: 0, seed: Math.random() * 100, last: 0 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Menggerakkan seluruh badan. Sudut x negatif = mengayun ke depan; lutut dan siku menekuk dengan
 * x positif/negatif di sendinya. Siklus langkah maju menurut jarak yang ditempuh, bukan waktu,
 * sehingga kaki tidak terlihat meluncur di lantai.
 */
export function poseHuman(h: Human, pose: HumanPose, speed: number, time: number, action?: HumanAction | null): void {
  const dt = Math.max(0, Math.min(0.1, time - h.last));
  h.last = time;
  const k = 1 - Math.exp(-dt * 28);
  const gait = Math.max(0, Math.min(1, speed / RUN_SPEED));
  const t = time + h.seed;

  // Target tiap sendi
  let hipsY = 0, hipsYaw = 0, hipsRoll = 0;
  let spineX = 0, spineY = 0;
  let headX = 0, headY = 0;
  let lThigh = 0, rThigh = 0, lKnee = 0, rKnee = 0;
  let lArm = 0, rArm = 0, lOut = 0.06, rOut = 0.06, lElbow = -0.12, rElbow = -0.12;

  if (pose === 'seated') {
    // Duduk mengetik: paha ke depan, betis turun, jari-jari sibuk
    lThigh = rThigh = -1.5;
    lKnee = rKnee = 1.5;
    spineX = 0.12;
    headX = 0.18 + Math.sin(t * 0.7) * 0.05;
    headY = Math.sin(t * 0.4) * 0.15;
    lArm = rArm = -0.75;
    lElbow = -0.95 + Math.sin(t * 15) * 0.1;
    rElbow = -0.95 + Math.sin(t * 13 + 2) * 0.1;
  } else if (pose === 'slip') {
    // Terpeleset: badan ke belakang, kaki terlempar, tangan menggapai-gapai
    spineX = -0.4;
    headX = 0.35;
    lThigh = -1.2;
    rThigh = 0.35;
    lKnee = 0.25;
    rKnee = 1.0;
    lArm = -2.5 + Math.sin(t * 24) * 0.6;
    rArm = -2.5 + Math.sin(t * 24 + Math.PI) * 0.6;
    lOut = rOut = 0.55;
    lElbow = rElbow = -0.3;
  } else if (pose === 'down') {
    // Tergeletak pusing
    lThigh = 0.12;
    rThigh = -0.2;
    lKnee = 0.2;
    rKnee = 0.55;
    lOut = 1.25;
    rOut = 1.0;
    lElbow = -0.5;
    rElbow = -0.9;
    headY = Math.sin(t * 3) * 0.35;
  } else if (pose === 'mop') {
    // Mengepel sambil mundur: badan membungkuk, dua tangan memegang gagang di depan dan
    // menyapukannya kiri-kanan, kaki melangkah pendek ke belakang.
    h.phase -= (speed * dt * Math.PI * 2) / 0.9;
    const s = Math.sin(h.phase);
    const c = Math.cos(h.phase);
    const sway = mopSway(time);
    lThigh = -0.32 * s - 0.1;
    rThigh = 0.32 * s - 0.1;
    lKnee = 0.3 + 0.45 * Math.max(0, -c);
    rKnee = 0.3 + 0.45 * Math.max(0, c);
    hipsY = -0.04 + Math.cos(h.phase * 2) * 0.012;
    hipsYaw = -sway * 0.12;
    spineX = 0.42;
    spineY = sway * 0.4;
    headX = -0.05;
    headY = -sway * 0.2;
    // Tangan kanan di ujung gagang, tangan kiri lebih ke bawah; keduanya ikut menyapu
    lArm = -1.0 - sway * 0.12;
    rArm = -0.62 + sway * 0.12;
    lOut = -0.28;
    rOut = -0.32;
    lElbow = -0.35;
    rElbow = -1.0;
  } else if (gait > 0.04) {
    // Jalan dan lari
    const cycle = lerp(1.15, 2.1, gait); // jarak satu siklus penuh (dua langkah)
    h.phase += (speed * dt * Math.PI * 2) / cycle;
    const s = Math.sin(h.phase);
    const c = Math.cos(h.phase);
    const stride = lerp(0.5, 0.95, gait);
    const lift = 0.5 + gait * 0.95; // lutut menekuk saat kaki diayun ke depan
    lThigh = -stride * s;
    rThigh = stride * s;
    lKnee = 0.12 + lift * Math.max(0, c);
    rKnee = 0.12 + lift * Math.max(0, -c);
    lArm = stride * 0.85 * s;
    rArm = -stride * 0.85 * s;
    lElbow = rElbow = -(0.3 + gait * 1.15);
    lOut = rOut = 0.1;
    hipsY = -0.015 - gait * 0.03 + Math.cos(h.phase * 2) * 0.03 * (0.4 + gait);
    hipsYaw = s * 0.12;
    hipsRoll = c * 0.04;
    spineX = 0.05 + gait * 0.26;
    spineY = -s * 0.2 * (0.4 + gait) - hipsYaw;
    headX = -spineX * 0.7;
    headY = -spineY * 0.8 - hipsYaw;
  } else {
    // Berdiri diam: bernapas, berat badan berpindah pelan, sesekali menoleh
    hipsRoll = Math.sin(t * 0.8) * 0.025;
    hipsY = -Math.abs(hipsRoll) * 0.2;
    lArm = Math.sin(t * 1.3) * 0.05;
    rArm = Math.sin(t * 1.3 + 1.2) * 0.05;
    headY = Math.sin(t * 0.55) * 0.3;
    headX = Math.sin(t * 0.9) * 0.04;
  }

  if (action && pose === 'stand') {
    const e = Math.sin(Math.PI * Math.min(1, action.t)); // naik lalu turun
    if (action.kind === 'push') {
      // Dua tangan menyodok ke depan sambil badan menerjang
      lArm = lerp(lArm, -1.55, e);
      rArm = lerp(rArm, -1.55, e);
      lElbow = lerp(lElbow, -0.05, e);
      rElbow = lerp(rElbow, -0.05, e);
      lOut = rOut = lerp(lOut, 0.02, e);
      spineX += 0.4 * e;
      headX -= 0.25 * e;
    } else {
      // Lemparan dari atas bahu kanan: ayun ke belakang, lalu melecut ke depan
      const swing = lerp(-3.0, -0.7, Math.min(1, action.t * 1.4));
      rArm = lerp(rArm, swing, Math.min(1, e * 1.6));
      rElbow = lerp(rElbow, -0.25, e);
      spineY += lerp(-0.45, 0.35, action.t) * e;
      spineX += 0.15 * e;
    }
  }

  const to = (obj: THREE.Object3D, x: number, y = 0, z = 0) => {
    obj.rotation.x += (x - obj.rotation.x) * k;
    obj.rotation.y += (y - obj.rotation.y) * k;
    obj.rotation.z += (z - obj.rotation.z) * k;
  };
  h.hips.position.y += (HIP_Y + hipsY - h.hips.position.y) * k;
  to(h.hips, 0, hipsYaw, hipsRoll);
  to(h.spine, spineX, spineY, -hipsRoll * 1.5); // bahu tetap rata saat pinggul bergoyang
  h.spine.scale.y = 1 + Math.sin(t * 2.1) * 0.012; // napas
  to(h.head, headX, headY);
  to(h.legL.root, lThigh);
  to(h.legR.root, rThigh);
  to(h.legL.joint, lKnee);
  to(h.legR.joint, rKnee);
  to(h.armL.root, lArm, 0, -lOut);
  to(h.armR.root, rArm, 0, rOut);
  to(h.armL.joint, lElbow);
  to(h.armR.joint, rElbow);
}

/** Label nama yang selalu menghadap kamera. */
export function nameSprite(name: string, color = '#fff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  g.font = '800 36px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(20, 24, 36, 0.9)';
  g.strokeText(name, 128, 34);
  g.fillStyle = color;
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 2.25;
  sprite.renderOrder = 10;
  return sprite;
}

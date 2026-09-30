import * as THREE from 'three';
import type { ItemKind, PlayerState } from '@tenggo/shared';
import { buildHuman, nameSprite, poseHuman, type Human, type HumanAction, type HumanPose } from './human';
import { makeItemMesh } from './items';

export interface CharacterView {
  visible: boolean;
  label: boolean; // nama tampil menembus dinding, jadi disembunyikan untuk pemain di lantai lain
  x: number;
  y: number;
  z: number;
  face: number;
  state: PlayerState;
  invuln: boolean;
  item: ItemKind | null;
  pushCd: number; // cooldown dorong; lonjakannya menandai pemain baru saja mendorong
}

const HAIR = [0x2a1d16, 0x111111, 0x5a3a22, 0x8a5a2b, 0x3b2a4a, 0x703020];
const SCALE = 1.3;
const ACTION_TIME = 0.35;

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Character {
  readonly group = new THREE.Group();
  private yaw = new THREE.Group();
  private pose = new THREE.Group();
  private human: Human;
  private stars = new THREE.Group();
  private held: { kind: ItemKind; obj: THREE.Object3D } | null = null;
  private lastX = 0;
  private lastZ = 0;
  private speed = 0;
  private lastFace = 0;
  private lastCd = 0;
  private action: HumanAction | null = null;
  private label: THREE.Sprite;

  constructor(color: string, name: string, id: number, isMe: boolean) {
    this.human = buildHuman({ shirt: color, hair: HAIR[id % HAIR.length] });
    // Tas kerja di punggung
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.14), new THREE.MeshLambertMaterial({ color: 0x3a2f2a }));
    bag.position.set(0, 0.24, -0.23);
    bag.castShadow = true;
    this.human.spine.add(bag);
    this.human.root.scale.setScalar(SCALE);
    this.pose.add(this.human.root);
    this.yaw.add(this.pose);

    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
      const a = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
      this.stars.add(star);
    }
    this.stars.position.y = 0.9;

    this.label = nameSprite(name);
    this.group.add(this.yaw, this.stars, this.label);
    if (isMe) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.6, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      ring.position.y = 0.04;
      this.group.add(ring);
    }
  }

  update(v: CharacterView, time: number, dt: number): void {
    this.group.visible = v.visible && v.state !== 'done';
    this.label.visible = v.label;
    const speed = Math.hypot(v.x - this.lastX, v.z - this.lastZ) / Math.max(dt, 0.001);
    this.lastX = v.x;
    this.lastZ = v.z;
    this.group.position.set(v.x, v.y, v.z);

    const k = 1 - Math.exp(-dt * 18);
    this.speed += (speed - this.speed) * k;
    const before = this.yaw.rotation.y;
    this.yaw.rotation.y = lerpAngle(before, v.face, 1 - Math.exp(-dt * 14));
    const turnRate = (this.yaw.rotation.y - before) / Math.max(dt, 0.001);

    // Dorong terlihat dari cooldown yang melonjak; lempar dari item yang hilang saat masih berdiri.
    if (v.pushCd > this.lastCd + 0.5) this.action = { kind: 'push', t: 0 };
    else if (this.held && !v.item && v.state === 'active') this.action = { kind: 'throw', t: 0 };
    this.lastCd = v.pushCd;
    if (this.action && (this.action.t += dt / ACTION_TIME) >= 1) this.action = null;

    let tilt = 0;
    let roll = 0;
    let y = 0;
    let pose: HumanPose = 'stand';
    if (v.state === 'seated') pose = 'seated';
    else if (v.state === 'slip') {
      pose = 'slip';
      tilt = -0.7;
    } else if (v.state === 'down') {
      pose = 'down';
      tilt = -Math.PI / 2;
      y = 0.2;
    } else {
      // Miring ke dalam saat berbelok sambil lari
      roll = Math.max(-0.3, Math.min(0.3, -turnRate * 0.035)) * Math.min(1, this.speed / 4);
    }
    poseHuman(this.human, pose, this.speed / SCALE, time, this.action);
    // Jatuh terjadi cepat, bangun lebih lambat.
    const kPose = 1 - Math.exp(-dt * (Math.abs(tilt) > Math.abs(this.pose.rotation.x) ? 16 : 7));
    this.pose.rotation.x += (tilt - this.pose.rotation.x) * kPose;
    this.pose.rotation.z += (roll - this.pose.rotation.z) * k;
    this.pose.position.y += (y - this.pose.position.y) * kPose;
    this.pose.visible = !(v.invuln && Math.floor(time * 12) % 2 === 0);

    this.stars.visible = v.state === 'down';
    this.stars.rotation.y = time * 5;

    if (this.held?.kind !== v.item) {
      if (this.held) this.group.remove(this.held.obj);
      this.held = null;
      if (v.item) {
        const obj = makeItemMesh(v.item);
        obj.position.y = 1.85;
        this.group.add(obj);
        this.held = { kind: v.item, obj };
      }
    }
    if (this.held) this.held.obj.rotation.y = time * 3;
  }
}

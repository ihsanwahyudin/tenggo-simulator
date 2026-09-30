import * as THREE from 'three';
import {
  FLOOR_HEIGHT,
  GUARDS,
  GUARD_FLOOR,
  GUARD_SPEED,
  JANITOR_FLOOR,
  JANITOR_SPEED,
  VISION_HALF_ANGLE,
  VISION_RANGE,
  heightAt,
  sightDist,
  type ItemKind,
  type SnapItem,
} from '@tenggo/shared';
import { buildHuman, mopSway, nameSprite, poseHuman, type Human } from './human';

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

export function makeItemMesh(kind: ItemKind): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === 'stapler') {
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.16), lambert(0xe23b3b));
    top.position.y = 0.08;
    g.add(top, new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.18), lambert(0x444a5a)));
  } else if (kind === 'kertas') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })));
  } else {
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 10), lambert(0xffffff));
    lid.position.y = 0.15;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.28, 10), lambert(0x8a5a32)), lid);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

const ringGeometry = new THREE.RingGeometry(0.32, 0.42, 24).rotateX(-Math.PI / 2);
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8 });

const CONE_RAYS = 24;

export interface GuardView {
  x: number;
  z: number;
  face: number;
  moving: boolean;
}

/** HR atau manajer beserta area pandangnya di lantai. */
class GuardModel {
  readonly group = new THREE.Group();
  readonly cone: THREE.Mesh;
  private body: Human;
  private positions: THREE.BufferAttribute;
  private label: THREE.Sprite;

  constructor(name: string, index: number) {
    this.body = buildHuman({ shirt: index % 2 ? 0x5b2333 : 0x1f2a44, pants: 0x15181f, tie: 0xd43c3c, hair: index % 2 ? 0x8a8a8a : 0x111111 });
    this.body.root.scale.setScalar(1.4);
    this.label = nameSprite(name, '#ff6b6b');
    this.label.position.y = 2.4;
    this.group.add(this.body.root, this.label);

    // Kipas segitiga dari posisi penjaga; titik-titiknya dihitung ulang tiap frame mengikuti halangan.
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array((CONE_RAYS + 2) * 3), 3);
    geometry.setAttribute('position', this.positions);
    const index3: number[] = [];
    for (let i = 1; i <= CONE_RAYS; i++) index3.push(0, i, i + 1);
    geometry.setIndex(index3);
    this.cone = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.cone.frustumCulled = false;
    this.cone.renderOrder = 2;
  }

  /** label: nama tampil menembus lantai, jadi hanya dinyalakan saat pemain selantai dengan penjaga. */
  update(v: GuardView, visible: boolean, label: boolean, time: number): void {
    this.group.visible = this.cone.visible = visible;
    this.label.visible = label;
    if (!visible) return;
    const y = GUARD_FLOOR * FLOOR_HEIGHT;
    this.group.position.set(v.x, y, v.z);
    this.body.root.rotation.y = v.face;
    poseHuman(this.body, 'stand', v.moving ? GUARD_SPEED / 1.4 : 0, time);

    this.positions.setXYZ(0, v.x, y + 0.05, v.z);
    for (let i = 0; i <= CONE_RAYS; i++) {
      const angle = v.face - VISION_HALF_ANGLE + (i / CONE_RAYS) * VISION_HALF_ANGLE * 2;
      const d = sightDist(v.x, v.z, angle, VISION_RANGE);
      this.positions.setXYZ(i + 1, v.x + Math.sin(angle) * d, y + 0.05, v.z + Math.cos(angle) * d);
    }
    this.positions.needsUpdate = true;
  }
}

/** Objek dinamis selain pemain: item, proyektil, petugas kebersihan, penjaga. */
export class Props {
  private items = new Map<number, { kind: ItemKind; obj: THREE.Group }>();
  private projs = new Map<number, THREE.Object3D>();
  private janitor = new THREE.Group();
  private janitorBody: Human;
  private mop = new THREE.Group();
  private guards = GUARDS.map((def, i) => new GuardModel(def.name, i));

  constructor(private scene: THREE.Scene) {
    this.janitorBody = buildHuman({ shirt: 0x7d8797, pants: 0x4a5160, cap: 0xff8c1a, tie: null });
    this.janitorBody.root.scale.setScalar(1.3);
    // Pel dipegang di depan badan dan berayun kiri-kanan mengelilingi petugas.
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.34, 6), lambert(0xc9a26b));
    stick.position.set(0, 0.555, 0.8);
    stick.rotation.x = -0.735;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.24), lambert(0xf3f5f8));
    head.position.set(0, 0.05, 1.27);
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 0.12), lambert(0x3f6fa8));
    fringe.position.set(0, 0.03, 1.42);
    this.mop.add(stick, head, fringe);
    this.mop.traverse((o) => (o.castShadow = true));
    this.janitor.add(this.janitorBody.root, this.mop);
    this.janitor.visible = false;
    for (const g of this.guards) {
      g.group.visible = g.cone.visible = false;
      scene.add(g.group, g.cone);
    }
    scene.add(this.janitor);
  }

  /** visible(f) menentukan lantai mana yang sedang ditampilkan. */
  sync(items: SnapItem[], time: number, visible: (f: number) => boolean): void {
    const seen = new Set<number>();
    for (const it of items) {
      seen.add(it.id);
      let entry = this.items.get(it.id);
      if (entry && entry.kind !== it.k) {
        this.scene.remove(entry.obj);
        entry = undefined;
      }
      if (!entry) {
        const obj = new THREE.Group();
        const mesh = makeItemMesh(it.k);
        mesh.scale.setScalar(1.5);
        obj.add(mesh, new THREE.Mesh(ringGeometry, ringMaterial));
        obj.children[1].position.y = 0.03;
        obj.position.set(it.x, it.f * FLOOR_HEIGHT, it.z);
        this.scene.add(obj);
        entry = { kind: it.k, obj };
        this.items.set(it.id, entry);
      }
      entry.obj.visible = visible(it.f);
      const mesh = entry.obj.children[0];
      mesh.position.y = 0.5 + Math.sin(time * 3 + it.id) * 0.08;
      mesh.rotation.y = time * 2;
    }
    for (const [id, entry] of this.items) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.obj);
      this.items.delete(id);
    }
  }

  /** Posisi proyektil sudah diinterpolasi oleh pemanggil. */
  syncProjectiles(projs: SnapItem[], time: number, visible: (f: number) => boolean): void {
    const seen = new Set<number>();
    for (const p of projs) {
      seen.add(p.id);
      let obj = this.projs.get(p.id);
      if (!obj) {
        obj = makeItemMesh(p.k);
        this.scene.add(obj);
        this.projs.set(p.id, obj);
      }
      obj.visible = visible(p.f);
      obj.position.set(p.x, heightAt(p.f, p.x, p.z) + 0.9, p.z);
      obj.rotation.set(time * 12, time * 9, 0);
    }
    for (const [id, obj] of this.projs) {
      if (seen.has(id)) continue;
      this.scene.remove(obj);
      this.projs.delete(id);
    }
  }

  setJanitor(pos: { x: number; z: number; face: number; moving: boolean; visible: boolean } | null, time = 0): void {
    this.janitor.visible = !!pos?.visible;
    if (!pos) return;
    this.janitor.position.set(pos.x, JANITOR_FLOOR * FLOOR_HEIGHT, pos.z);
    // Mengepel sambil mundur: badan menghadap berlawanan dengan arah jalannya, sehingga pel
    // menyapu lantai yang baru ditinggalkan. Berbalik di tikungan dilakukan bertahap.
    let turn = (pos.face + Math.PI - this.janitor.rotation.y) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    this.janitor.rotation.y += turn * 0.15;
    this.mop.rotation.y = mopSway(time) * 0.45;
    poseHuman(this.janitorBody, 'mop', pos.moving ? JANITOR_SPEED / 1.3 : 0, time);
  }

  setGuards(views: GuardView[], visible: boolean, label: boolean, time: number): void {
    this.guards.forEach((g, i) => g.update(views[i] ?? { x: 0, z: 0, face: 0, moving: false }, visible && !!views[i], label, time));
  }

  clear(): void {
    this.setGuards([], false, false, 0);
    this.sync([], 0, () => false);
    this.syncProjectiles([], 0, () => false);
    this.setJanitor(null);
  }
}

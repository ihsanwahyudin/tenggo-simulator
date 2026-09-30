import * as THREE from 'three';
import {
  BUS,
  CAR_LENGTH,
  GUARDS,
  GUARD_FLOOR,
  GUARD_SPEED,
  JANITORS,
  JANITOR_SPEED,
  LIFT_RECTS,
  LIFT_ZONES,
  OUTDOOR,
  ROAD,
  VISION_HALF_ANGLE,
  VISION_RANGE,
  ZEBRAS,
  busDocked,
  busOffset,
  busWait,
  floorOffsetZ,
  floorY,
  heightAt,
  liftProgress,
  pedLight,
  sightDist,
  type ItemKind,
  type LiftCar,
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

/** Sosok yang berjalan sendiri (penjaga, petugas kebersihan) pada satu frame. */
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
    const y = floorY(GUARD_FLOOR);
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

const labelCache = new Map<string, THREE.CanvasTexture>();
/** Tekstur tulisan kecil (papan penunjuk lift dan halte); dibuat sekali per teks. */
function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const key = `${color}|${text}`;
  let tex = labelCache.get(key);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.fillStyle = 'rgba(20, 24, 36, 0.88)';
    g.beginPath();
    g.roundRect(4, 6, 248, 52, 12);
    g.fill();
    g.font = '900 32px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    labelCache.set(key, tex);
  }
  return tex;
}

function signSprite(): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.renderOrder = 9;
  return sprite;
}

function setSign(sprite: THREE.Sprite, text: string, color: string, visible: boolean): void {
  sprite.visible = visible && text !== '';
  if (!sprite.visible) return;
  const tex = labelTexture(text, color);
  if (sprite.material.map !== tex) {
    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
  }
}

/** Petugas kebersihan yang mengepel sambil mundur. */
class JanitorModel {
  readonly group = new THREE.Group();
  private body: Human;
  private mop = new THREE.Group();

  constructor(private floor: number) {
    this.body = buildHuman({ shirt: 0x7d8797, pants: 0x4a5160, cap: 0xff8c1a, tie: null });
    this.body.root.scale.setScalar(1.3);
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
    this.group.add(this.body.root, this.mop);
    this.group.visible = false;
  }

  update(v: GuardView | undefined, visible: boolean, time: number): void {
    this.group.visible = visible && !!v;
    if (!v || !visible) return;
    this.group.position.set(v.x, floorY(this.floor), v.z + floorOffsetZ(this.floor));
    // Badan menghadap berlawanan dengan arah jalannya, sehingga pel menyapu lantai yang baru
    // ditinggalkan. Berbalik di tikungan dilakukan bertahap.
    let turn = (v.face + Math.PI - this.group.rotation.y) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    this.group.rotation.y += turn * 0.15;
    this.mop.rotation.y = mopSway(time) * 0.45;
    poseHuman(this.body, 'mop', v.moving ? JANITOR_SPEED / 1.3 : 0, time);
  }
}

const DOOR_H = 1.15;

/** Satu kabin lift: lantai kabin yang naik-turun, pintu geser di lantai atas dan bawah, dan papan penunjuk. */
class LiftModel {
  readonly group = new THREE.Group();
  private cabin = new THREE.Group();
  private doors: { floor: number; panels: THREE.Mesh[]; open: number; sign: THREE.Sprite }[] = [];
  private x0: number;
  private zDoor: number;

  constructor(private zone: number, private car: number) {
    const [x0, z0, x1, z1] = LIFT_RECTS[car];
    this.x0 = x0;
    this.zDoor = z1;
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.14, d - 0.2), lambert(0xb9bec9));
    floor.position.y = -0.07;
    floor.receiveShadow = true;
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(w - 0.8, 0.02, d - 0.8), lambert(0x8a3b3b));
    carpet.position.y = 0.01;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w - 0.5, 0.06, 0.06), lambert(0xdfe3ea));
    rail.position.set(0, 0.9, -d / 2 + 0.25);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd21f }));
    panel.position.set(w / 2 - 0.5, 0.8, d / 2 - 0.22);
    this.cabin.add(floor, carpet, rail, panel);
    this.cabin.position.set(cx, 0, cz);
    this.group.add(this.cabin);

    const { top, bottom } = LIFT_ZONES[zone];
    for (const f of [top, bottom]) {
      const panels = [0, 1].map(() => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, DOOR_H, 0.1), lambert(0xc9ced8));
        m.castShadow = true;
        this.group.add(m);
        return m;
      });
      const sign = signSprite();
      sign.position.set(cx, floorY(f) + 2.0, z1 - 0.3);
      this.group.add(sign);
      this.doors.push({ floor: f, panels, open: f === top ? 1 : 0, sign });
    }
  }

  /** current(f): lantai yang sedang ditempati pemain; papan penunjuk hanya tampil di sana karena menembus lantai. */
  update(l: LiftCar, visible: (f: number) => boolean, current: (f: number) => boolean, dt: number): void {
    const { top, bottom } = LIFT_ZONES[this.zone];
    this.group.visible = visible(top) || visible(bottom);
    if (!this.group.visible) return;
    this.cabin.position.y = floorY(top) + (floorY(bottom) - floorY(top)) * liftProgress(l);

    for (const door of this.doors) {
      const isTop = door.floor === top;
      const want = l.phase === (isTop ? 'top' : 'bottom') ? 1 : 0;
      door.open += (want - door.open) * Math.min(1, dt * 9);
      const y = floorY(door.floor) + DOOR_H / 2;
      door.panels[0].position.set(this.x0 + 1.5 - door.open * 0.95, y, this.zDoor);
      door.panels[1].position.set(this.x0 + 2.5 + door.open * 0.95, y, this.zDoor);
      for (const p of door.panels) p.visible = visible(door.floor);

      let text = '';
      let color = '#ffd21f';
      if (isTop) {
        if (l.phase === 'top') [text, color] = l.t > 0 ? [`TUTUP ${Math.ceil(l.t)}`, '#ff8a3d'] : ['MASUK ▼', '#40e070'];
        else if (l.phase === 'up') text = `▲ ${Math.ceil(l.t)} dtk`;
        else text = l.phase === 'bottom' || l.phase === 'closingUp' ? 'DI BAWAH' : '▼ TURUN';
      } else if (l.phase === 'bottom') [text, color] = ['KELUAR', '#40e070'];
      setSign(door.sign, text, color, current(door.floor));
    }
  }
}

const CAR_COLORS = [0xd43c3c, 0xf2b705, 0x3f7fd1, 0xffffff, 0x2f9e44, 0x15181f, 0x9aa3b3, 0xff8c42];

function makeCar(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_LENGTH, 0.5, 1.3), lambert(color));
  body.position.y = 0.45;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR_LENGTH * 0.5, 0.42, 1.14), lambert(0x23283a));
  cabin.position.set(-0.15, 0.9, 0);
  const lights = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 1.1), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
  lights.position.set(CAR_LENGTH / 2, 0.5, 0);
  g.add(body, cabin, lights);
  for (const x of [-0.8, 0.8])
    for (const z of [-0.62, 0.62]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 10).rotateX(Math.PI / 2), lambert(0x15181f));
      wheel.position.set(x, 0.22, z);
      g.add(wheel);
    }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Bus TransJakarta tanpa atap (supaya penumpang terlihat dari atas), dengan tiga pintu di sisi peron. */
function makeBus(): THREE.Group {
  const g = new THREE.Group();
  const len = BUS.x1 - BUS.x0;
  const wid = BUS.z1 - BUS.z0;
  const add = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, basic = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color }) : lambert(color));
    m.position.set(x, y, z);
    m.castShadow = !basic;
    g.add(m);
  };
  add(len - 0.2, 0.2, wid - 0.2, 0x6b7a90, 0, 0.1, 0); // lantai bus
  add(len - 0.2, 1.0, 0.12, 0xf4f6f8, 0, 0.6, wid / 2 - 0.1); // sisi jauh
  add(len - 0.2, 0.22, 0.14, 0x1c4f9c, 0, 0.45, wid / 2 - 0.09);
  // Sisi peron: dinding di antara tiga pintu (pintu di x lokal -5..-3, 0..2, 5..7 dari tengah)
  const doors = [24, 29, 34].map((x) => x - (BUS.x0 + BUS.x1) / 2);
  let from = -len / 2 + 0.1;
  for (const dx of [...doors, len / 2 - 0.1]) {
    const to = dx;
    if (to - from > 0.05) {
      add(to - from, 1.0, 0.12, 0xf4f6f8, (from + to) / 2, 0.6, -wid / 2 + 0.1);
      add(to - from, 0.22, 0.14, 0x1c4f9c, (from + to) / 2, 0.45, -wid / 2 + 0.09);
    }
    from = dx + 2;
  }
  for (const s of [-1, 1]) {
    add(0.14, 1.5, wid - 0.2, 0xf4f6f8, s * (len / 2 - 0.12), 0.85, 0); // depan dan belakang
    add(0.16, 0.5, wid - 0.5, 0x23283a, s * (len / 2 - 0.12), 1.2, 0);
  }
  add(0.08, 0.2, wid - 0.6, 0xfff2b0, len / 2 - 0.02, 0.5, 0, true); // lampu depan
  for (let x = -len / 2 + 1.2; x < len / 2 - 1; x += 1.5) add(0.6, 0.5, 0.5, 0x2e86c1, x, 0.45, wid / 2 - 0.5); // kursi
  for (const x of [-len / 2 + 2, len / 2 - 2])
    for (const z of [-wid / 2 + 0.05, wid / 2 - 0.05]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 12).rotateX(Math.PI / 2), lambert(0x15181f));
      wheel.position.set(x, 0.1, z);
      g.add(wheel);
    }
  return g;
}

/** Semua yang bergerak di jalan: mobil, bus, lampu penyeberangan, dan papan info halte. */
class StreetModel {
  readonly group = new THREE.Group();
  private cars = new Map<number, THREE.Group>();
  private bus = makeBus();
  private busSign = signSprite();
  private platformDoors: THREE.Mesh[] = [];
  private lamps: { zebra: number; red: THREE.MeshBasicMaterial; green: THREE.MeshBasicMaterial }[] = [];

  constructor() {
    this.group.position.set(0, floorY(OUTDOOR), floorOffsetZ(OUTDOOR));
    this.bus.position.set((BUS.x0 + BUS.x1) / 2, 0, (BUS.z0 + BUS.z1) / 2);
    this.busSign.position.set((BUS.x0 + BUS.x1) / 2, 2.4, BUS.z1 + 0.6);
    this.busSign.scale.set(4, 1, 1);
    this.group.add(this.bus, this.busSign);

    // Pintu peron: tertutup saat tidak ada bus
    for (const x of [24, 29, 34]) {
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1.1, 0.1),
        new THREE.MeshLambertMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.7 }),
      );
      door.position.set(x + 1, 0.55, BUS.z0);
      this.platformDoors.push(door);
      this.group.add(door);
    }

    // Lampu penyeberangan di kedua ujung tiap zebra cross
    ZEBRAS.forEach((zb, zebra) => {
      for (const [x, z] of [[zb.x0 - 0.5, ROAD.z0 - 0.5], [zb.x1 + 0.5, ROAD.z1 + 0.3]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), lambert(0x3a4055));
        pole.position.set(x, 1.2, z);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.3), lambert(0x15181f));
        head.position.set(x, 2.6, z);
        const red = new THREE.MeshBasicMaterial({ color: 0x3a1414 });
        const green = new THREE.MeshBasicMaterial({ color: 0x143a1c });
        for (const [mat, y] of [[red, 2.8], [green, 2.4]] as const) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat);
          lamp.position.set(x, y, z);
          // Dilihat dari atas, lampu perlu menonjol ke atas supaya warnanya terbaca
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10), mat);
          cap.position.set(x + (mat === red ? -0.2 : 0.2), 3.03, z);
          this.group.add(lamp, cap);
        }
        this.lamps.push({ zebra, red, green });
        this.group.add(pole, head);
      }
    });
    this.group.visible = false;
  }

  /** cars: [id, lajur, x] yang sudah diinterpolasi pemanggil. */
  update(cars: [number, number, number][], time: number, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    const seen = new Set<number>();
    for (const [id, lane, x] of cars) {
      seen.add(id);
      let car = this.cars.get(id);
      if (!car) {
        car = makeCar(CAR_COLORS[id % CAR_COLORS.length]);
        this.cars.set(id, car);
        this.group.add(car);
      }
      car.position.set(x + CAR_LENGTH / 2, 0, ROAD.lanes[lane]);
    }
    for (const [id, car] of this.cars) {
      if (seen.has(id)) continue;
      this.group.remove(car);
      this.cars.delete(id);
    }

    this.bus.position.x = (BUS.x0 + BUS.x1) / 2 + busOffset(time);
    const docked = busDocked(time);
    for (const d of this.platformDoors) d.visible = !docked;
    const wait = busWait(time);
    setSign(this.busSign, docked ? 'NAIK SEKARANG!' : `BUS ${Math.ceil(wait)} dtk`, docked ? '#40e070' : '#ffd21f', true);

    const blinkOn = Math.floor(time * 5) % 2 === 0;
    for (const l of this.lamps) {
      const light = pedLight(l.zebra, time);
      l.red.color.setHex(light === 'stop' ? 0xff3b3b : 0x3a1414);
      l.green.color.setHex(light === 'go' || (light === 'blink' && blinkOn) ? 0x40e070 : 0x143a1c);
    }
  }
}

/** Objek dinamis selain pemain: item, proyektil, petugas kebersihan, penjaga, lift, dan lalu lintas. */
export class Props {
  private items = new Map<number, { kind: ItemKind; obj: THREE.Group }>();
  private projs = new Map<number, THREE.Object3D>();
  private janitors = JANITORS.map((j) => new JanitorModel(j.floor));
  private guards = GUARDS.map((def, i) => new GuardModel(def.name, i));
  private lifts = LIFT_ZONES.flatMap((_, zone) => [0, 1].map((car) => new LiftModel(zone, car)));
  private street = new StreetModel();

  constructor(private scene: THREE.Scene) {
    for (const g of this.guards) {
      g.group.visible = g.cone.visible = false;
      scene.add(g.group, g.cone);
    }
    for (const j of this.janitors) scene.add(j.group);
    for (const l of this.lifts) scene.add(l.group);
    scene.add(this.street.group);
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
        obj.position.set(it.x, floorY(it.f), it.z + floorOffsetZ(it.f));
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

  /** Posisi proyektil sudah diinterpolasi oleh pemanggil (koordinat lokal lantainya). */
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
      obj.position.set(p.x, heightAt(p.f, p.x, p.z) + 0.9, p.z + floorOffsetZ(p.f));
      obj.rotation.set(time * 12, time * 9, 0);
    }
    for (const [id, obj] of this.projs) {
      if (seen.has(id)) continue;
      this.scene.remove(obj);
      this.projs.delete(id);
    }
  }

  setJanitors(views: GuardView[], visible: (f: number) => boolean, time: number): void {
    this.janitors.forEach((j, i) => j.update(views[i], visible(JANITORS[i].floor), time));
  }

  setGuards(views: GuardView[], visible: boolean, label: boolean, time: number): void {
    this.guards.forEach((g, i) => g.update(views[i] ?? { x: 0, z: 0, face: 0, moving: false }, visible && !!views[i], label, time));
  }

  setLifts(lifts: LiftCar[], visible: (f: number) => boolean, current: (f: number) => boolean, dt: number): void {
    this.lifts.forEach((model, i) => lifts[i] && model.update(lifts[i], visible, current, dt));
  }

  setStreet(cars: [number, number, number][], time: number, visible: boolean): void {
    this.street.update(cars, time, visible);
  }

  clear(): void {
    const none = () => false;
    this.setGuards([], false, false, 0);
    this.sync([], 0, none);
    this.syncProjectiles([], 0, none);
    this.setJanitors([], none, 0);
    this.street.update([], 0, false);
    for (const l of this.lifts) l.group.visible = false;
  }
}

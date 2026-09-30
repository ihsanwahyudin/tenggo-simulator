import * as THREE from 'three';
import { MAP_H, MAP_W, PLANS } from '@tenggo/shared';

const PX = 16; // resolusi medan per tile; cukup rendah karena medannya halus

// Acak tapi tetap per tile, supaya bentuk genangan tidak berubah tiap digambar ulang.
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Semua lantai basah di satu lantai gedung digambar sebagai satu lapisan. Tiap tile basah menyumbang gumpalan lembut ke
 * sebuah tekstur "medan"; shader memotong medan itu di satu ambang, sehingga gumpalan yang
 * berdekatan menyatu jadi genangan berbentuk organik, bukan kotak per tile.
 */
export class WetLayer {
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private material: THREE.ShaderMaterial;
  private staticKeys: number[] = [];
  private current = '';

  /** parent adalah grup lantai gedung ke-floor; kunci tile di sini lokal per lantai (tz * MAP_W + tx). */
  constructor(parent: THREE.Object3D, floor: number) {
    this.canvas.width = MAP_W * PX;
    this.canvas.height = MAP_H * PX;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;

    PLANS[floor].wetCells.forEach((wet, key) => wet && this.staticKeys.push(key));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { field: { value: this.texture }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vPos;
        void main() {
          vUv = uv;
          vPos = (modelMatrix * vec4(position, 1.0)).xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D field;
        uniform float time;
        varying vec2 vUv;
        varying vec2 vPos;
        void main() {
          float f = texture2D(field, vUv).r;
          float inside = smoothstep(0.47, 0.53, f);
          if (inside < 0.01) discard;
          float depth = smoothstep(0.5, 0.95, f);
          vec3 col = mix(vec3(0.55, 0.80, 0.97), vec3(0.20, 0.50, 0.85), depth);
          // Pantulan cahaya yang bergerak pelan
          float ripple = sin(vPos.x * 5.0 + time * 1.3) * sin(vPos.y * 4.0 - time * 1.1)
                       + 0.5 * sin((vPos.x + vPos.y) * 9.0 + time * 2.0);
          col += 0.22 * smoothstep(0.75, 1.3, ripple);
          // Tepi terang seperti permukaan air yang melengkung
          float rim = 1.0 - smoothstep(0.53, 0.64, f);
          col = mix(col, vec3(1.0), rim * 0.55);
          gl_FragColor = vec4(col, inside * mix(0.62, 0.8, depth));
          #include <colorspace_fragment>
        }`,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2), this.material);
    plane.position.set(MAP_W / 2, 0.02, MAP_H / 2);
    plane.renderOrder = 1;
    parent.add(plane);
    this.setDynamic([]);
  }

  /** Menggambar ulang medan kalau kumpulan tile basah dinamis berubah. */
  setDynamic(keys: number[]): void {
    const signature = keys.join(',');
    if (signature === this.current && this.current !== '') return;
    this.current = signature || '-';

    const g = this.canvas.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.globalCompositeOperation = 'lighter';
    const blob = (x: number, z: number, radius: number) => {
      const grad = g.createRadialGradient(x * PX, z * PX, 0, x * PX, z * PX, radius * PX);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(1, '#000');
      g.fillStyle = grad;
      g.fillRect((x - radius) * PX, (z - radius) * PX, radius * 2 * PX, radius * 2 * PX);
    };
    for (const key of [...this.staticKeys, ...keys]) {
      const tx = key % MAP_W;
      const tz = Math.floor(key / MAP_W);
      // Gumpalan utama menutupi tile; dua gumpalan kecil membuat tepinya tidak beraturan.
      blob(tx + 0.5 + (hash(key) - 0.5) * 0.16, tz + 0.5 + (hash(key + 7) - 0.5) * 0.16, 1.05 + hash(key + 3) * 0.15);
      for (let i = 0; i < 2; i++) {
        const a = hash(key * 3 + i) * Math.PI * 2;
        blob(tx + 0.5 + Math.cos(a) * 0.38, tz + 0.5 + Math.sin(a) * 0.38, 0.45 + hash(key + i * 11) * 0.2);
      }
    }
    this.texture.needsUpdate = true;
  }

  update(time: number): void {
    this.material.uniforms.time.value = time;
  }
}

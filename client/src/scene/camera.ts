import * as THREE from 'three';

/** Kamera dari atas, sedikit miring, mengikuti pemain. */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private target = new THREE.Vector3(12, 0, 6);
  private height = 14;

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    // Layar portrait lebih sempit, jadi kamera dinaikkan agar sisi kiri-kanan tetap terlihat.
    this.height = w >= h ? 14 : 22;
    this.camera.updateProjectionMatrix();
  }

  follow(x: number, y: number, z: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.target.x += (x - this.target.x) * k;
    this.target.y += (y - this.target.y) * k;
    this.target.z += (z - this.target.z) * k;
    this.place(this.height);
  }

  /** Pemandangan ruang kerja untuk latar lobby. */
  overview(time: number, y: number): void {
    this.target.set(12 + Math.sin(time * 0.2) * 3, y, 7);
    this.place(this.height + 4);
  }

  private place(h: number): void {
    this.camera.position.set(this.target.x, this.target.y + h, this.target.z + h * 0.62);
    this.camera.lookAt(this.target);
  }
}

# Tenggo Simulator

Game balapan multiplayer: jam 17:00 teng, semua karyawan berebut keluar gerbang kantor.
Kamera dari atas, 2–8 pemain per room (bisa juga main sendiri untuk latihan).

## Cara main

1. Satu orang membuat room, lalu membagikan kode 4 huruf atau link undangan.
2. Host menekan **Mulai**. Semua duduk di meja sampai jam menunjukkan 17:00.
3. Begitu "teng", turun dari ruang kerja di lantai 3 lewat tangga (tanda kuning di lantai) ke lantai 2, lalu ke lobby di lantai 1, dan keluar lewat gerbang hijau bertuliskan PULANG.

| Aksi | Desktop | HP |
|---|---|---|
| Gerak | WASD / panah | Joystick kiri |
| Jalan pelan | Shift | Joystick ditekan setengah |
| Dorong | Spasi | Tombol DORONG |
| Lempar | E / klik | Tombol LEMPAR |

- **Lantai basah** (biru mengilap): lari di atasnya bikin terpeleset. Jalan pelan aman.
- **Tangga** sempit dan jadi tempat rebutan; dorongan dan lemparan hanya mengenai pemain di lantai yang sama (atau sama-sama di tangga).
- **Petak umpet di lantai 2**: HR dan Manajer berpatroli bolak-balik. Area merah di lantai adalah pandangan mereka; terlihat sekitar 0,3 detik (tepi layar memerah) berarti ketahuan dan dikembalikan ke lantai 3 tanpa item. Dinding, lemari, rak, mesin, dan tanaman menghalangi pandangan; tangga adalah zona aman. Menempel ke mereka juga ketahuan, dari arah mana pun.
- **Petugas kebersihan** di lobby meninggalkan jejak basah yang kering setelah beberapa detik.
- **Dorong** menjatuhkan lawan di depanmu selama 2 detik.
- **Item** (stapler, gumpalan kertas, gelas kopi) dipungut dengan melewatinya, lalu dilempar lurus ke arah hadap. Kopi meninggalkan genangan.
- Setelah bangun, pemain kebal 1,5 detik (berkedip) dan selama itu juga tidak terpeleset.

## Menjalankan di lokal

Butuh Node.js 22 atau lebih baru.

```bash
npm install
npm run dev
```

Buka http://localhost:5173. Untuk mencoba multiplayer, buka tab kedua dan gabung dengan kode room.

Perintah lain:

```bash
npm test          # unit test aturan game
npm run typecheck
npm run build     # build client ke client/dist
npm start         # server produksi: game + WebSocket di satu port (default 3000)
```

## Struktur

- `shared/` — aturan game murni (denah, fisika, serangan, protokol). Dipakai server dan client.
- `server/` — server otoritatif: room, loop 30 tick/detik, WebSocket (`ws`), dan penyaji file client.
- `client/` — Vite + Three.js: scene 3D, input, HUD, lobby.

Server yang menentukan posisi semua pemain; client hanya mengirim input dan memprediksi
gerakan pemain sendiri dengan fungsi `stepPlayer` yang sama, lalu dikoreksi dari snapshot server.

Denah tiap lantai ada di `shared/src/map.ts` berupa ASCII dan bisa diubah langsung; legenda hurufnya (meja, rak, sofa, tangga, dan lain-lain) ada di bagian atas file itu. Angka seperti
kecepatan, durasi jatuh, dan cooldown ada di `shared/src/constants.ts`.

## Deploy

Game memakai WebSocket, jadi butuh hosting yang menjalankan proses Node terus-menerus
(Render, Railway, Fly.io, VPS), bukan hosting statis. `Dockerfile` sudah disiapkan:

```bash
docker build -t tenggo-simulator .
docker run -p 3000:3000 tenggo-simulator
```

Server membaca port dari variabel `PORT`. State room disimpan di memori, jadi jalankan
satu instance saja; semua room hilang saat server restart.

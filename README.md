# Tenggo Simulator

Game balapan multiplayer: jam 17:00 teng, semua karyawan berebut pulang — turun lima lantai,
menyeberang jalan, dan naik bus TransJakarta. Kamera dari atas, 2–8 pemain per room (bisa juga
main sendiri untuk latihan).

## Cara main

1. Satu orang membuat room, lalu membagikan kode 4 huruf atau link undangan.
2. Host menekan **Mulai**. Semua duduk di meja sampai jam menunjukkan 17:00.
3. Begitu "teng", cari jalan turun. Finis dihitung saat masuk ke dalam bus.

| Level | Isi | Cara turun |
|---|---|---|
| Lantai 5 | Ruang kerja open-plan (start) | Tangga darurat di ujung barat atau timur |
| Lantai 4 | Labirin ruang rapat | Hanya dua lift |
| Lantai 3 | HR & Direksi, petak umpet dengan tiga penjaga | Tangga darurat |
| Lantai 2 | Kantin, musholla, game room; lantai licin | Hanya dua lift |
| Lantai 1 | Lobby: turnstile, kedai kopi | Pintu putar |
| Jalan raya | Zebra cross berlampu, halte, bus | Naik bus = finis |

| Aksi | Desktop | HP |
|---|---|---|
| Gerak | WASD / panah | Joystick kiri |
| Jalan pelan | Shift | Joystick ditekan setengah |
| Dorong | Spasi | Tombol DORONG |
| Lempar | E / klik | Tombol LEMPAR |
| Tutup pintu lift | F | Tombol TUTUP PINTU LIFT |

- **Sekat dan pintu**: dinding tipis berada di garis antar tile. Pintu bergaris oranye hanya muat satu orang.
- **Lantai basah** (biru mengilap): lari di atasnya bikin terpeleset. Jalan pelan aman. Petugas kebersihan di Lantai 2 dan lobby meninggalkan jejak basah.
- **Lift**: tiap kabin muat 4 orang dan menunggu di atas dengan pintu terbuka. Pintu menutup sendiri 4 detik setelah orang pertama masuk, atau langsung bila ada yang menekan tombol tutup pintu. Yang terlambat menunggu kabin turun, menurunkan penumpang, dan naik lagi (±8–10 detik), atau pindah ke lift satunya.
- **Petak umpet di Lantai 3**: HR, Manajer, dan Direktur berkeliling. Area merah di lantai adalah pandangan mereka; terlihat sekitar 0,3 detik (tepi layar memerah) berarti ketahuan dan dikembalikan ke lobi lift Lantai 4 tanpa item. Dinding dan perabot tinggi menghalangi pandangan; tangga dan kabin lift adalah zona aman.
- **Menyeberang**: jalan hanya bisa diseberangi di dua zebra cross yang lampunya bergantian. Menerobos saat merah boleh, tetapi tertabrak mobil yang melaju mengembalikan pemain ke depan pintu lobby.
- **Halte dan bus**: masuk peron lewat gate tap-in sempit. Bus berhenti 6 detik lalu pergi; bus berikutnya datang 10 detik kemudian.
- **Dorong** menjatuhkan lawan di depanmu selama 2 detik. **Item** (stapler, gumpalan kertas, gelas kopi) dipungut dengan melewatinya, lalu dilempar lurus. Keduanya tidak menembus dinding.
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
npm run bot       # bot yang memainkan satu ronde sendiri melawan server lokal
npm run bot -- KODE   # bot bergabung ke room KODE sebagai lawan
```

## Struktur

- `shared/` — aturan game murni (denah, fisika, serangan, protokol). Dipakai server dan client.
- `server/` — server otoritatif: room, loop 30 tick/detik, WebSocket (`ws`), dan penyaji file client.
- `client/` — Vite + Three.js: scene 3D, input, HUD, lobby.

Server yang menentukan posisi semua pemain; client hanya mengirim input dan memprediksi
gerakan pemain sendiri dengan fungsi `stepPlayer` yang sama, lalu dikoreksi dari snapshot server.

Denah semua lantai ditulis di `shared/src/building.ts`: ruangan, pintu, dan perabot ditaruh lewat
pemanggilan fungsi (`room`, `door`, `put`), lalu server, client, dan minimap membacanya dari sana.
Aturan lift ada di `shared/src/lifts.ts`, lalu lintas dan bus di `shared/src/street.ts`, penjaga di
`shared/src/guards.ts`, dan angka umum seperti kecepatan dan durasi jatuh di `shared/src/constants.ts`.

Gambar rancangan awal gedung ada di `design/` (dibuat oleh `design/office-design.mjs`). Itu arsip
desain; setelah denah dipindahkan ke `building.ts`, perubahan di sana tidak otomatis ikut ke gambar.

## Deploy

Game memakai WebSocket, jadi butuh hosting yang menjalankan proses Node terus-menerus
(Render, Railway, Fly.io, VPS), bukan hosting statis. `Dockerfile` sudah disiapkan:

```bash
docker build -t tenggo-simulator .
docker run -p 3000:3000 tenggo-simulator
```

Server membaca port dari variabel `PORT`. State room disimpan di memori, jadi jalankan
satu instance saja; semua room hilang saat server restart.

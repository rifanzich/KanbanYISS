# Kanban YISS — Portal Kerja Tim (versi Next.js + Vercel)

Versi ini punya backend sungguhan: autentikasi dengan password yang di-hash,
sesi login lewat cookie, dan data tersimpan di **Redis** (lewat integrasi
Redis dari Vercel Marketplace) sehingga "Ruang Tim" benar-benar tersinkron
antar semua anggota, bukan cuma tersimpan lokal di satu perangkat.

> Catatan: Vercel KV sudah dihentikan (deprecated) oleh Vercel, jadi versi ini
> memakai integrasi **Redis** biasa dari Vercel Marketplace sebagai gantinya.

## Cara deploy ke Vercel

1. **Push folder ini ke repo GitHub baru** (lewat github.com atau GitHub
   Desktop — buat repo kosong, lalu upload/push seluruh isi folder ini).

2. **Import project di Vercel**
   - Buka vercel.com/new, pilih repo GitHub tadi, klik **Import**.
   - Framework otomatis terdeteksi sebagai **Next.js** — tidak perlu ubah apa-apa.

3. **Tambahkan integrasi Redis**
   - Di dashboard project Vercel → tab **Storage** → cari **Redis** di bagian Marketplace Database Providers → **Create/Install**.
   - Pilih region & paket (ada paket gratis/Essentials), lalu hubungkan ke project ini.
   - Vercel otomatis menambahkan env var `REDIS_URL` — tidak perlu diisi manual.

4. **Tambahkan environment variable `AUTH_SECRET`**
   - Di project Settings → **Environment Variables**.
   - Tambahkan `AUTH_SECRET` = string acak yang panjang (misalnya hasil dari `openssl rand -hex 32`, atau ketik sembarang teks panjang & rahasia).
   - Ini dipakai untuk menandatangani sesi login, jadi rahasiakan dan jangan dibagikan.

5. **Redeploy**
   - Karena env var ditambahkan setelah project dibuat, klik **Deployments** → titik tiga pada deployment terakhir → **Redeploy** (env var baru tidak otomatis dipakai deployment lama).

6. **Buka linknya** — pertama kali dibuka akan diminta membuat **akun admin pertama**. Setelah itu, akun-akun lain (termasuk `moh01`) bisa ditambahkan lewat panel **Kelola Akun** di sidebar (khusus admin).

## Jenis akun & alur pengajuan (form dari luar tim media)

**Jenis akun**

| Jenis | Untuk siapa | Bisa apa |
|---|---|---|
| **Admin** | Pengelola portal | Semua fitur, kelola akun, atur ruang tim & papan penerima pengajuan |
| **Operator** | Anggota tim media (sebelumnya "Anggota") | Ruang kerja & papan, menerima pengajuan |
| **Submitter** | Orang di luar tim media | Hanya mengajukan pekerjaan & memantau progres pengajuannya sendiri |

Akun lama yang tersimpan sebagai "Anggota" otomatis dibaca sebagai **Operator** — tidak perlu migrasi.
Admin bisa mengganti jenis akun lewat **Kelola Akun → ikon pensil** (tidak bisa mengubah jenis akunnya sendiri).

**Alur**

1. Admin membuka sebuah papan di **ruang kerja Tim** milik tim media → klik **"Jadikan papan penerima pengajuan"** (cukup sekali; pastikan semua operator sudah ada di anggota ruang tim itu).
2. Buat akun **Submitter** untuk orang di luar tim (Kelola Akun). Saat login mereka langsung masuk ke dashboard pengajuan.
3. Submitter klik **Ajukan Pekerjaan** → isi judul, jenis, jumlah, tenggat, detail, link.
4. Pengajuan otomatis menjadi kartu di **kolom pertama** papan penerima (tanda "Pengajuan dari …"), dan tampil di menu **Pengajuan Masuk** milik operator/admin.
5. Operator klik **Terima pekerjaan** (di kartu atau di Pengajuan Masuk) → otomatis tercatat di **Tim terlibat**. Beberapa operator boleh menerima kartu yang sama.
6. Submitter melihat progres: **Diajukan → Diterima → Dikerjakan → Selesai**, mengikuti posisi kartu di papan (kolom 1/2/3) dan siapa yang sudah menerima.

**Catatan teknis**

- Pengajuan disimpan di Redis dengan key `request:<id>`; papan penerima di `config:intake`.
- Kartu dibuat oleh aplikasi operator/admin yang sedang terbuka di ruang penerima (bukan langsung oleh server), jadi pengajuan masuk ke papan begitu ada operator/admin yang membuka ruang tersebut (maks. ±30 detik setelah dibuka). Selama belum ada yang membukanya, pengajuan tetap tersimpan dan statusnya "Menunggu".
- Kartu pengajuan yang dihapus tim tidak dibuat ulang; di sisi submitter statusnya menjadi "Kartu dihapus oleh tim media".
- Submitter tidak bisa membaca ruang kerja tim maupun daftar akun; mereka hanya bisa melihat pengajuannya sendiri.
- Sesi kini dicek ke data akun terbaru di setiap request, jadi perubahan jenis akun atau penghapusan akun langsung berlaku.

## Menjalankan secara lokal (opsional, untuk uji coba)

```bash
npm install
# butuh env var REDIS_URL (dari integrasi Redis di Vercel, atau Redis lokal), dan AUTH_SECRET
npm run dev
```

## Struktur penting

- `app/api/auth/*` — endpoint login, setup akun admin pertama, kelola akun, sesi.
- `app/api/requests/*` — pengajuan dari submitter, penandaan masuk-papan, dan pengaturan papan penerima.
- `app/api/kv/*` — endpoint penyimpanan data generik (papan, catatan, anggota) yang menggantikan `window.storage` versi Claude.
- `components/RuangWorkspace.jsx` — seluruh tampilan & logika aplikasi (kanban, catatan, checklist, durasi, notifikasi, ekspor Excel) — sama persis dengan versi sebelumnya.
- `lib/auth.js` — helper autentikasi (JWT + cookie).
- `lib/roles.js` — jenis akun (admin/operator/submitter).
- `lib/requests.js`, `lib/requestProgress.js` — penyimpanan pengajuan dan penghitungan progres dari kartu.
- `components/SubmitterPortal.jsx` (dashboard submitter), `components/RequestsInbox.jsx` (Pengajuan Masuk untuk tim).
- `lib/redisClient.js`, `lib/kv.js` — koneksi Redis dan helper penyimpanan data.

## Catatan keamanan

- Password disimpan sebagai **hash bcrypt**, bukan teks biasa — jauh lebih aman dari versi Claude/PWA sebelumnya.
- Sesi login disimpan di **cookie httpOnly** (tidak bisa diakses lewat JavaScript di browser), berlaku 30 hari.
- Tetap ganti `AUTH_SECRET` dengan nilai unik milikmu sendiri sebelum deploy ke publik.

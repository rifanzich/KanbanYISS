# Ruang — Portal Kerja Tim (versi Next.js + Vercel)

Versi ini punya backend sungguhan: autentikasi dengan password yang di-hash,
sesi login lewat cookie, dan data tersimpan di **Vercel KV** (database
key-value berbasis Redis) sehingga "Ruang Tim" benar-benar tersinkron antar
semua anggota, bukan cuma tersimpan lokal di satu perangkat.

## Cara deploy ke Vercel

1. **Push folder ini ke repo GitHub baru** (lewat github.com atau GitHub
   Desktop — buat repo kosong, lalu upload/push seluruh isi folder ini).

2. **Import project di Vercel**
   - Buka vercel.com/new, pilih repo GitHub tadi, klik **Import**.
   - Framework otomatis terdeteksi sebagai **Next.js** — tidak perlu ubah apa-apa.

3. **Tambahkan database Vercel KV**
   - Di dashboard project Vercel → tab **Storage** → **Create Database** → pilih **KV**.
   - Setelah dibuat, klik **Connect Project** dan hubungkan ke project ini.
   - Vercel otomatis menambahkan env var `KV_REST_API_URL` dan `KV_REST_API_TOKEN` — tidak perlu diisi manual.

4. **Tambahkan environment variable `AUTH_SECRET`**
   - Di project Settings → **Environment Variables**.
   - Tambahkan `AUTH_SECRET` = string acak yang panjang (misalnya hasil dari `openssl rand -hex 32`, atau ketik sembarang teks panjang & rahasia).
   - Ini dipakai untuk menandatangani sesi login, jadi rahasiakan dan jangan dibagikan.

5. **Deploy**
   - Klik **Deploy**. Setelah selesai, kamu akan dapat link seperti `https://nama-project.vercel.app`.

6. **Buka linknya** — pertama kali dibuka akan diminta membuat **akun admin pertama**. Setelah itu, akun-akun lain (termasuk `moh01`) bisa ditambahkan lewat panel **Kelola Akun** di sidebar (khusus admin).

## Menjalankan secara lokal (opsional, untuk uji coba)

```bash
npm install
# butuh env var KV_REST_API_URL, KV_REST_API_TOKEN (dari Vercel KV), dan AUTH_SECRET
npm run dev
```

## Struktur penting

- `app/api/auth/*` — endpoint login, setup akun admin pertama, kelola akun, sesi.
- `app/api/kv/*` — endpoint penyimpanan data generik (papan, catatan, anggota) yang menggantikan `window.storage` versi Claude.
- `components/RuangWorkspace.jsx` — seluruh tampilan & logika aplikasi (kanban, catatan, checklist, durasi, notifikasi, ekspor Excel) — sama persis dengan versi sebelumnya.
- `lib/auth.js`, `lib/kv.js` — helper autentikasi (JWT + cookie) dan akses Vercel KV.

## Catatan keamanan

- Password disimpan sebagai **hash bcrypt**, bukan teks biasa — jauh lebih aman dari versi Claude/PWA sebelumnya.
- Sesi login disimpan di **cookie httpOnly** (tidak bisa diakses lewat JavaScript di browser), berlaku 30 hari.
- Tetap ganti `AUTH_SECRET` dengan nilai unik milikmu sendiri sebelum deploy ke publik.

# Ruang — Portal Kerja Tim (versi Next.js + Vercel)

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

## Menjalankan secara lokal (opsional, untuk uji coba)

```bash
npm install
# butuh env var REDIS_URL (dari integrasi Redis di Vercel, atau Redis lokal), dan AUTH_SECRET
npm run dev
```

## Struktur penting

- `app/api/auth/*` — endpoint login, setup akun admin pertama, kelola akun, sesi.
- `app/api/kv/*` — endpoint penyimpanan data generik (papan, catatan, anggota) yang menggantikan `window.storage` versi Claude.
- `components/RuangWorkspace.jsx` — seluruh tampilan & logika aplikasi (kanban, catatan, checklist, durasi, notifikasi, ekspor Excel) — sama persis dengan versi sebelumnya.
- `lib/auth.js` — helper autentikasi (JWT + cookie).
- `lib/redisClient.js`, `lib/kv.js` — koneksi Redis dan helper penyimpanan data.

## Catatan keamanan

- Password disimpan sebagai **hash bcrypt**, bukan teks biasa — jauh lebih aman dari versi Claude/PWA sebelumnya.
- Sesi login disimpan di **cookie httpOnly** (tidak bisa diakses lewat JavaScript di browser), berlaku 30 hari.
- Tetap ganti `AUTH_SECRET` dengan nilai unik milikmu sendiri sebelum deploy ke publik.

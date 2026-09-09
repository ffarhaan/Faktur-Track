# Faktur Tracker

Aplikasi untuk tracking **No Faktur**, **No Delivery Order**, **No Sales Order**, dan status **sudah/belum print**, dari data yang diexport Excel dari Oracle.

## Fitur
- Upload file Excel export Oracle
- Column mapping manual (kolom Excel bisa berubah-ubah, tinggal dicocokkan ulang — otomatis diingat kalau susunan kolomnya sama seperti sebelumnya)
- Import tidak menimpa status print yang sudah ada (kalau No Faktur yang sama diupload ulang, status print tidak ke-reset)
- Search & filter (semua / sudah print / belum print)
- Toggle status print langsung dari tabel
- Export ulang ke Excel

## 1. Setup Supabase (database)
1. Buat project baru di https://supabase.com
2. Buka **SQL Editor**, copy-paste isi file `supabase/schema.sql`, lalu Run.
3. Buka **Project Settings > API**, catat:
   - `Project URL`
   - `anon public key`

## 2. Setup project secara lokal
```bash
npm install
cp .env.local.example .env.local
```
Isi `.env.local` dengan URL dan anon key dari Supabase:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxxxxx
```

Jalankan lokal:
```bash
npm run dev
```
Buka http://localhost:3000

## 3. Push ke GitHub & deploy ke Vercel
1. `git init && git add . && git commit -m "init faktur tracker"`
2. Push ke repo GitHub baru.
3. Di Vercel: **New Project** → import repo tersebut.
4. Di tab **Environment Variables** Vercel, masukkan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` yang sama.
5. Deploy.

## Cara pakai
1. Export data dari Oracle ke Excel seperti biasa.
2. Klik **Import Excel** di aplikasi, pilih file-nya.
3. Cocokkan kolom Excel ke field **No Faktur / No DO / No SO** (kolom lain otomatis ikut kesimpan sebagai data tambahan).
4. Klik **Lanjutkan Import**.
5. Data akan muncul di tabel. Klik badge status untuk menandai sudah/belum print.
6. Kalau butuh, klik **Export ke Excel** untuk mengambil datanya lagi lengkap dengan status print.

## Catatan soal keamanan
Karena ini tool internal tanpa sistem login, akses ke database dibuka lewat `anon key` dengan policy "allow all". Kalau aplikasinya akan diakses banyak orang dari luar kantor, sebaiknya nanti ditambahkan halaman login (misalnya pakai Supabase Auth) supaya lebih aman.

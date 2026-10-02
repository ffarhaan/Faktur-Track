# 🔒 DOKUMEN ATURAN BAKU & ARSITEKTUR TERKUNCI (LOCKED RULES)
## Faktur Tracker v2.0 — Final Stable & Realtime Architecture

Dokumen ini adalah acuan baku dan permanen untuk seluruh pengembangan, pemeliharaan, dan sesi interaksi pada proyek **Faktur Tracker**. Seluruh aturan di bawah ini telah diverifikasi, disetujui, dan **DI-LOCK TOTAL (TIDAK BOLEH DIUBAH TANPA PERSETUJUAN EKSPLISIT)**.

---

### 1. ATURAN BISNIS & LOGIKA INTI

#### A. Isolasi Mutlak DOO vs ORA (Strict Key Isolation)
1. **Identifikasi Jenis Transaksi**:
   - `isOraCustomer(customerName)`: Mengembalikan `true` JIKA nama pelanggan mengandung `HELIOS`, diawali `HAK`, diawali `IHC`, bernilai kode `1001`, atau kode pelanggan `CA-900001` (seluruh entitas di bawah konsorsium Helios/ORA). Pelanggan lain (Apotek Halomedika, Medika Prima, SBS, Pasti Hemat, K24, Kimia Farma, dll.) adalah **DOO** (`false`).
2. **Kunci Faktur (Invoice Key)**:
   - Faktur ORA: Wajib menggunakan suffix `${cleanInv}-1P` (contoh: `14040-1P`).
   - Faktur DOO: Wajib menggunakan nomor invoice murni `${cleanInv}` (contoh: `14040`).
   - Faktur dengan nomor sama di DOO dan ORA adalah dua entitas data terpisah dengan status cetak mandiri.
3. **Pemisahan Sales Order (No SO)**:
   - **DOO SO**: Berasal langsung dari kolom `Reference` file export DOO (`export.xls`). Nilai ini di-LOCK dan TIDAK BOLEH ditimpa oleh file ORA ataupun XXCUST.
   - **ORA SO**: Di export HTML bernilai internal (`-`). Nilai No SO resminya diisi saat file `XXCUST` diupload dengan mencocokkan `No Invoice AR` ke `${cleanInv}-1P`.
4. **Independensi Status Cetak & Strict Key Isolation (PERMANEN / LOCKED)**:
   - Menandai cetak pada DOO `14040` (key: `14040`) HANYA mengubah dan membaca key `14040`.
   - Menandai cetak pada ORA `14040` (key: `14040-1P`) HANYA mengubah dan membaca key `14040-1P`.
   - DILARANG KERAS melakukan fallback atau cross-matching status cetak antar key DOO dan ORA (misal `cleanKey` vs `cleanKey-1P`). Keduanya 100% independen untuk seluruh invoice sekarang dan seterusnya.
5. **Deteksi Faktur ORA Baru dari File XXCUST**:
   - Jika file `XXCUST` diunggah dan memuat faktur ORA baru yang belum ada di `export.xls`, faktur tersebut langsung didaftarkan dengan key `${cleanInv}-1P`, No SO terisi, status `Belum Terprint`, dan tidak akan bertabrakan dengan DOO.
   - Jika faktur ORA sudah ada dari `export.xls`, file `XXCUST` melengkapi No SO dan rincian item tanpa mengubah status cetak yang sudah ada.
6. **Pembacaan Lengkap & Pemetaan Otomatis File XXCUST (LOCKED)**:
   - File `XXCUST` dibaca lengkap dari kolom `No Invoice AR`, `Order Number`, `Nama Pelanggan`, `Kode Pelanggan`, serta rincian item produk/lot.
   - Seluruh entitas konsorsium Helios/ORA (termasuk awalan `HAK`, awalan `IHC`, `HELIOS`, kode `1001`, dan akun `CA-900001`) secara mutlak dipetakan ke key ORA `${cleanInv}-1P`.
   - Nama pelanggan umum (`PT Helios Alchemist Kesehatan`) otomatis disempurnakan menjadi nama cabang/apotek spesifiknya (contoh: `IHC ADM Plant 5`, `IHC ADM Part Center`, `HAK Gejayan`), No SO terisi dari kolom `Order Number`, dan status cetak 100% terkunci permanen.

#### B. Jaminan Status Faktur Baru (New Invoices Unprinted Guarantee)
- Setiap kali file diupload, faktur baru yang memiliki nomor lebih besar dari nomor maksimum sebelumnya (`num > prevMaxNum`) atau belum pernah terdaftar di database **WAJIB berstatus Belum Dicetak (`status_cetak: false`, `printed_at: null`)**.
- Faktur lama yang sudah pernah ditandai selesai dicetak di database Firestore tetap mempertahankan status cetaknya (`status_cetak: true`) beserta jam cetaknya (`printed_at`).

#### C. Logika Done Print & Realtime Multi-Device Sync
- **Kecepatan & Keandalan**:
  - Saat faktur ditandai selesai cetak (*Done Print*), status langsung tersimpan ke dokumen `app_data/print_state` di Firestore secara instan (<50ms).
  - Melalui listener `subscribeToFakturs`, seluruh device lain yang sedang membuka aplikasi akan menerima status terbaru secara *real-time* tanpa perlu reload halaman.
- **Filter Otomatis**:
  - Pada tab **"Belum Terprint"**, saat halaman direfresh atau difilter ulang, faktur yang sudah selesai dicetak **otomatis disaring keluar / tidak ditampilkan lagi** di daftar belum terprint.
  - Faktur tersebut tetap dapat dilihat di tab **"Sudah Terprint"**, tab **"Semua"**, atau melalui kotak pencarian global.

#### D. Jaminan Anti-Muncul Kembali (Anti-Reappearance & Permanent Print Retention)
- **Faktur yang Sudah Selesai Dicetak DILARANG KERAS Muncul Kembali di Daftar Belum Terprint**:
  - Sekali suatu faktur ditandai `Done Print` (`✓`), status tersebut bersifat permanen di database `app_data/print_state`.
  - Mengupload ulang file export yang sama, file kumulatif, ataupun file format lain **TIDAK BOLEH mereset atau mengembalikan faktur yang sudah dicetak ke status Belum Terprint**.
  - Faktur hanya bisa kembali ke status Belum Terprint jika user secara manual mengklik tombol **"Unprint / Batalkan Print"** pada faktur tersebut.

#### E. Kategorisasi Prioritas & Penyimpanan Kustom Apotek (Category Overrides Retention)
1. **Default Kategori**:
   - **1P**: PT Helios (ORA) + Apotek Prioritas 1 DOO (`HALOMEDIKA`, `MEDIKA PRIMA`, `SBS`, `PASTI HEMAT`, `MEDIKA AKSES`).
   - **2P**: Apotek Prioritas 2 (dicek via master `master2P.json` berdasarkan Ship-to Site ID / Nama Apotek).
   - **3P**: Seluruh apotek reguler lainnya.
2. **Penyimpanan Kustom User (`category_overrides`)**:
   - Jika pengguna mengubah kategori suatu apotek/faktur (misal Apotek A diubah dari 3P ke 2P), perubahan tersebut disimpan permanen ke dokumen `app_data/category_overrides`.
   - **Saat upload file excel baru di masa depan**, sistem wajib memprioritaskan preferensi yang tersimpan sehingga Apotek A **tetap 2P dan tidak akan kembali ke 3P**.
3. **Kategori Produk**:
   - `FARMA`, `ALKES`, `CCP`, `PREKURSOR`, `OOT` berdasarkan lookup `masterProduct.json` dan regex kata kunci obat khusus.

#### F. Navigasi & Shortcut Keyboard
- Navigasi tabel penuh: `↓`/`j`, `↑`/`k` (baris), `→`/`l`, `←`/`h` (kolom/sel).
- Aksi instan: `Space` (toggle print), `Enter` (buka detail obat), `Ctrl+C` / `Cmd+C` / `c` (salin No Invoice / No SO / Pelanggan / Total pada sel aktif ke clipboard), `/` atau `f` (fokus search).

---

### 2. ARSITEKTUR DATABASE & ZERO LOCALSTORAGE

- **DILARANG MENGGUNAKAN `localStorage`** untuk menyimpan records, progression, ataupun status cetak, agar sinkronisasi 100% konsisten multi-device.
- **Skema Koleksi Firestore**:
  1. `app_data/metadata`: Menyimpan `invoiceProgression`, `totalInvoices`, `totalChunks`, `chunkIds`, `updatedAt`.
  2. `app_data/print_state`: Menyimpan `printedKeys: string[]` dan `printedAtMap: Record<string, string>`. Toggle cetak hanya menulis dokumen tunggal ini.
  3. `app_data/category_overrides`: Menyimpan pemetaan nama apotek / invoice ke kategori kustom (`1P`, `2P`, `3P`).
  4. `faktur_chunks/chunk_{idx}`: Menyimpan data faktur yang dipecah per chunk (<500 KB per chunk).
- **Fitur Reset Data**:
  - Menghapus seluruh dokumen di `faktur_chunks` dan mereset `metadata` serta `print_state` kembali ke kondisi kosong awal.

---

### 3. KLAUSUL INTEGRITAS MUTLAK (INVIOLABILITY CLAUSE)

> **DILARANG MERUBAH LOGIKA DASAR PADA PERMINTAAN FITUR BARU APAPUN:**
> Setiap penambahan fitur, perubahan tampilan, atau optimasi di masa mendatang **WAJIB** tunduk pada dokumen `LOCKED_RULES.md` ini dan **TIDAK BOLEH** merusak atau mengubah logika isolasi DOO vs ORA, anti-reappearance faktur tercetak, real-time sync Firestore, penyimpanan kustom kategori apotek, dan arsitektur non-localStorage.

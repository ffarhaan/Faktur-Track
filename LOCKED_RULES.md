# 🔒 DOKUMEN ATURAN BAKU & ARSITEKTUR TERKUNCI (LOCKED RULES)
## Faktur Tracker v2.0 — Final Stable Architecture

Dokumen ini adalah acuan baku dan permanen untuk seluruh pengembangan, pemeliharaan, dan sesi interaksi pada proyek **Faktur Tracker**. Seluruh aturan di bawah ini telah diverifikasi, disetujui, dan **DI-LOCK (TIDAK BOLEH DIUBAH TANPA PERSETUJUAN EKSPLISIT)**.

---

### 1. ATURAN BISNIS & LOGIKA INTI

#### A. Isolasi Mutlak DOO vs ORA (Strict Key Isolation)
1. **Identifikasi Jenis Transaksi**:
   - `isOraCustomer(customerName)`: Mengembalikan `true` HANYA JIKA nama pelanggan mengandung `HELIOS`, diawali `HAK`, atau bernilai kode `1001`. Pelanggan lain (Apotek Halomedika, Medika Prima, SBS, Pasti Hemat, K24, Kimia Farma, dll.) adalah **DOO** (`false`).
2. **Kunci Faktur (Invoice Key)**:
   - Faktur ORA: Wajib menggunakan suffix `${cleanInv}-1P` (contoh: `14040-1P`).
   - Faktur DOO: Wajib menggunakan nomor invoice murni `${cleanInv}` (contoh: `14040`).
   - Faktur dengan nomor sama di DOO dan ORA adalah dua entitas data terpisah dengan status cetak mandiri.
3. **Pemisahan Sales Order (No SO)**:
   - **DOO SO**: Berasal langsung dari kolom `Reference` file export DOO (`export.xls`). Nilai ini di-LOCK dan TIDAK BOLEH ditimpa oleh file ORA ataupun XXCUST.
   - **ORA SO**: Di export HTML bernilai internal (`-`). Nilai No SO resminya diisi saat file `XXCUST` diupload dengan mencocokkan `No Invoice AR` ke `${cleanInv}-1P`.
4. **Independensi Status Cetak**:
   - Menandai cetak pada DOO `14040` tidak akan mencentang ORA `14040-1P`, begitu juga sebaliknya.

#### B. Jaminan Status Faktur Baru (New Invoices Unprinted Guarantee)
- Setiap kali file diupload, faktur baru yang memiliki nomor lebih besar dari nomor maksimum sebelumnya (`num > prevMaxNum`) atau belum pernah terdaftar di database **WAJIB berstatus Belum Dicetak (`status_cetak: false`, `printed_at: null`)**.
- Faktur lama yang sudah pernah ditandai selesai dicetak di database Firestore tetap mempertahankan status cetaknya (`status_cetak: true`) beserta jam cetaknya (`printed_at`).

#### C. Logika Done Print & Refresh
- Saat faktur ditandai selesai cetak (*Done Print*), status langsung tersimpan ke dokumen `app_data/print_state` di Firestore secara instan (<50ms).
- Pada tab **"Belum Terprint"**, saat halaman direfresh atau difilter ulang, faktur yang sudah selesai dicetak **otomatis disaring keluar / tidak ditampilkan lagi** di daftar belum terprint.
- Faktur tersebut tetap dapat dilihat di tab **"Sudah Terprint"**, tab **"Semua"**, atau melalui kotak pencarian global.

#### D. Kategorisasi Prioritas (1P, 2P, 3P) & Kategori Produk
1. **1P**: PT Helios (ORA) + Apotek Prioritas 1 DOO (`HALOMEDIKA`, `MEDIKA PRIMA`, `SBS`, `PASTI HEMAT`, `MEDIKA AKSES`).
2. **2P**: Apotek Prioritas 2 (dicek via master `master2P.json` berdasarkan Ship-to Site ID / Nama Apotek).
3. **3P**: Seluruh apotek reguler lainnya.
4. **Kategori Produk**: `FARMA`, `ALKES`, `CCP`, `PREKURSOR`, `OOT` berdasarkan lookup `masterProduct.json` dan regex kata kunci obat khusus.

---

### 2. ARSITEKTUR DATABASE & ZERO LOCALSTORAGE

- **DILARANG MENGGUNAKAN `localStorage`** untuk menyimpan records, progression, ataupun status cetak, agar sinkronisasi 100% konsisten multi-device.
- **Skema Koleksi Firestore**:
  1. `app_data/metadata`: Menyimpan `invoiceProgression`, `totalInvoices`, `totalChunks`, `chunkIds`, `updatedAt`.
  2. `app_data/print_state`: Menyimpan `printedKeys: string[]` dan `printedAtMap: Record<string, string>`. Toggle cetak hanya menulis dokumen tunggal ini.
  3. `faktur_chunks/chunk_{idx}`: Menyimpan data faktur yang dipecah per ~120 item (<500 KB per chunk).
- **Fitur Reset Data**:
  - Menghapus seluruh dokumen di `faktur_chunks` dan mereset `metadata` serta `print_state` kembali ke kondisi kosong awal.

---

### 3. STRUKTUR FILE KODE UTAMA

- `lib/types.ts`: Definisi antarmuka TypeScript baku (`FakturRecord`, `FirestoreFakturDoc`, `PrintState`, `InvoiceProgression`, `FakturGroup`).
- `lib/parser.ts`: Parser multi-file (.xls HTML & .xlsx biner), klasifikasi ORA vs DOO, 1P/2P/3P, produk, dan deteksi double invoice.
- `lib/firestoreService.ts`: Service Firestore chunking, real-time subscription, batch saving, instant print toggle, dan reset data.
- `app/page.tsx`: UI Dashboard terpusat, modular, responsif, bebas error, dan berkinerja tinggi.

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
   - Nama pelanggan umum (`PT Helios Alchemist Kesehatan` atau variasinya) secara otomatis dan case-insensitive disempurnakan menjadi nama cabang/apotek spesifiknya (contoh: `HAK Tirta Raya`, `HAK Kemuning`, `HAK Bungur Mlg`, `IHC SRI Suryaraya`), No SO terisi dari kolom `Order Number`, dan status cetak 100% terkunci permanen.
7. **Prinsip Non-Destructive Overwrite (Perlindungan Data Lengkap / Anti-Downgrade - LOCKED)**:
   - Mengunggah file baru (misal file export berkala) setelah file XXCUST **DILARANG MERUSAK DATA YANG LEBIH LENGKAP**:
     - No SO yang sudah terisi (misal `696000`) TIDAK BOLEH ditimpa oleh tanda strip (`-`) dari file export.
     - Nama cabang apotek yang sudah terisi spesifik (misal `HAK Tirta Raya`) TIDAK BOLEH ditimpa kembali oleh nama induk generic (`PT Helios Alchemist Kesehatan`).
     - List barang (`items`) yang sudah terisi dari XXCUST TIDAK BOLEH dihapus atau dikosongkan oleh file export yang tidak memiliki rincian barang.

#### B. Jaminan Status Faktur Baru & Retensi Faktur Belum Dicetak (Unprinted Guarantee - LOCKED TOTAL)
1. **Aturan Mutlak Faktur Baru**:
   - Seluruh faktur baru yang **belum pernah terdaftar di database** (`existingEntry === undefined` & `prevInfo === undefined`) **WAJIB 100% berstatus Belum Dicetak (`status_cetak: false`, `printed_at: null`)** dan langsung dimasukkan ke `newUnprintedKeysSet` untuk ditampilkan di tab **"Belum Terprint"**.
   - **LARANGAN MUTLAK LOGIKA `isHistorical` (`num <= prevMaxNum`)**: DILARANG KERAS mengasumsikan faktur baru sebagai "sudah tercetak" hanya karena nomor invoicenya lebih kecil atau sama dengan nomor invoice yang sudah ada di database. Setiap faktur baru wajib diverifikasi fisik oleh operator sampai tombol Done Print diklik.
2. **Retensi Mutlak Faktur Belum Dicetak (Anti-Accidental Print)**:
   - Faktur yang saat ini sedang menunggu dicetak (`status_cetak: false`) **DILARANG BERUBAH MENJADI SUDAH TERCETAK** ketika ada file baru (seperti file `XXCUST` atau `export`) yang hanya memuat sebagian transaksi. Seluruh daftar faktur yang belum dicetak wajib tetap diawetkan statusnya sampai pengguna secara fisik menandai cetak.
3. **Pemisahan Partisi Suffix -1P (`getPrintPartitionId`)**:
   - Penentuan partisi wajib membuang suffix `-1P` (`replace(/-[0-9]P$/i, '')`) sebelum mengambil digit angka. Faktur ORA `18034-1P` wajib dipetakan ke partisi aslinya (`part_15000_19999`), dilarang melompat ke partisi sepuluh kali lipat (`part_180000_184999`).
4. **Tugas Utama Upload XXCUST**:
   - Mencari No Invoice dan No SO baru (khususnya ORA baru) dan mendaftarkannya ke sistem dengan status Belum Terprint.
   - Melengkapi No SO resmi dan rincian obat/item untuk faktur yang sudah ada.
   - Dilarang mereset atau mengutak-atik status cetak faktur apa pun yang sudah ada di database.
5. **Jaminan Konsistensi Kronologis (Chronological Consistency Guard - LOCKED)**:
   - Sebuah faktur baru tidak mungkin dicetak berhari-hari sebelum tanggal ordernya (`order_date`) dibuat.
   - Jika suatu faktur baru dicocokkan dengan stempel `printed_at` di database yang tanggalnya lampau (> 24 jam sebelum `order_date`), sistem secara otomatis mengabaikan stempel lampau tersebut (`isStalePrintTimestamp = true`) dan mewajibkan faktur baru tersebut berstatus murni `Belum Terprint`.
   - Menjamin 100% tidak ada lagi tabrakan nomor faktur antar siklus waktu yang menyebabkan faktur baru otomatis tercentang.

#### C. Logika Done Print & Realtime Multi-Device Sync
- **Kecepatan & Keandalan**:
  - Saat faktur ditandai selesai cetak (*Done Print*), status langsung tersimpan ke dokumen `app_data/print_state` di Firestore secara instan (<50ms).
  - Melalui listener `subscribeToFakturs`, seluruh device lain yang sedang membuka aplikasi akan menerima status terbaru secara *real-time* tanpa perlu reload halaman.
- **Filter Otomatis**:
  - Pada tab **"Belum Terprint"**, saat halaman direfresh atau difilter ulang, faktur yang sudah selesai dicetak **otomatis disaring keluar / tidak ditampilkan lagi** di daftar belum terprint.
  - Faktur tersebut tetap dapat dilihat di tab **"Sudah Terprint"**, tab **"Semua"**, atau melalui kotak pencarian global.

#### D. Jaminan Anti-Muncul Kembali (Anti-Reappearance & Permanent Print Retention - LOCKED MUTLAK)
1. **Faktur yang Sudah Selesai Dicetak DILARANG KERAS Muncul Kembali di Daftar Belum Terprint**:
   - Sekali suatu faktur ditandai `Done Print` (`✓`), status tersebut bersifat permanen di database `print_state_partitions` dan memori lokal.
   - Mengupload ulang file export yang sama, file kumulatif, file sebagian, ataupun file format lain **TIDAK BOLEH mereset atau mengembalikan faktur yang sudah dicetak ke status Belum Terprint**.
   - Faktur hanya bisa kembali ke status Belum Terprint jika user secara manual dan eksplisit mengklik tombol **"Unprint / Batalkan Print"** pada faktur tersebut.
2. **Pencegahan Stale Closure via Mutable Reference (`useRef` + `getLivePrintState`)**:
   - Handler upload (`handleUpload`) DILARANG KERAS hanya membaca state closure React yang rentan kosong/usang. Wajib selalu membaca referensi mutabel real-time `printedInvoicesRef.current`, `printedAtMapRef.current`, dan fungsi cache memori `getLivePrintState()`.
   - Setiap perubahan status cetak (baik per baris via spasi/tombol, *Batch Done Print*, maupun sinkronisasi Firestore) WAJIB memperbarui `printedInvoicesRef.current` detik itu juga secara sinkron.
3. **Larangan Mutlak Loop Penghapusan di `saveFaktursBatch` (Zero-Unprint on Upload)**:
   - Di dalam fungsi `saveFaktursBatch`, operasi penghapusan status cetak (`unifiedPrintedSet.delete(k)`) **DILARANG KERAS / DIHARAMKAN SECARA TOTAL**.
   - Kumpulan status cetak gabungan (`unifiedPrintedSet`) WAJIB selalu bersifat kumulatif (`Set([...livePrintedKeys, ...localPrintedKeys])`). Tidak ada mekanisme upload apa pun yang diizinkan membatalkan atau mencabut status cetak yang sudah ada di database.


#### E. Kategorisasi Prioritas & Penyimpanan Kustom Apotek (Category Overrides Retention)
1. **Default Kategori**:
   - **1P**: PT Helios (ORA) + Apotek Prioritas 1 DOO (`HALOMEDIKA`, `MEDIKA PRIMA`, `SBS`, `PASTI HEMAT`, `MEDIKA AKSES`).
   - **2P**: Apotek Prioritas 2 (dicek via master `master2P.json` berdasarkan Ship-to Site ID / Nama Apotek).
   - **3P**: Seluruh apotek reguler lainnya.
2. **Penyimpanan Kustom User (`category_overrides`)**:
   - Jika pengguna mengubah kategori suatu apotek/faktur (misal Apotek A diubah dari 3P ke 2P), perubahan tersebut disimpan permanen ke dokumen `app_data/category_overrides`.
   - **Saat upload file excel baru di masa depan**, sistem wajib memprioritaskan preferensi yang tersimpan sehingga Apotek A **tetap 2P dan tidak akan kembali ke 3P**.
3. **Kategori Produk Dominan (Dominant Category Majority Rule - LOCKED TOTAL)**:
   - **Kalkulasi Berbasis Mayoritas**: Kategori produk pada faktur dihitung berdasarkan kategori terbanyak dari seluruh item obat/barang dalam faktur tersebut:
     - Barang dominan FARMA $\rightarrow$ Kategori Faktur **FARMA**.
     - Barang dominan ALKES $\rightarrow$ Kategori Faktur **ALKES**.
     - Begitu juga untuk **CCP**, **PREKURSOR**, dan **OOT**.
   - **DILARANG KERAS Menghakimi Sepihak**: Dilarang mencap seluruh faktur sebagai ALKES hanya karena terdapat 1 item alkes (misal alkohol/swab) sementara 20 item lainnya adalah obat farmasi.
   - **Prioritas Tie-Breaker**: Jika jumlah item antar kategori sama persis, urutan penentu adalah `CCP > PREKURSOR > OOT > FARMA > ALKES`.
   - **Dukungan Resmi Oracle PPIC & Bentuk Sediaan**: Sistem wajib membaca kolom resmi Oracle PPIC (Kolom 16 `Segmentation` & Kolom 13 `Nama Kategori Product`) serta memprioritaskan bentuk sediaan farmasi (`TABLET`, `KAPSUL`, `SIRUP`, `INJEKSI`, `SALEP`, `KRIM`, `INFUS`, dll) agar obat farma tidak salah terbaca alkes.

#### F. Navigasi & Shortcut Keyboard
- Navigasi tabel penuh: `↓`/`j`, `↑`/`k` (baris), `→`/`l`, `←`/`h` (kolom/sel).
- Aksi instan: `Space` (toggle print), `Enter` (buka detail obat), `Ctrl+C` / `Cmd+C` / `c` (salin No Invoice / No SO / Pelanggan / Total pada sel aktif ke clipboard), `/` atau `f` (fokus search).

#### G. Dual Source of Truth Status Cetak & Jaminan Anti-Flash (Anti-Glitch / Anti-Race Condition - LOCKED)
1. **Strict Key Isolation Evaluasi Status Cetak di UI**:
   - Atribut `status_cetak: boolean` dan `printed_at: string | null` WAJIB ditanamkan langsung pada setiap objek `FakturRecord`.
   - Logika penentuan status cetak di UI (`grouped`, tabel, dan counter) WAJIB menggunakan evaluasi murni kunci masing-masing:
     `allPrinted: printedInvoices.has(g.key)`
   - DILARANG KERAS melakukan fallback atau cross-matching ke nomor invoice polos (`g.invoiceNumber`) pada faktur ORA. Faktur ORA `20078-1P` dan faktur DOO `20078` adalah dua entitas terpisah yang 100% mandiri dan dilarang diubah barengan.
2. **Persistensi Dua Arah ke Dokumen Chunk Firestore (Bidirectional Chunk Persistence - LOCKED)**:
   - Setiap kali status cetak diubah (baik cetak maupun unprint), sistem WAJIB memperbarui dokumen fisik chunk `faktur_chunks/chunk_{idx}` di Firestore secara langsung selain dokumen partisi `print_state_partitions`.
   - Menjamin status unprint tersimpan permanen dan tidak akan pernah mental kembali ke status sudah dicetak saat halaman direfresh.
3. **Penghitungan Notifikasi Banner Upload Akurat (Brand New Counter - LOCKED)**:
   - Angka `Faktur Baru Masuk` pada banner notifikasi upload WAJIB secara ketat hanya menghitung faktur yang benar-benar baru masuk dari file yang sedang diunggah (`brandNewUnprintedKeysSet`), bukan menghitung seluruh akumulasi antrean lama di database.
4. **Auto-Rescue Status Cetak Dokumen**:
   - Setiap kali chunk faktur dimuat (`emitData("chunks")` di `firestoreService.ts`), seluruh record yang memiliki `status_cetak: true` wajib secara otomatis digabungkan (*auto-rescue*) ke dalam set cetak di memori (`currentPrintState`).
5. **Optimistic Instant Upload (< 100ms UI Response)**:
   - Saat pengguna mengunggah file (Export / XXCUST), UI wajib langsung menampilkan perubahan dan membuka blokir loading secara instan (< 100ms) setelah file selesai diparsing.
   - Penyimpanan ke Firestore (`saveFaktursBatch`) berjalan di latar belakang (*background persistence*) tanpa menahan UI pengguna.

---

#### H. Master Produk & Category Overrides Retention (LOCKED TOTAL)
1. **Fitur Master Produk**:
   - Pengguna admin dapat mencari, memfilter, dan mengubah kategori produk (`FARMA`, `ALKES`, `CCP`, `PREKURSOR`, `OOT`) langsung melalui modal Master Produk atau inline dropdown pada baris detail faktur.
   - Perubahan disimpan permanen ke dokumen `app_data/product_category_overrides` di Firestore.
2. **Jaminan Anti-Kembali ke Awal Saat Upload File Baru**:
   - Fungsi `getProductCategory`, `parseXXCUST`, dan `parseExcelFile` WAJIB selalu membaca dan memprioritaskan pemetaan dari `product_category_overrides`.
   - Kategori produk yang telah diubah secara kustom oleh pengguna TIDAK BOLEH kembali ke nilai default saat file excel baru diunggah di kemudian hari.

#### I. Sistem Hak Akses Pengguna & Keamanan Password (User Roles & Auth - LOCKED)
1. **Daftar Pengguna Resmi**:
   - Pengguna Admin (Full Access): `Farhan`, `Rendy`, `Afuan`, `Aqsal`, `Wibi`, `Andre`, `Melin`, `Mahendra`.
   - Pengguna Tamu: `stranger` (Akses Read Only).
2. **Pengamanan Password Mandiri**:
   - Verifikasi password tersimpan aman di Firestore `app_data/user_credentials`.
   - Pengguna admin dapat mengganti password masing-masing kapan saja melalui tombol **Password** (`🔑`).
   - Sesi pengguna tersimpan di `sessionStorage` sehingga saat tab direfresh tidak perlu login ulang.
3. **Pembatasan Ketat Akses Stranger (Read Only Protection)**:
   - Pengguna `stranger` dilarang keras melakukan aksi operasional: dilarang upload file, dilarang menandai cetak (Done Print), dilarang mereset data, dan dilarang mengubah kategori apotek/produk.

#### J. Fitur Reset Data Terkendali (Admin Safe Reset)
- Tombol **Reset Data** (`🗑️ Reset Data`) tersedia khusus untuk pengguna Admin dengan dialog konfirmasi keamanan bertingkat.
- Saat reset disetujui, seluruh dokumen faktur di cloud dan memori lokal dibersihkan serentak secara bersih tanpa sisa (*clean slate*).

#### K. Aturan Baku Urutan Hook React (React Hook Order & Anti-Crash Guarantee - LOCKED MUTLAK)
- **LARANGAN MUTLAK KONDISIONAL HOOK**: DILARANG KERAS menempatkan `useState`, `useEffect`, `useMemo`, `useCallback`, atau `useRef` setelah pernyataan `if (...) return null;` atau di dalam blok kondisional apa pun.
- Seluruh hooks WAJIB dideklarasikan di level teratas (*top-level*) fungsi komponen. Pelanggaran aturan ini memicu *React Error #300 ("Rendered fewer hooks than expected")* yang membuat aplikasi crash menjadi tampilan error biru di browser pengguna.

#### L. Arsitektur Performa Super Cepat & Eliminasi Spinner Palsu (Performance Lock - LOCKED)
1. **Pemisahan `baseGroups` vs `grouped` (<1ms Action Speed)**:
   - Pengelompokan baris data, kalkulasi harga, dan penyusunan string pencarian (`searchStr`) WAJIB diisolasi dalam `baseGroups` yang hanya dieksekusi saat `records` berubah.
   - Proyeksi status cetak (`grouped`) dilakukan secara *shallow* (<1ms), sehingga aksi klik tombol cetak (*Done Print*) berjalan seketika tanpa jeda dan tanpa mengulang proses berat.
2. **Pencarian Kilat (Precomputed Search Index)**:
   - Setiap grup faktur memiliki atribut `searchStr` huruf kecil yang sudah dihitung sebelumnya. Pencarian mencocokkan string tunggal ini sehingga respon pencarian instan tanpa lag.
3. **Kalkulasi Kartu & Tab Berbasis `stats` (O(N) Precomputed Stats)**:
   - DILARANG menaruh pemanggilan `.filter()` berulang kali di dalam JSX render body. Seluruh angka kartu KPI dan filter tab dihitung dalam 1 putaran ringkas `stats` di memori.
4. **Eliminasi Spinner Loading Berputar yang Macet**:
   - Indikator spinner "Memuat data faktur..." HANYA boleh muncul jika `records.length === 0` (saat awal membuka web ketika data belum masuk ke memori).
   - Begitu data ada di memori (`records.length > 0`), tabel DILARANG menampilkan spinner loading, melainkan langsung menampilkan data atau keterangan kosong yang ramah jika tidak ada data yang sesuai filter (contoh pada tab Belum Terprint: `🎉 Semua faktur sudah dicetak`).
5. **Navigasi Keyboard Bebas Lag & Anti-Crash (Keyboard Navigation Guard - LOCKED)**:
   - Handler keyboard (`handleKeyDown`) WAJIB terpasang satu kali saja (*zero listener churn*) dengan dependensi kosong `[]`, memanfaatkan `useRef` untuk membaca state dinamis.
   - Tombol spasi (`Space`), `Enter`, `PageUp`, `PageDown`, dan `c` WAJIB mengabaikan `e.repeat` untuk mencegah penumpukan eksekusi saat tombol ditahan.
   - Tombol spasi memiliki *throttle/debounce guard* (150ms) untuk mencegah banjir operasi penulisan concurrent.
   - Elemen interaktif (`INPUT`, `TEXTAREA`, `SELECT`, `BUTTON`, `contentEditable`) dan modal aktif WAJIB memblokir eksekusi pintasan tabel agar tidak terjadi eksekusi ganda yang memicu crash.
   - Navigasi panah atas/bawah (`ArrowDown`, `ArrowUp`, `j`, `k`) menggunakan `requestAnimationFrame` dan `scrollIntoView({ block: 'nearest' })` untuk pergerakan baris yang mulus tanpa lag.
6. **Debounced Background Chunk Persistence & Anti-Echo Guard (LOCKED)**:
   - Penyimpanan dokumen chunk (`faktur_chunks`) pada pengubahan status cetak dijalankan secara *debounced* (1.000ms) di latar belakang agar tidak memblokir thread JavaScript utama.
   - Listener real-time Firestore `unsubChunks` WAJIB mengabaikan echo snapshot dari update chunk internal (`internalChunkWriteInProgress`), mencegah re-parsing rekursif ribuan data yang memicu crash tab browser.
7. **Pengurutan Tab 'Semua' (Unprinted-First & Chronological Done-Print Stream - LOCKED)**:
   - Tab 'Sudah Terprint' disederhanakan/dihapus dari bilah filter utama agar tampilan bersih dan fokus pada antrean kerja.
   - Pada tab 'Semua', faktur yang **Belum Terprint** selalu berada di posisi paling atas (diurutkan nomor invoice terbaru).
   - Faktur yang **Sudah Terprint** mengalir di bawahnya, diurutkan secara ketat berdasarkan **waktu cetak (Done Print timestamp)** terbaru ke terlama (`timeB - timeA`). Saat faktur selesai dicetak, faktur tersebut langsung turun memimpin daftar riwayat cetak.

---

### 2. ARSITEKTUR DATABASE & ZERO LOCALSTORAGE

- **DILARANG MENGGUNAKAN `localStorage`** untuk menyimpan records, progression, ataupun status cetak, agar sinkronisasi 100% konsisten multi-device.
- **Skema Koleksi Firestore**:
  1. `app_data/metadata`: Menyimpan `invoiceProgression`, `totalInvoices`, `totalChunks`, `chunkIds`, `updatedAt`, `lastUploadNotification`.
  2. `app_data/print_state_partitions`: Status cetak dipecah per partisi (5.000 key per partisi) untuk menjamin kapasitas puluhan ribu faktur tanpa batas limit Firestore.
  3. `app_data/category_overrides`: Menyimpan pemetaan kustom kategori apotek/faktur (`1P`, `2P`, `3P`).
  4. `app_data/product_category_overrides`: Menyimpan pemetaan kustom kategori produk (`FARMA`, `ALKES`, `CCP`, `PREKURSOR`, `OOT`).
  5. `app_data/user_credentials`: Menyimpan password pengguna terenkripsi.
  6. `app_data/active_presence`: Menyimpan heartbeat real-time siapa saja pengguna yang sedang ON.
  7. `faktur_chunks/chunk_{idx}`: Menyimpan data faktur yang dipecah per chunk (<500 KB per chunk).

---

### 3. ARSITEKTUR EFISIENSI EKSTRIM & PORTABILITAS DATABASE (DATABASE MIGRATION & EXTREME EFFICIENCY - LOCKED)

Dokumen ini secara permanen mengunci prinsip efisiensi kuota dan kompresi data untuk database saat ini (Firestore) maupun jika sistem dipindahkan ke database lain di masa mendatang:

1. **Prinsip Chunking Portabel (Portable Document Chunking - LOCKED)**:
   - Jika database dipindahkan (misal ke project Firebase baru, Supabase, PostgreSQL, CouchDB, MongoDB, dll), logika **Chunking (~200 s/d 250 faktur per kantung dokumen)** WAJIB TETAP DIPERTAHANKAN.
   - **Alasan**: Menghindari pemborosan kuota baca (reads/queries). Membaca 10.000 faktur hanya membutuhkan ~40 s/d 50 reads dokumen, bukan 10.000 reads individual.
2. **Pembersihan Data Mentah di Browser (Client-Side Extreme Data Pruning - LOCKED)**:
   - File dari Oracle (berukuran 20 MB – 30 MB+) WAJIB langsung dibersihkan di memori browser pengguna sebelum dikirim ke database:
     - Seluruh kolom sampah (session ID, token sistem Oracle, batch ID internal, format styling XML) dibuang 100%.
     - Hanya 7 atribut inti yang disimpan: No Invoice, No SO, Nama Pelanggan, Nama Barang, Qty, Satuan, Total Harga.
     - Rincian item dikelompokkan ke dalam array ringkas `extra.items` per invoice, mencegah pengulangan nama apotek dan invoice yang redundan.
   - **Hasil**: Ukuran data mengecil drastis 90%–95% (dari puluhan MB menjadi hanya ~1–2 MB di database cloud).
3. **Isolasi Mutlak Operasi Tulis Cetak (Partitioned Print State Writes - LOCKED)**:
   - Status cetak dan timestamp selesai cetak WAJIB diisolasi pada dokumen partisi terpisah (`print_state_partitions`).
   - Menandai cetak faktur HANYA menulis dokumen kecil (< 5 KB), dan DILARANG KERAS memicu penulisan ulang seluruh chunk data faktur.
4. **Pemrosesan Murni di Memori Klien (Zero-Read Filtering & Sorting - LOCKED)**:
   - Seluruh operasi pencarian keyword, filtering (ALKES, OOT, CCP, PREKURSOR, FARMA, Belum Cetak, Retur), pengurutan, dan paginasi WAJIB diproses 100% di memori browser (RAM perangkat).
   - Memastikan **0 reads tambahan** ke database saat pengguna berinteraksi dengan tabel.

---

---

### 4. ARSITEKTUR HYBRID DUAL-SYNC REALTIME (TIDB + FIREBASE - LOCKED MUTLAK)

1. **Pemisahan Peran Tegas (Separation of Concerns)**:
   - **TiDB Cloud Serverless (Primary Authoritative Archive)**:
     - Menyimpan seluruh 15.000+ hingga jutaan master record faktur secara permanen di cloud (kapasitas 25 GB).
     - Menjadi sumber kebenaran data (*Single Source of Truth*) untuk data historis, sinkronisasi delta berkala, dan pemuatan awal aplikasi.
   - **Firebase Cloud Firestore (Real-Time Dispatcher & Walkie-Talkie)**:
     - Bertanggung jawab 100% atas komunikasi kilat antar-perangkat (< 50ms).
     - **Done Print Realtime Sync**: Mengirim status cetak faktur detik itu juga antar-laptop via `print_state_partitions`.
     - **Realtime Upload Broadcast (`broadcastRecentUpload`)**: Saat salah satu admin mengunggah file faktur baru, data faktur baru tersebut WAJIB langsung disiarkan detik itu juga melalui dokumen `app_data/recent_sync`.
     - Seluruh laptop rekan yang sedang online WAJIB langsung menangkap siaran tersebut, menampilkan banner toast upload, dan menyisipkan faktur baru langsung di posisi teratas tab **"Belum Terprint"** secara instan tanpa perlu me-refresh halaman.

2. **Jaminan Paritas Data Latar Belakang (Background Delta Parity Guard)**:
   - 1 detik setelah notifikasi upload Firebase diterima, perangkat rekan secara otomatis mengeksekusi `fetchTiDBDelta(clientUpdated)` di latar belakang untuk menjamin keselarasan 100% rincian item, nomor SO, dan lot produk dari TiDB tanpa memblokir antarmuka pengguna.

3. **Proteksi Sanitasi Data Uji Coba (Test Data Sanitization Guard - LOCKED)**:
   - Data faktur uji coba atau data berawalan prefix `TEST-` secara ketat dilarang masuk ke dalam memori aplikasi, dilarang masuk ke tabel kerja, dan otomatis disaring dari penyimpanan lokal IndexedDB.

---

### 5. KLAUSUL INTEGRITAS MUTLAK (INVIOLABILITY CLAUSE)

> **DILARANG MERUBAH LOGIKA DASAR PADA PERMINTAAN FITUR BARU APAPUN:**
> Setiap penambahan fitur, perubahan tampilan, atau optimasi di masa mendatang **WAJIB** tunduk pada dokumen `LOCKED_RULES.md` ini dan **TIDAK BOLEH** merusak atau mengubah:
> 1. Isolasi mutlak DOO vs ORA (`-1P`)
> 2. Jaminan anti-reappearance faktur yang sudah dicetak
> 3. Jaminan faktur baru masuk ke Belum Terprint
> 4. Real-time sync multi-device Firestore (Done Print + Realtime Upload Broadcast)
> 5. Retensi kustom kategori apotek dan produk
> 6. Aturan baku urutan Hook React (Top-Level Hooks Only)
> 7. Arsitektur performa kilat `baseGroups` dan eliminasi loading palsu
> 8. Sistem hak akses role pengguna dan proteksi stranger
> 9. Arsitektur efisiensi ekstrim (Chunking, Data Pruning, dan Zero-Read Client Filtering)
> 10. Arsitektur Hybrid Dual-Sync (TiDB Authoritative + Firebase Realtime Broadcast).


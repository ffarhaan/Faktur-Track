import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { connect } from "@tidbcloud/serverless";

const firebaseConfig = {
  apiKey: "AIzaSyBR4DJ8WsfJuLnFyMxLet1m5IrN0LBnkA4",
  authDomain: "faktur-tracker-6fb2b.firebaseapp.com",
  projectId: "faktur-tracker-6fb2b",
  storageBucket: "faktur-tracker-6fb2b.firebasestorage.app",
  messagingSenderId: "400827990470",
  appId: "1:400827990470:web:41f7f69d51b144d1def2c7",
};

const tidbUrl =
  'mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}';

async function runMigration() {
  console.log("=== MEMULAI MIGRASI DATA DARI FIREBASE KE TIDB ===");
  const startTime = Date.now();

  // 1. Inisialisasi Firebase & TiDB
  const fbApp = initializeApp(firebaseConfig);
  const db = getFirestore(fbApp);
  const conn = connect({ url: tidbUrl });

  // Pastikan Collation tabel TiDB selaras
  console.log("Menyelaraskan collation tabel di TiDB...");
  await conn.execute("ALTER TABLE fakturs_archive CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;").catch(() => {});

  // 2. Baca Master Status Cetak (Print State) dari Firestore
  console.log("\n[1/4] Mengambil status cetak (Done Print) dari Firestore...");
  const printedKeys = new Set();
  const printedAtMap = {};
  const printedByMap = {};

  try {
    // A. Baca partisi print_state_partitions
    const partSnap = await getDocs(collection(db, "print_state_partitions"));
    partSnap.forEach((d) => {
      const data = d.data();
      const keys = data.printedKeys || [];
      const atMap = data.printedAtMap || {};
      const byMap = data.printedByMap || {};
      keys.forEach((k) => {
        printedKeys.add(k);
        if (atMap[k]) printedAtMap[k] = atMap[k];
        if (byMap[k]) printedByMap[k] = byMap[k];
      });
    });
    console.log(`  -> Memuat ${printedKeys.size} faktur berstatus SUDAH DICETAK dari partisi.`);

    // B. Baca legacy doc print_state jika ada
    const legacySnap = await getDoc(doc(db, "app_data", "print_state"));
    if (legacySnap.exists()) {
      const lData = legacySnap.data();
      const lKeys = lData.printedKeys || [];
      const lAtMap = lData.printedAtMap || {};
      lKeys.forEach((k) => {
        printedKeys.add(k);
        if (!printedAtMap[k] && lAtMap[k]) printedAtMap[k] = lAtMap[k];
      });
    }
    console.log(`  -> Total faktur SUDAH DICETAK: ${printedKeys.size}`);
  } catch (err) {
    console.warn("  Gagal membaca status cetak:", err.message);
  }

  // 3. Baca Semua Chunk Faktur dari Firestore
  console.log("\n[2/4] Mengambil seluruh chunk faktur dari faktur_chunks...");
  const chunksSnap = await getDocs(collection(db, "faktur_chunks"));
  console.log(`  -> Ditemukan ${chunksSnap.size} dokumen chunk di Firestore.`);

  const allRecords = [];
  chunksSnap.forEach((d) => {
    const data = d.data();
    const items = data.items || [];
    items.forEach((item) => allRecords.push(item));
  });

  console.log(`  -> Total seluruh baris faktur yang terkumpul: ${allRecords.length}`);
  if (allRecords.length === 0) {
    console.log("Tidak ada data faktur di Firestore untuk dipindahkan.");
    return;
  }

  // 4. Transformasi Data Sesuai LOCKED_RULES.md
  console.log("\n[3/4] Menyiapkan payload faktur untuk TiDB...");
  const faktursToUpsert = [];
  const processedKeys = new Set();

  for (const f of allRecords) {
    const invKey = String(f.id || f.no_faktur || "").trim();
    if (!invKey || processedKeys.has(invKey)) continue;
    processedKeys.add(invKey);

    const noFaktur = String(f.no_faktur || invKey).trim();
    const noSO = String(f.no_sales_order || f.extra?.order_number || "-").trim();
    const cust = String(f.customer_name || f.extra?.nama_pelanggan || "-").trim();
    const oDate = String(f.order_date || f.extra?.order_date || "-").trim();
    const txDate = String(f.transaction_date || f.extra?.transaction_date || oDate).trim();
    const jenis = String(f.jenis_transaksi || f.extra?.jenis_transaksi || "DOO").trim();
    const kat = String(f.kategori || f.extra?.kategori || "3P").trim();
    const katProd = String((f.extra?.items && f.extra.items[0]?.kategori_produk) || "FARMA").trim();

    // Pastikan status cetak mutlak sesuai LOCKED_RULES.md
    const isPrinted = printedKeys.has(invKey) || f.status_cetak ? 1 : 0;
    const pAt = printedAtMap[invKey] || f.printed_at || null;
    const pBy = printedByMap[invKey] || f.printed_by || null;
    const totalHarga = Number(f.extra?.total_harga || 0);
    const itemsJson = f.extra?.items ? JSON.stringify(f.extra.items) : null;

    faktursToUpsert.push([
      invKey,
      noFaktur,
      noSO,
      cust,
      oDate,
      txDate,
      jenis,
      kat,
      katProd,
      isPrinted,
      pAt,
      pBy,
      totalHarga,
      itemsJson,
    ]);
  }

  console.log(`  -> Siap menyalin ${faktursToUpsert.length} faktur unik ke TiDB Cloud.`);

  // 5. Eksekusi Batch Multi-Row Upsert ke TiDB Cloud (Cepat & Efisien)
  console.log("\n[4/4] Mengirim batch multi-row ke TiDB Cloud...");
  const BATCH_SIZE = 100;
  let insertedCount = 0;

  for (let i = 0; i < faktursToUpsert.length; i += BATCH_SIZE) {
    const batch = faktursToUpsert.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flatParams = batch.flat();

    const sql = `INSERT INTO fakturs_archive (
      invoice_key, no_faktur, no_sales_order, customer_name,
      order_date, transaction_date, jenis_transaksi, kategori,
      kategori_produk, status_cetak, printed_at, printed_by,
      total_harga, items_json
    ) VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      no_sales_order = IF(VALUES(no_sales_order) IS NOT NULL AND CHAR_LENGTH(VALUES(no_sales_order)) > 1, VALUES(no_sales_order), fakturs_archive.no_sales_order),
      customer_name = IF(VALUES(customer_name) IS NOT NULL AND CHAR_LENGTH(VALUES(customer_name)) > 1, VALUES(customer_name), fakturs_archive.customer_name),
      transaction_date = IF(VALUES(transaction_date) IS NOT NULL AND CHAR_LENGTH(VALUES(transaction_date)) > 1, VALUES(transaction_date), fakturs_archive.transaction_date),
      kategori = VALUES(kategori),
      kategori_produk = VALUES(kategori_produk),
      status_cetak = IF(fakturs_archive.status_cetak = 1, 1, VALUES(status_cetak)),
      printed_at = IF(fakturs_archive.status_cetak = 1, fakturs_archive.printed_at, VALUES(printed_at)),
      printed_by = IF(fakturs_archive.status_cetak = 1, fakturs_archive.printed_by, VALUES(printed_by)),
      total_harga = VALUES(total_harga),
      items_json = IF(VALUES(items_json) IS NOT NULL, VALUES(items_json), fakturs_archive.items_json);`;

    await conn.execute(sql, flatParams);
    insertedCount += batch.length;
    process.stdout.write(`  Tersalin: ${insertedCount}/${faktursToUpsert.length} faktur...\r`);
  }

  // 6. Verifikasi Akhir
  const verifyRes = await conn.execute("SELECT COUNT(*) as total, SUM(status_cetak) as total_printed FROM fakturs_archive;");
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n\n==========================================");
  console.log("✓ MIGRASI BERHASIL 100%!");
  console.log(`- Waktu Eksekusi: ${elapsed} detik`);
  console.log(`- Total Faktur di TiDB Cloud: ${verifyRes[0].total}`);
  console.log(`- Total Sudah Dicetak di TiDB: ${verifyRes[0].total_printed}`);
  console.log("==========================================");
}

runMigration().catch((err) => {
  console.error("Migrasi gagal:", err);
  process.exit(1);
});

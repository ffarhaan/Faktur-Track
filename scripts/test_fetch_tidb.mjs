import { connect } from "@tidbcloud/serverless";

const tidbUrl =
  'mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}';

async function testFast() {
  const conn = connect({ url: tidbUrl });

  // 1. Ambil faktur Belum Terprint (antrean kerja staf saat buka web)
  let t0 = Date.now();
  const unprinted = await conn.execute(
    "SELECT invoice_key, no_faktur, no_sales_order, customer_name, order_date, transaction_date, jenis_transaksi, kategori, kategori_produk, status_cetak, printed_at, printed_by, total_harga, items_json FROM fakturs_archive WHERE status_cetak = 0;"
  );
  console.log(`[1] Ambil Antrean Belum Dicetak: ${Date.now() - t0} ms (Jumlah: ${unprinted.length})`);

  // 2. Ambil Faktur Aktif / Terbaru (misal 1.000 faktur terbaru)
  t0 = Date.now();
  const recent = await conn.execute(
    "SELECT invoice_key, no_faktur, no_sales_order, customer_name, order_date, transaction_date, jenis_transaksi, kategori, kategori_produk, status_cetak, printed_at, printed_by, total_harga, items_json FROM fakturs_archive ORDER BY no_faktur DESC LIMIT 1000;"
  );
  console.log(`[2] Ambil 1.000 Faktur Terbaru: ${Date.now() - t0} ms (Jumlah: ${recent.length})`);

  // 3. Ambil Faktur Lengkap tanpa JSON berat untuk initial list
  t0 = Date.now();
  const allNoJson = await conn.execute(
    "SELECT invoice_key, no_faktur, no_sales_order, customer_name, order_date, transaction_date, jenis_transaksi, kategori, kategori_produk, status_cetak, printed_at, printed_by, total_harga FROM fakturs_archive ORDER BY no_faktur DESC LIMIT 16000;"
  );
  console.log(`[3] Ambil SEMUA 15.183 Faktur (kolom inti tabel): ${Date.now() - t0} ms (Jumlah: ${allNoJson.length})`);
}

testFast().catch(console.error);

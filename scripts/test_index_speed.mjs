import { connect } from "@tidbcloud/serverless";

const tidbUrl =
  'mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}';

async function addIndexAndBenchmark() {
  const conn = connect({ url: tidbUrl });
  console.log("Menambahkan INDEX status_cetak di TiDB...");
  await conn.execute("CREATE INDEX IF NOT EXISTS idx_status_cetak ON fakturs_archive (status_cetak);").catch(() => {});
  
  console.log("Menguji ulang query...");
  let t0 = Date.now();
  const unprinted = await conn.execute(
    "SELECT invoice_key, no_faktur, no_sales_order, customer_name, order_date, status_cetak FROM fakturs_archive WHERE status_cetak = 0;"
  );
  console.log(`✓ Query Belum Dicetak dengan INDEX: ${Date.now() - t0} ms!`);

  t0 = Date.now();
  const allCore = await conn.execute(
    "SELECT invoice_key, no_faktur, no_sales_order, customer_name, order_date, transaction_date, jenis_transaksi, kategori, kategori_produk, status_cetak, printed_at, printed_by, total_harga FROM fakturs_archive ORDER BY no_faktur DESC LIMIT 16000;"
  );
  console.log(`✓ Query SEMUA 15.183 Faktur Inti: ${Date.now() - t0} ms!`);
}

addIndexAndBenchmark().catch(console.error);

const { connect } = require('@tidbcloud/serverless');

const url = 'mysql://3DfsJSnw7rByU61.root:Dpit5LwtKBfe2eYl@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}';

async function testConnection() {
  console.log('Connecting to TiDB Cloud Serverless...');
  const conn = connect({ url });

  try {
    const res = await conn.execute('SELECT VERSION() as version, NOW() as server_time;');
    console.log('✓ Successfully connected to TiDB Cloud!');
    console.log('Result:', res);

    // Create Table for Fakturs if not exists
    console.log('Creating fakturs archive table if not exists...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS fakturs_archive (
        invoice_key VARCHAR(50) PRIMARY KEY,
        no_faktur VARCHAR(30) NOT NULL,
        no_sales_order VARCHAR(100),
        customer_name VARCHAR(255),
        order_date VARCHAR(30),
        transaction_date VARCHAR(30),
        jenis_transaksi VARCHAR(10),
        kategori VARCHAR(10),
        kategori_produk VARCHAR(30),
        status_cetak TINYINT(1) DEFAULT 0,
        printed_at VARCHAR(50),
        printed_by VARCHAR(50),
        total_harga DECIMAL(15, 2) DEFAULT 0.00,
        items_json JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tx_date (transaction_date),
        INDEX idx_order_date (order_date),
        INDEX idx_kategori (kategori),
        INDEX idx_customer (customer_name(50))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ Table fakturs_archive is ready!');

    const tableInfo = await conn.execute('DESCRIBE fakturs_archive;');
    console.log('Table structure verified:', tableInfo.length, 'columns.');

    const stats = await conn.execute('SELECT COUNT(*) as total, SUM(status_cetak) as total_printed FROM fakturs_archive;');
    console.log('Archive Stats:', stats[0]);

    const sample = await conn.execute('SELECT invoice_key, no_faktur, no_sales_order, customer_name, status_cetak, order_date, total_harga FROM fakturs_archive LIMIT 3;');
    console.log('Sample Invoices in TiDB:', sample);
  } catch (err) {
    console.error('Error connecting to TiDB:', err);
  }
}

testConnection();

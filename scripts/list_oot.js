const XLSX = require('xlsx');
const path = require('path');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const prekWb = XLSX.readFile(path.join(downloadsDir, 'Product Prekursor dan OOT.xlsx'));
const sheet = prekWb.Sheets['Sheet1'];
const data = XLSX.utils.sheet_to_json(sheet);

console.log('--- ALL OOT ITEMS in Product Prekursor dan OOT.xlsx ---');
data.filter(d => (d['Klasifikasi'] || d['Kategori Warehouse (11 Kategori)']) === 'OOT').forEach((d, i) => {
  console.log(`${i+1}. [${d['Kode Oracle'] || d['Kode Accruate'] || '-'}] ${d['Nama Barang']}`);
});

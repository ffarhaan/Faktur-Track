const XLSX = require('xlsx');
const path = require('path');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const prekWb = XLSX.readFile(path.join(downloadsDir, 'Product Prekursor dan OOT.xlsx'));
const ccpWb = XLSX.readFile(path.join(downloadsDir, 'PRODUCT CCP.xlsx'));

const prekData = XLSX.utils.sheet_to_json(prekWb.Sheets['Sheet1']);
const ccpData = XLSX.utils.sheet_to_json(ccpWb.Sheets['Sheet1']);

console.log('--- ALL 118 PREKURSOR & OOT ITEMS ---');
prekData.forEach((d, i) => {
  const cat = d['Klasifikasi'] || d['Kategori Warehouse (11 Kategori)'];
  console.log(`${i+1}. [${cat}] ${d['Nama Barang']}`);
});

console.log('\n--- ALL 70 CCP ITEMS ---');
ccpData.forEach((d, i) => {
  console.log(`${i+1}. [${d['Kode Oracle'] || d['Kode Accruate'] || '-'}] ${d['Nama Barang']}`);
});

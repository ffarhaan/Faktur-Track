const XLSX = require('xlsx');
const path = require('path');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const files = [
  'Product Prekursor dan OOT.xlsx',
  'PRODUCT CCP.xlsx',
  'Product Alkes.xlsx',
  'Product Farma .xlsx'
];

files.forEach(f => {
  const wb = XLSX.readFile(path.join(downloadsDir, f));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log('File:', f, 'Total Rows:', rows.length);
  if (rows.length > 0) {
    console.log('  Keys:', Object.keys(rows[0]));
    console.log('  Sample 0:', rows[0]);
  }
});

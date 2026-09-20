const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const files = [
  'Product Farma .xlsx',
  'Product Alkes.xlsx',
  'PRODUCT CCP.xlsx',
  'Product Prekursor dan OOT.xlsx'
];

files.forEach(fileName => {
  const filePath = path.join(downloadsDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', fileName);
    return;
  }
  const wb = XLSX.readFile(filePath);
  console.log('====================================');
  console.log('FILE:', fileName);
  wb.SheetNames.forEach(sheet => {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
    console.log(`Sheet: ${sheet}, rows: ${data.length}`);
    data.forEach((row, i) => {
      const str = JSON.stringify(row);
      if (
        str.includes('1803') || 
        str.includes('9279') || 
        str.toUpperCase().includes('PROCOLD') || 
        str.toUpperCase().includes('OBH COMBI')
      ) {
        console.log(`  Row ${i}:`, row);
      }
    });
  });
});

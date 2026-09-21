const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const rptFile = path.join(downloadsDir, 'XXCUST_OM_GROSS_PROFIT_RPT.xlsx');

const wb = XLSX.readFile(rptFile);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

console.log('--- ALL COLUMNS IN HEADER (Row 11) ---');
rows[11].forEach((col, idx) => {
  console.log(`Col ${idx}: ${col}`);
});

console.log('\n--- SAMPLE 5 ROWS ---');
for (let i = 12; i < 17; i++) {
  console.log(`\nRow ${i}:`);
  rows[i].forEach((val, idx) => {
    if (val !== null && val !== undefined && val !== '') {
      console.log(`  [${rows[11][idx] || idx}]: ${val}`);
    }
  });
}

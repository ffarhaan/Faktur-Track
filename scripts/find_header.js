const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const rptFile = path.join(downloadsDir, 'XXCUST_OM_GROSS_PROFIT_RPT.xlsx');

const wb = XLSX.readFile(rptFile);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

for (let i = 0; i < Math.min(25, rows.length); i++) {
  const row = rows[i];
  if (Array.isArray(row) && row.some(c => String(c).includes('Item') || String(c).includes('Description') || String(c).includes('Order Number'))) {
    console.log(`Found Header at Row ${i}:`, row);
    console.log(`Sample Data Row ${i+1}:`, rows[i+1]);
    break;
  }
}

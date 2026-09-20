const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const rptFile = path.join(downloadsDir, 'XXCUST_OM_GROSS_PROFIT_RPT.xlsx');

if (fs.existsSync(rptFile)) {
  const wb = XLSX.readFile(rptFile);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  console.log('Total Rows in XXCUST_OM_GROSS_PROFIT_RPT:', rows.length);
  console.log('Header Row 0:', rows[0]);
  console.log('Sample Row 1:', rows[1]);
}

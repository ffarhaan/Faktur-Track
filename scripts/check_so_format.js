const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const rptFile = path.join(downloadsDir, 'XXCUST_OM_GROSS_PROFIT_RPT.xlsx');

const wb = XLSX.readFile(rptFile);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const custToSOs = new Map();

for (let i = 12; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < 15) continue;
  const cust = String(r[3] || '').trim();
  const so = String(r[12] || '').trim();
  const inv = String(r[5] || '').trim();
  if (!cust || !so) continue;

  if (!custToSOs.has(cust)) {
    custToSOs.set(cust, new Set());
  }
  custToSOs.get(cust).add(so);
}

console.log('--- CHECKING SO NUMBERS FOR THE SAME CUSTOMER ---');
let checked = 0;
custToSOs.forEach((soSet, cust) => {
  if (soSet.size > 3 && checked < 10) {
    checked++;
    console.log(`\nCustomer: "${cust}" (Total Unique SOs: ${soSet.size})`);
    console.log('Sample SOs:', Array.from(soSet).slice(0, 8));
  }
});

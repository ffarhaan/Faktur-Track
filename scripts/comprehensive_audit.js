const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';

// Load the 4 authoritative master files
const farmaWb = XLSX.readFile(path.join(downloadsDir, 'Product Farma .xlsx'));
const alkesWb = XLSX.readFile(path.join(downloadsDir, 'Product Alkes.xlsx'));
const ccpWb = XLSX.readFile(path.join(downloadsDir, 'PRODUCT CCP.xlsx'));
const prekWb = XLSX.readFile(path.join(downloadsDir, 'Product Prekursor dan OOT.xlsx'));

const farmaRows = XLSX.utils.sheet_to_json(farmaWb.Sheets[farmaWb.SheetNames[0]]);
const alkesRows = XLSX.utils.sheet_to_json(alkesWb.Sheets[alkesWb.SheetNames[0]]);
const ccpRows = XLSX.utils.sheet_to_json(ccpWb.Sheets[ccpWb.SheetNames[0]]);
const prekRows = XLSX.utils.sheet_to_json(prekWb.Sheets[prekWb.SheetNames[0]]);

console.log('--- Master File Counts ---');
console.log('Farma:', farmaRows.length);
console.log('Alkes:', alkesRows.length);
console.log('CCP:', ccpRows.length);
console.log('Prekursor & OOT:', prekRows.length);

// Let's check the current getProductCategory logic against all transactions in XXCUST_OM_GROSS_PROFIT_RPT.xlsx
const txFiles = fs.readdirSync(downloadsDir).filter(f => f.includes('GROSS_PROFIT') || f.includes('faktur') || f.includes('Faktur'));

console.log('\n--- Transaction Files to Audit ---', txFiles);


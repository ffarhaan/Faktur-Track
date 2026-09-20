const XLSX = require('xlsx');
const path = require('path');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const prekWb = XLSX.readFile(path.join(downloadsDir, 'Product Prekursor dan OOT.xlsx'));
const ccpWb = XLSX.readFile(path.join(downloadsDir, 'PRODUCT CCP.xlsx'));
const alkesWb = XLSX.readFile(path.join(downloadsDir, 'Product Alkes.xlsx'));
const farmaWb = XLSX.readFile(path.join(downloadsDir, 'Product Farma .xlsx'));

console.log('--- Prekursor & OOT Sheet names & rows ---');
prekWb.SheetNames.forEach(s => {
  const data = XLSX.utils.sheet_to_json(prekWb.Sheets[s]);
  console.log(s, data.length, 'rows');
  const ootItems = data.filter(d => (d['Klasifikasi'] || d['Kategori Warehouse (11 Kategori)']) === 'OOT');
  const prekItems = data.filter(d => (d['Klasifikasi'] || d['Kategori Warehouse (11 Kategori)']) === 'Prekursor');
  console.log('  OOT count:', ootItems.length);
  console.log('  Prekursor count:', prekItems.length);
});

console.log('--- CCP Sheet names & rows ---');
ccpWb.SheetNames.forEach(s => {
  const data = XLSX.utils.sheet_to_json(ccpWb.Sheets[s]);
  console.log(s, data.length, 'rows');
});

console.log('--- Alkes Sheet names & rows ---');
alkesWb.SheetNames.forEach(s => {
  const data = XLSX.utils.sheet_to_json(alkesWb.Sheets[s]);
  console.log(s, data.length, 'rows');
});

console.log('--- Farma Sheet names & rows ---');
farmaWb.SheetNames.forEach(s => {
  const data = XLSX.utils.sheet_to_json(farmaWb.Sheets[s]);
  console.log(s, data.length, 'rows');
});

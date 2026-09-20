const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const masterProduct = require('../lib/masterProduct.json');
const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';

const alkesWb = XLSX.readFile(path.join(downloadsDir, 'Product Alkes.xlsx'));
const alkesRows = XLSX.utils.sheet_to_json(alkesWb.Sheets[alkesWb.SheetNames[0]]);

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/apotik/g, "apotek")
    .replace(/[^a-z0-9]/g, "");
}

const productCodeMap = {};
const productNameMap = {};
const productList = [];

masterProduct.forEach(p => {
  const cat = String(p.kategori || "").trim().toUpperCase();
  const codes = [p.kodeBarang, p.kodeOracle, p.kodeAccurate].filter(Boolean);
  codes.forEach(c => {
    const cleanCode = String(c).trim();
    if (cleanCode) {
      productCodeMap[cleanCode] = cat;
      const numOnly = cleanCode.replace(/[^0-9]/g, "");
      if (numOnly) productCodeMap[numOnly] = cat;
    }
  });

  if (p.namaBarang) {
    const norm = normalize(p.namaBarang);
    productNameMap[norm] = cat;
    if (norm.length >= 8) {
      productList.push({ norm, cat });
    }
  }
});

let alkesMismatches = 0;
alkesRows.forEach((r, idx) => {
  const name = String(r['Nama Barang'] || '').trim();
  const codeAcc = String(r['Kode Accruate'] || r['Kode Accurate'] || '').trim();
  const codeOra = String(r['Kode Oracle'] || '').trim();
  const norm = normalize(name);

  const byCode = productCodeMap[codeOra] || productCodeMap[codeAcc];
  const byName = productNameMap[norm];

  if (byCode && byCode !== 'ALKES') {
    alkesMismatches++;
    console.log(`Mismatch by code: [${codeOra || codeAcc}] ${name} -> ${byCode}`);
  }
  if (byName && byName !== 'ALKES') {
    alkesMismatches++;
    console.log(`Mismatch by name: ${name} -> ${byName}`);
  }
});

console.log('--- ALKES MASTER AUDIT ---');
console.log('Total Alkes Rows:', alkesRows.length);
console.log('Alkes Mismatches:', alkesMismatches);

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// 1. Load Prekursor & OOT (118 items)
const prekWb = XLSX.readFile(path.join(downloadsDir, 'Product Prekursor dan OOT.xlsx'));
const prekData = XLSX.utils.sheet_to_json(prekWb.Sheets['Sheet1']);

// 2. Load CCP (70 items)
const ccpWb = XLSX.readFile(path.join(downloadsDir, 'PRODUCT CCP.xlsx'));
const ccpData = XLSX.utils.sheet_to_json(ccpWb.Sheets['Sheet1']);

// 3. Load Alkes (824 items)
const alkesWb = XLSX.readFile(path.join(downloadsDir, 'Product Alkes.xlsx'));
const alkesData = XLSX.utils.sheet_to_json(alkesWb.Sheets['Sheet1']);

// 4. Load Farma (6166 items)
const farmaWb = XLSX.readFile(path.join(downloadsDir, 'Product Farma .xlsx'));
const farmaData = XLSX.utils.sheet_to_json(farmaWb.Sheets['Sheet1']);

// Map of normalized name to Prekursor / OOT classification
const prekOotNameMap = new Map();
prekData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const klas = String(r['Klasifikasi'] || r['Kategori Warehouse (11 Kategori)'] || '').trim();
  const cat = klas.toUpperCase() === 'OOT' ? 'OOT' : 'PREKURSOR';
  if (name) {
    prekOotNameMap.set(normalize(name), {
      name,
      cat,
      klasifikasi: klas,
      kategoriWarehouse: r['Kategori Warehouse (11 Kategori)'] || cat
    });
  }
});

// Map of normalized name to CCP
const ccpNameMap = new Map();
ccpData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const codeAcc = String(r['Kode Accruate'] || r['Kode Accurate'] || '').trim();
  const codeOra = String(r['Kode Oracle'] || '').trim();
  if (name) {
    ccpNameMap.set(normalize(name), {
      name,
      codeAcc,
      codeOra,
      cat: 'CCP',
      klasifikasi: 'CCP',
      kategoriWarehouse: 'CCP'
    });
  }
});

// Map of normalized name to Alkes
const alkesNameMap = new Map();
alkesData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const codeAcc = String(r['Kode Accruate'] || r['Kode Accurate'] || '').trim();
  const codeOra = String(r['Kode Oracle'] || '').trim();
  if (name) {
    alkesNameMap.set(normalize(name), {
      name,
      codeAcc,
      codeOra,
      cat: 'ALKES',
      klasifikasi: r['Klasifikasi'] || 'Alat Kesehatan',
      kategoriWarehouse: r['Kategori Warehouse (11 Kategori)'] || 'Alat Kesehatan'
    });
  }
});

const allProducts = [];
const seenKeys = new Set();

// Add Farma products, but check if they belong to Prekursor, OOT, CCP, or Alkes override
farmaData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const codeAcc = String(r['Kode Accruate'] || r['Kode Accurate'] || '').trim();
  const codeOra = String(r['Kode Oracle'] || '').trim();
  const normName = normalize(name);

  let category = 'FARMA';
  let klasifikasi = r['Klasifikasi'] || 'Obat Bebas';
  let kategoriWarehouse = r['Kategori Warehouse (11 Kategori)'] || 'Obat Lain';

  if (prekOotNameMap.has(normName)) {
    const override = prekOotNameMap.get(normName);
    category = override.cat;
    klasifikasi = override.klasifikasi;
    kategoriWarehouse = override.kategoriWarehouse;
  } else if (ccpNameMap.has(normName)) {
    category = 'CCP';
    klasifikasi = 'CCP';
    kategoriWarehouse = 'CCP';
  } else if (alkesNameMap.has(normName)) {
    category = 'ALKES';
    klasifikasi = 'Alat Kesehatan';
    kategoriWarehouse = 'Alat Kesehatan';
  }

  const prodKey = `${codeOra || codeAcc || ''}::${normName}`;
  if (!seenKeys.has(prodKey)) {
    seenKeys.add(prodKey);
    allProducts.push({
      kodeBarang: codeOra || codeAcc || '',
      kodeOracle: codeOra,
      kodeAccurate: codeAcc,
      namaBarang: name,
      kategori: category,
      klasifikasi: klasifikasi,
      kategoriWarehouse: kategoriWarehouse
    });
  }
});

// Add Alkes products
alkesData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const codeAcc = String(r['Kode Accruate'] || r['Kode Accurate'] || '').trim();
  const codeOra = String(r['Kode Oracle'] || '').trim();
  const normName = normalize(name);
  const prodKey = `${codeOra || codeAcc || ''}::${normName}`;

  if (!seenKeys.has(prodKey)) {
    seenKeys.add(prodKey);
    allProducts.push({
      kodeBarang: codeOra || codeAcc || '',
      kodeOracle: codeOra,
      kodeAccurate: codeAcc,
      namaBarang: name,
      kategori: 'ALKES',
      klasifikasi: r['Klasifikasi'] || 'Alat Kesehatan',
      kategoriWarehouse: r['Kategori Warehouse (11 Kategori)'] || 'Alat Kesehatan'
    });
  }
});

// Add CCP products
ccpData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const codeAcc = String(r['Kode Accruate'] || r['Kode Accurate'] || '').trim();
  const codeOra = String(r['Kode Oracle'] || '').trim();
  const normName = normalize(name);
  const prodKey = `${codeOra || codeAcc || ''}::${normName}`;

  if (!seenKeys.has(prodKey)) {
    seenKeys.add(prodKey);
    allProducts.push({
      kodeBarang: codeOra || codeAcc || '',
      kodeOracle: codeOra,
      kodeAccurate: codeAcc,
      namaBarang: name,
      kategori: 'CCP',
      klasifikasi: 'CCP',
      kategoriWarehouse: 'CCP'
    });
  }
});

// Add Prekursor & OOT products
prekData.forEach(r => {
  const name = String(r['Nama Barang'] || '').trim();
  const klas = String(r['Klasifikasi'] || r['Kategori Warehouse (11 Kategori)'] || '').trim();
  const cat = klas.toUpperCase() === 'OOT' ? 'OOT' : 'PREKURSOR';
  const normName = normalize(name);
  const prodKey = `::${normName}`;

  // If not yet in list, add it
  if (!seenKeys.has(prodKey)) {
    seenKeys.add(prodKey);
    allProducts.push({
      kodeBarang: '',
      kodeOracle: '',
      kodeAccurate: '',
      namaBarang: name,
      kategori: cat,
      klasifikasi: klas,
      kategoriWarehouse: r['Kategori Warehouse (11 Kategori)'] || cat
    });
  }
});

console.log('Total Master Products Compiled:', allProducts.length);

const catCounts = {};
allProducts.forEach(p => {
  catCounts[p.kategori] = (catCounts[p.kategori] || 0) + 1;
});
console.log('Category breakdown:', catCounts);

// Save to lib/masterProduct.json
const outputPath = path.join(__dirname, '..', 'lib', 'masterProduct.json');
fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), 'utf-8');
console.log('Saved masterProduct.json successfully to', outputPath);

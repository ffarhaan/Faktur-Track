const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const master2P = require('../lib/master2P.json');
const masterApotek = require('../lib/masterApotek.json');

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/apotik/g, "apotek")
    .replace(/[^a-z0-9]/g, "");
}

// 2P names & codes
const twoPNames = new Map();
const twoPCodes = new Set();

master2P.forEach(item => {
  const normMbi = normalize(item.namaApotekMBI);
  const normMerch = normalize(item.namaMerchant);
  const rawCode = String(item.codeNum || '').trim();
  if (rawCode) twoPCodes.add(rawCode);
  
  if (item.namaApotekMBI) {
    twoPNames.set(normMbi, {
      namaMBI: item.namaApotekMBI,
      merchant: item.namaMerchant,
      code: item.codeNum,
      zona: item.zona
    });
  }
  if (item.namaMerchant) {
    twoPNames.set(normMerch, {
      namaMBI: item.namaApotekMBI,
      merchant: item.namaMerchant,
      code: item.codeNum,
      zona: item.zona
    });
  }
});

// Let's check masterApotek (which has 2600+ 3P apotek)
const overlappingApotek = [];

Object.entries(masterApotek).forEach(([name, val]) => {
  const norm = normalize(name);
  if (twoPNames.has(norm)) {
    const twoPInfo = twoPNames.get(norm);
    overlappingApotek.push({
      namaApotek: name,
      nama2PMBI: twoPInfo.namaMBI,
      nama2PMerchant: twoPInfo.merchant,
      code2P: twoPInfo.code,
      zona: twoPInfo.zona
    });
  }
});

console.log('--- APOTEK YANG NAMA NYA SAMA / MIRIP ANTARA 2P DAN 3P ---');
console.log('Total Overlapping Apotek in Master:', overlappingApotek.length);
overlappingApotek.forEach((a, i) => {
  console.log(`${i+1}. Nama Apotek: "${a.namaApotek}" | 2P Merchant: "${a.nama2PMerchant}" | Kode Customer 2P: ${a.code2P || '-'} | Zona: ${a.zona || '-'}`);
});

// Also check in transaction records: pharmacies that have both 2P and 3P transactions
const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const rptFile = path.join(downloadsDir, 'XXCUST_OM_GROSS_PROFIT_RPT.xlsx');

if (fs.existsSync(rptFile)) {
  const wb = XLSX.readFile(rptFile);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  const txByCust = new Map();

  for (let i = 12; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 15) continue;
    const cust = String(r[3] || '').trim();
    const inv = String(r[5] || '').trim();
    const orderNum = String(r[12] || '').trim();
    const jenisTx = String(r[2] || '').trim(); // e.g. TRADE_3RD PARTY
    
    // Extract site id from orderNum (e.g. E2M96L-1575 -> 1575, GYD092-1803 -> 1803)
    let siteId = '';
    const match = orderNum.match(/^[A-Z0-9]+-(\d+)/);
    if (match) siteId = match[1];

    if (!cust) continue;

    if (!txByCust.has(cust)) {
      txByCust.set(cust, { totalInvoices: new Set(), sites: new Set(), sampleOrders: [] });
    }
    const cObj = txByCust.get(cust);
    if (inv) cObj.totalInvoices.add(inv);
    if (siteId) cObj.sites.add(siteId);
    if (cObj.sampleOrders.length < 3) cObj.sampleOrders.push(orderNum);
  }

  console.log('\n--- TRANSAKSI NYATA: APOTEK DENGAN KODE SITE 2P vs 3P ---');
  let count2P = 0;
  txByCust.forEach((data, custName) => {
    const norm = normalize(custName);
    const has2PName = twoPNames.has(norm);
    const sites = Array.from(data.sites);
    const has2PSite = sites.some(s => twoPCodes.has(s));

    if (has2PName || has2PSite) {
      count2P++;
      console.log(`[${count2P}] Cust: "${custName}" | Invoices: ${data.totalInvoices.size} | Sites: [${sites.join(', ')}] | Has 2P Site: ${has2PSite} | In 2P Master: ${has2PName}`);
    }
  });
}

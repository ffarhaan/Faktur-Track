const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');



// Since parser.ts is typescript, let's load compiled or replicate the exact function with lib/masterProduct.json
const masterProduct = require('../lib/masterProduct.json');

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

function auditPrekOOT(itemDescription, itemCode) {
  if (itemCode) {
    const cleanCode = String(itemCode).trim();
    const cat = productCodeMap[cleanCode] || productCodeMap[cleanCode.replace(/[^0-9]/g, "")];
    if (cat === "PREKURSOR") return "Prekursor";
    if (cat === "OOT") return "OOT";
    if (cat === "FARMA" || cat === "ALKES" || cat === "CCP") return null;
  }

  if (itemDescription) {
    const norm = normalize(itemDescription);
    if (productNameMap[norm]) {
      const cat = productNameMap[norm];
      if (cat === "PREKURSOR") return "Prekursor";
      if (cat === "OOT") return "OOT";
      if (cat === "FARMA" || cat === "ALKES" || cat === "CCP") return null;
    }
  }

  if (!itemDescription || itemDescription === "-" || itemDescription === "Data DOO") return null;
  const s = " " + String(itemDescription).toUpperCase().replace(/[\t\r\n\s]+/g, " ") + " ";

  // Strict OOT
  if (/\bLAPISIV[- ]?T\b/.test(s)) return "OOT";
  if (/\bSILADEX\s+(ANTITUSSIVE|DMP)\b/.test(s)) return "OOT";
  if (/\bPANADOL\s+(FLU\s*(&|\+|DAN)\s*BATUK|BATUK\s*(&|\+|DAN)\s*FLU)\b/.test(s)) return "OOT";
  if (/\bWOODS(\s+PEPPERMINT)?\s+ANTITUSSIVE\b/.test(s)) return "OOT";
  if (/\bOB[H]?\s+COMBI\s+ANTITUSSIVE\b/.test(s)) return "OOT";
  if (/\b(GRANTUSIF|IFARSYL|PROMEDEX|LODECON\s+FORTE)\b/.test(s)) return "OOT";
  if (/\bBODREX\s+FLU\s+(DAN|&|\+)\s*BATUK\b/.test(s)) return "OOT";
  if (/\bMIXAGRIP\s+FLU\s+(DAN|&|\+)\s*BATUK\b/.test(s)) return "OOT";
  if (/\bPROCOLD\s+FLU\s+(DAN|&|\+)\s*BATUK\b/.test(s)) return "OOT";
  if (/\bVICKS\s+FORMULA\s+44\b/.test(s) || /\bFORMULA\s+44\b/.test(s)) return "OOT";
  if (/\bKONIDIN\b/.test(s) && !/\bANAKONIDIN\b/.test(s)) return "OOT";

  // Strict Prekursor
  if (/\bACTIFED\b/.test(s)) return "Prekursor";
  if (/\bALCO\b(?!\s*(HOL|KOHOL|N\b))/.test(s) && !/\bVALCOR\b/.test(s) && !/\bALCON\b/.test(s)) return "Prekursor";
  if (/\bALLERIN\b/.test(s)) return "Prekursor";
  if (/\bALPARA\b/.test(s)) return "Prekursor";
  if (/\bANADEX\b/.test(s) && !/\bLANADEXON\b/.test(s)) return "Prekursor";
  if (/\bANAKONIDIN\b/.test(s)) return "Prekursor";
  if (/\bCALORTUSIN\b/.test(s)) return "Prekursor";
  if (/\bCOPARCETIN\b/.test(s)) return "Prekursor";
  if (/\bDEMACOLIN\b/.test(s)) return "Prekursor";
  if (/\bDICOM\b/.test(s)) return "Prekursor";
  if (/\bDISUDRIN\b/.test(s)) return "Prekursor";
  if (/\bFLUTOP\b/.test(s)) return "Prekursor";
  if (/\bFLUVIR\b/.test(s)) return "Prekursor";
  if (/\bCROFED\b/.test(s)) return "Prekursor";
  if (/\bDECOLGEN\b/.test(s)) return "Prekursor";
  if (/\bINTUNAL\b/.test(s)) return "Prekursor";
  if (/\bLACOLDIN\b/.test(s)) return "Prekursor";
  if (/\bLANOS\b/.test(s) && !/\bLANOXIN\b/.test(s)) return "Prekursor";
  if (/\bDEXTRAL\b/.test(s) && !/\bDEXTROSE\b/.test(s)) return "Prekursor";
  if (/\bLAPIFED\b/.test(s)) return "Prekursor";
  if (/\bLAPISIV\b/.test(s) && !/\bLAPISIV[- ]?T\b/.test(s)) return "Prekursor";
  if (/\bMOLEXFLU\b/.test(s)) return "Prekursor";
  if (/\bFLUCADEX\b/.test(s)) return "Prekursor";
  if (/\bNEOZEP\b/.test(s)) return "Prekursor";
  if (/\bOBH\s+COMBI\b/.test(s) && /\b(BATUK\s*(PLUS|\&|\+)\s*FLU|BATUK\s*FLU|FLU)\b/.test(s)) return "Prekursor";
  if (/\bPANADOL\b.*\bCOLD\b/.test(s)) return "Prekursor";
  if (/\bPARATUSIN\b/.test(s)) return "Prekursor";
  if (/\bHUFAGRIPP\b.*\b(BP|BATUK\s*BERDAHAK\s*&\s*PILEK|BATUK\s*KERING\s*&\s*PILEK|FLU|PILEK)\b/.test(s)) return "Prekursor";
  if (/\bRHINOFED\b/.test(s)) return "Prekursor";
  if (/\bRHINOS\b/.test(s)) return "Prekursor";
  if (/\bRYVEL\s+PLUS\b/.test(s)) return "Prekursor";
  if (/\bSILADEX\b.*\b(COUGH\s*(&|\+|AND)\s*(COLD|FLU)|FLU)\b/.test(s) && !/\bHERBAL\b/.test(s)) return "Prekursor";
  if (/\bTELFAST\s+PLUS\b/.test(s)) return "Prekursor";
  if (/\bTRIAMINIC\b/.test(s)) return "Prekursor";
  if (/\bTRIFED\b/.test(s)) return "Prekursor";
  if (/\bTRIFEDRIN\b/.test(s)) return "Prekursor";
  if (/\bNALGESTAN\b/.test(s)) return "Prekursor";
  if (/\bSTOP\s+COLD\b/.test(s)) return "Prekursor";
  if (/\bDECOLSIN\b/.test(s)) return "Prekursor";
  if (/\bPIM[- ]?TRA[- ]?KOL\b/.test(s)) return "Prekursor";
  if (/\bFLUTROP\b/.test(s)) return "Prekursor";
  if (/\bNOZA\b/.test(s)) return "Prekursor";
  if (/\bINZA\b/.test(s)) return "Prekursor";
  if (/\bCOMTUSI\b.*\b(PILEK|ALERGI)\b/.test(s)) return "Prekursor";
  if (/\bEFLIN\b/.test(s)) return "Prekursor";
  if (/\bERICAF\b/.test(s)) return "Prekursor";
  if (/\bTERA[- ]?F\b/.test(s)) return "Prekursor";

  return null;
}

function auditGetCat(itemCode, itemDescription) {
  if (itemCode) {
    const cleanCode = String(itemCode).trim();
    if (productCodeMap[cleanCode]) return productCodeMap[cleanCode];
    const numOnly = cleanCode.replace(/[^0-9]/g, "");
    if (numOnly && productCodeMap[numOnly]) return productCodeMap[numOnly];
  }

  if (itemDescription) {
    const normDesc = normalize(itemDescription);
    if (productNameMap[normDesc]) return productNameMap[normDesc];
  }

  if (itemDescription || itemCode) {
    const prekOot = auditPrekOOT(itemDescription, itemCode);
    if (prekOot === "Prekursor") return "PREKURSOR";
    if (prekOot === "OOT") return "OOT";
  }

  if (itemDescription) {
    const normDesc = normalize(itemDescription);
    if (normDesc.length >= 8) {
      for (const item of productList) {
        if (normDesc.includes(item.norm) || item.norm.includes(normDesc)) {
          return item.cat;
        }
      }
    }

    const s = " " + String(itemDescription).toUpperCase() + " ";
    if (/\b(ALCOHOL|ALKOHOL|KASA|SPUIT|SYRINGE|JARUM|UNDERPAD|MASKER|INFUSION\s+SET|IV\s+CATHETER|HANDSCOON|GLOVES|TEST\s+PACK|URINE\s+BAG|THERMOMETER|TENSIMETER|SURGICAL|COTTON\s+BALL|KAPAS\s+PEMBALUT|SAFETY\s+BOX|ABOCATH|WINGS\s+NEEDLE|SURGICAL\s+TAPE|DERMAFIX|HYPAFIX|MICROPORE)\b/.test(s)) {
      return "ALKES";
    }
  }

  return "FARMA";
}

// Audit all rows in XXCUST_OM_GROSS_PROFIT_RPT.xlsx
const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const rptFile = path.join(downloadsDir, 'XXCUST_OM_GROSS_PROFIT_RPT.xlsx');
const wb = XLSX.readFile(rptFile);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const uniqueItems = new Map();

for (let i = 12; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < 15) continue;
  const itemCode = String(r[13] || '').trim();
  const itemDesc = String(r[14] || '').trim();
  const ppicCat = String(r[8] || '').trim(); // e.g. "PPIC CCP", "PPIC Reguler", etc.
  if (!itemDesc) continue;

  const key = `${itemCode}__${itemDesc}`;
  if (!uniqueItems.has(key)) {
    const cat = auditGetCat(itemCode, itemDesc);
    uniqueItems.set(key, {
      code: itemCode,
      desc: itemDesc,
      ppicCat,
      assignedCat: cat
    });
  }
}

console.log('Total unique items found in transaction report:', uniqueItems.size);

const catSummary = {};
const ootList = [];
const prekList = [];
const ccpList = [];
const alkesList = [];

uniqueItems.forEach(item => {
  catSummary[item.assignedCat] = (catSummary[item.assignedCat] || 0) + 1;
  if (item.assignedCat === 'OOT') ootList.push(item);
  if (item.assignedCat === 'PREKURSOR') prekList.push(item);
  if (item.assignedCat === 'CCP') ccpList.push(item);
  if (item.assignedCat === 'ALKES') alkesList.push(item);
});

console.log('\n--- Category Breakdown of Transaction Items ---');
console.log(catSummary);

console.log('\n--- ALL ITEMS CLASSIFIED AS OOT ---');
ootList.forEach((it, i) => console.log(`${i+1}. [${it.code}] ${it.desc} (PPIC: ${it.ppicCat})`));

console.log('\n--- ALL ITEMS CLASSIFIED AS PREKURSOR ---');
prekList.forEach((it, i) => console.log(`${i+1}. [${it.code}] ${it.desc} (PPIC: ${it.ppicCat})`));

console.log('\n--- ALL ITEMS CLASSIFIED AS CCP ---');
ccpList.forEach((it, i) => console.log(`${i+1}. [${it.code}] ${it.desc} (PPIC: ${it.ppicCat})`));

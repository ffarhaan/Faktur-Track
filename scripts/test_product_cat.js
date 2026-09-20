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

function getPrekursorOOTClassification(itemDescription, itemCode) {
  if (itemCode) {
    const clean = String(itemCode).trim();
    const cat = productCodeMap[clean] || productCodeMap[clean.replace(/[^0-9]/g, '')];
    if (cat === 'PREKURSOR') return 'Prekursor';
    if (cat === 'OOT') return 'OOT';
    if (cat === 'FARMA' || cat === 'ALKES' || cat === 'CCP') return null;
  }
  if (itemDescription) {
    const norm = normalize(itemDescription);
    if (productNameMap[norm]) {
      const cat = productNameMap[norm];
      if (cat === 'PREKURSOR') return 'Prekursor';
      if (cat === 'OOT') return 'OOT';
      if (cat === 'FARMA' || cat === 'ALKES' || cat === 'CCP') return null;
    }
  }

  if (!itemDescription || itemDescription === "-" || itemDescription === "Data DOO") return null;
  const s = " " + String(itemDescription).toUpperCase().replace(/[\t\r\n\s]+/g, " ") + " ";

  // OOT Matchers
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

  // Prekursor Matchers
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

function getProductCategory(itemCode, itemDescription) {
  // 1. Direct code lookup
  if (itemCode) {
    const cleanCode = String(itemCode).trim();
    if (productCodeMap[cleanCode]) return productCodeMap[cleanCode];
    const numOnly = cleanCode.replace(/[^0-9]/g, "");
    if (numOnly && productCodeMap[numOnly]) return productCodeMap[numOnly];
  }

  // 2. Direct name exact match
  if (itemDescription) {
    const normDesc = normalize(itemDescription);
    if (productNameMap[normDesc]) return productNameMap[normDesc];
  }

  // 3. Prekursor & OOT regulatory classification
  if (itemDescription || itemCode) {
    const prekOot = getPrekursorOOTClassification(itemDescription, itemCode);
    if (prekOot === "Prekursor") return "PREKURSOR";
    if (prekOot === "OOT") return "OOT";
  }

  // 4. Substring / partial match
  if (itemDescription) {
    const normDesc = normalize(itemDescription);
    if (normDesc.length >= 8) {
      for (const item of productList) {
        if (normDesc.includes(item.norm) || item.norm.includes(normDesc)) {
          return item.cat;
        }
      }
    }

    // 5. Keyword fallbacks for Alkes
    const s = " " + String(itemDescription).toUpperCase() + " ";
    if (/\b(ALCOHOL|ALKOHOL|KASA|SPUIT|SYRINGE|JARUM|UNDERPAD|MASKER|INFUSION\s+SET|IV\s+CATHETER|HANDSCOON|GLOVES|TEST\s+PACK|URINE\s+BAG|THERMOMETER|TENSIMETER|SURGICAL|COTTON\s+BALL|KAPAS\s+PEMBALUT|SAFETY\s+BOX|ABOCATH|WINGS\s+NEEDLE|SURGICAL\s+TAPE|DERMAFIX|HYPAFIX|MICROPORE)\b/.test(s)) {
      return "ALKES";
    }
  }

  return "FARMA";
}

const testCases = [
  { code: '1803', desc: 'PROCOLD FLU 24 BLISTER @ 6 KAPLET - KALBE FARMA', expected: 'FARMA' },
  { code: '9279', desc: 'OBH COMBI BATUK BERDAHAK MENTHOL SIRUP 100 ML - COMBIPHAR', expected: 'FARMA' },
  { code: '', desc: 'PROCOLD FLU DAN BATUK 24 BLISTER @ 6 KAPLET - KALBE FARMA', expected: 'OOT' },
  { code: '', desc: 'OBH COMBI PLUS BATUK FLU MENTHOL 100 ML - COMBIPHAR', expected: 'PREKURSOR' },
  { code: 'VAC011', desc: 'PNEUMOVAX 23 PREFILLED SYRINGE @ 0.5 ML - MERCK SHARP DOHME PHARMA', expected: 'CCP' },
  { code: '84461', desc: 'ALAT TEST UJI SIFILIS 1 PIECE - PAKAR BIOMEDIKA INDONESIA', expected: 'ALKES' }
];

testCases.forEach(tc => {
  const result = getProductCategory(tc.code, tc.desc);
  const status = result === tc.expected ? 'PASS' : `FAIL (got ${result})`;
  console.log(`[${status}] ${tc.code || '-'} | ${tc.desc} -> ${result} (expected ${tc.expected})`);
});

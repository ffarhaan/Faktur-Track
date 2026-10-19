import * as XLSX from "xlsx";
import { FakturRecord } from "./types";
import masterApotek from "./masterApotek.json";
import master2P from "./master2P.json";
import masterProduct from "./masterProduct.json";

const apotekMap = masterApotek as Record<string, string>;

export function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/apotik/g, "apotek")
    .replace(/[^a-z0-9]/g, "");
}

const normMap: Record<string, string> = {};
for (const [k, v] of Object.entries(apotekMap)) {
  normMap[normalize(k)] = v;
}

// 2P lookup structures
const master2PCodeMap = new Set<string>();
const master2PNameSet = new Set<string>();

master2P.forEach((item) => {
  if (item.codeNum) master2PCodeMap.add(item.codeNum);
  if (item.namaApotekMBI) master2PNameSet.add(normalize(item.namaApotekMBI));
  if (item.namaMerchant) master2PNameSet.add(normalize(item.namaMerchant));
});

// Product Category lookup structures (FARMA / ALKES / CCP / PREKURSOR / OOT)
const productCodeMap: Record<string, string> = {};
const productNameMap: Record<string, string> = {};
const productList: Array<{ norm: string; cat: string }> = [];

(masterProduct as Array<{
  kodeBarang?: string;
  kodeOracle?: string | number;
  kodeAccurate?: string | number;
  namaBarang: string;
  kategori: string;
}>).forEach((p) => {
  const cat = String(p.kategori || "").trim().toUpperCase();
  const codes = [p.kodeBarang, p.kodeOracle, p.kodeAccurate].filter(Boolean);
  codes.forEach((c) => {
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

export function getPrekursorOOTClassification(itemDescription?: string, itemCode?: string): "Prekursor" | "OOT" | null {
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

export function getProductCategory(
  itemCode?: string,
  itemDescription?: string,
  productOverrides?: Record<string, string>
): string {
  if (productOverrides && Object.keys(productOverrides).length > 0) {
    if (itemCode) {
      const cleanCode = String(itemCode).trim();
      if (productOverrides[cleanCode]) return productOverrides[cleanCode].toUpperCase();
      const numOnly = cleanCode.replace(/[^0-9]/g, "");
      if (numOnly && productOverrides[numOnly]) return productOverrides[numOnly].toUpperCase();
    }
    if (itemDescription) {
      const normDesc = normalize(itemDescription);
      if (productOverrides[normDesc]) return productOverrides[normDesc].toUpperCase();
      const trimmed = itemDescription.trim();
      if (productOverrides[trimmed]) return productOverrides[trimmed].toUpperCase();
    }
  }

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
    const prekOot = getPrekursorOOTClassification(itemDescription, itemCode);
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
    if (/\b(TABLET|TAB\b|KAPSUL|CAPSUL|CAP\b|SIRUP|SYRUP|DROP|INJEKSI|INJ\b|CREAM|KRIM|SALEP|OINTMENT|SUSPENSI|EMULSI|SUSP\b|LARUTAN|INFUS\b|PULVIS|SACHET)\b/.test(s)) {
      return "FARMA";
    }
    if (/\b(ALCOHOL|ALKOHOL|KASA|SPUIT|SYRINGE|JARUM|UNDERPAD|MASKER|INFUSION\s+SET|IV\s+CATHETER|HANDSCOON|GLOVES|TEST\s+PACK|URINE\s+BAG|THERMOMETER|TENSIMETER|SURGICAL|COTTON\s+BALL|KAPAS\s+PEMBALUT|SAFETY\s+BOX|ABOCATH|WINGS\s+NEEDLE|SURGICAL\s+TAPE|DERMAFIX|HYPAFIX|MICROPORE)\b/.test(s)) {
      return "ALKES";
    }
  }

  return "FARMA";
}

/**
 * ATURAN BAKU KLASIFIKASI TRANSAKSI (LOCKED):
 * - ORA: HANYA untuk PT Helios Alchemist Kesehatan / HAK / 1001.
 * - DOO: Semua transaksi reguler DOO.
 */
export function isOraCustomer(customerName?: string): boolean {
  const upperCust = String(customerName || "").toUpperCase().trim();
  return (
    upperCust.includes("HELIOS") ||
    upperCust.startsWith("HAK") ||
    upperCust.startsWith("IHC") ||
    upperCust.includes("CA-900001") ||
    upperCust === "1001"
  );
}

/**
 * ATURAN BAKU KATEGORI PRIORITAS (LOCKED):
 * - 1P: PT Helios (ORA) + Apotek Prioritas 1 DOO (Medika Prima, SBS, Pasti Hemat, Halomedika, Medika Akses).
 * - 2P: Apotek Prioritas 2 (dicek via master 2P).
 * - 3P: Apotek Reguler lainnya.
 */
export function categorize(
  jenisTransaksi: string,
  customerName: string,
  sourceFile?: string,
  shipToSite?: string,
  billToSite?: string
): "1P" | "2P" | "3P" {
  const cust = String(customerName || "").trim();
  const upper = cust.toUpperCase();
  const rawJenis = String(jenisTransaksi || "").toUpperCase();
  const rawSource = String(sourceFile || "").toUpperCase();

  if (
    rawSource.includes("ORA") ||
    rawJenis === "ORA" ||
    upper.includes("HELIOS") ||
    upper.startsWith("HAK") ||
    upper.startsWith("IHC") ||
    upper.includes("CA-900001") ||
    upper === "1001" ||
    upper.includes("HALOMEDIKA") ||
    upper.includes("MEDIKA PRIMA") ||
    upper.includes("SBS") ||
    upper.includes("PASTI HEMAT") ||
    upper.includes("MEDIKA AKSES")
  ) {
    return "1P";
  }

  if (shipToSite) {
    const num = String(shipToSite).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (num && master2PCodeMap.has(num)) return "2P";
  }

  if (billToSite) {
    const num = String(billToSite).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (num && master2PCodeMap.has(num)) return "2P";
  }

  const normCust = normalize(cust);
  if (master2PNameSet.has(normCust)) return "2P";

  const exact = apotekMap[cust.toLowerCase()];
  if (exact === "1P" || exact === "2P" || exact === "3P") return exact as "1P" | "2P" | "3P";

  const norm = normMap[normCust];
  if (norm === "1P" || norm === "2P" || norm === "3P") return norm as "1P" | "2P" | "3P";

  return "3P";
}

function detectDoubleInvoices(records: FakturRecord[]): void {
  const soInvMap: Record<string, Set<string>> = {};
  for (const r of records) {
    if (r.orderNumber && r.orderNumber !== "-") {
      if (!soInvMap[r.orderNumber]) soInvMap[r.orderNumber] = new Set();
      if (r.invoiceNumber && r.invoiceNumber !== "-") {
        soInvMap[r.orderNumber].add(r.invoiceNumber);
      }
    }
  }
  for (const r of records) {
    if (r.orderNumber && r.orderNumber !== "-" && soInvMap[r.orderNumber]?.size > 1) {
      r.isDoubleInv = true;
    }
  }
}

export function normalizeDateStr(v: unknown): string {
  if (!v) return "-";
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    }
  }
  let s = String(v).trim();
  if (!s || s === "-" || s === "0") return "-";
  const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mIso) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Number(mIso[3]))}/${pad(Number(mIso[2]))}/${mIso[1]}`;
  }
  const mSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mSlash) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Number(mSlash[1]))}/${pad(Number(mSlash[2]))}/${mSlash[3]}`;
  }
  const mMon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (mMon) {
    const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const pad = (n: number) => String(n).padStart(2, "0");
    const mon = months[mMon[2].toLowerCase()] || "01";
    return `${pad(Number(mMon[1]))}/${mon}/${mMon[3]}`;
  }
  return s;
}

function parseXXCUST(
  data: unknown[][],
  headerIdx: number,
  productOverrides?: Record<string, string>
): FakturRecord[] {
  const header = data[headerIdx] as string[];
  const colMap: Record<string, number> = {};
  header.forEach((h: string, i: number) => {
    if (h) {
      const key = h.trim().toLowerCase();
      if (!colMap[key]) colMap[key] = i;
      const cleanKey = key.replace(/[^a-z0-9]/g, "");
      if (!colMap[cleanKey]) colMap[cleanKey] = i;
    }
  });

  const getCol = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const lk = k.toLowerCase().trim();
      const ck = lk.replace(/[^a-z0-9]/g, "");
      if (colMap[lk] !== undefined) return colMap[lk];
      if (colMap[ck] !== undefined) return colMap[ck];
    }
    return undefined;
  };

  const idx = {
    jenisTransaksi: getCol("jenis transaksi", "jenis", "transaction type"),
    customerName: getCol("nama pelanggan", "customer name", "pelanggan", "customer"),
    customerCode: getCol("kode pelanggan", "customer code", "kode cust", "cust code"),
    invoiceNumber: getCol("no invoice ar", "ar number", "ar no", "no ar", "invoice number", "no invoice"),
    transactionDate: getCol("transaction date", "tanggal transaksi", "tgl transaksi"),
    orderDate: getCol("order date", "tanggal order", "date", "accounting date"),
    accountingDate: getCol("accounting date", "tanggal akuntansi"),
    orderNumber: getCol("order number", "order no", "no order", "no so", "so number"),
    itemCode: getCol("item code", "kode barang", "kode produk", "item"),
    itemDescription: getCol("item description", "nama barang", "deskripsi barang", "description"),
    qty: getCol("qty", "quantity", "jumlah"),
    uom: getCol("uom", "satuan", "unit"),
    lotNumber: getCol("lot number", "batch number", "lot", "batch"),
    totalHarga: getCol("total harga", "total amount", "amount", "total"),
    segmentation: getCol("segmentation", "segmen", "segmentasi"),
    kategoriPPIC: getCol("nama kategori product", "kategori product", "kategori produk"),
  };

  const records: FakturRecord[] = [];
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const val = (cIdx: number | undefined) => (cIdx !== undefined && cIdx >= 0 ? String(row[cIdx] ?? "").trim() : "");
    const rawVal = (cIdx: number | undefined) => (cIdx !== undefined && cIdx >= 0 ? row[cIdx] : undefined);

    const orderNumber = val(idx.orderNumber);
    const invoiceNumber = val(idx.invoiceNumber);
    if (!orderNumber && !invoiceNumber) continue;

    const customerName = val(idx.customerName);
    const customerCode = val(idx.customerCode);
    const isOra = isOraCustomer(customerName) || isOraCustomer(customerCode) || customerCode === "CA-900001";
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";
    const kategori = categorize(jenisTransaksi, customerName, jenisTransaksi);
    const cleanInv = invoiceNumber.replace(/-1P$/i, "");
    const invoiceKey = isOra ? `${cleanInv}-1P` : cleanInv;

    const itemCode = val(idx.itemCode);
    const itemDescription = val(idx.itemDescription);
    const rawSeg = val(idx.segmentation).toUpperCase();
    const rawPPIC = val(idx.kategoriPPIC).toUpperCase();
    let kategoriProduk = getProductCategory(itemCode, itemDescription, productOverrides) || undefined;

    // Official Oracle PPIC Category Mapping
    if (rawPPIC.includes("CCP") || rawSeg.includes("CCP")) {
      kategoriProduk = "CCP";
    } else if (rawSeg.includes("ALAT KESEHATAN") || rawSeg.includes("MEDIS HABIS PAKAI")) {
      kategoriProduk = "ALKES";
    } else if (
      rawSeg.includes("OBAT") ||
      rawSeg.includes("HERBAL") ||
      rawSeg.includes("VITAMIN") ||
      rawSeg.includes("SUPLEMEN") ||
      rawSeg.includes("KONSUMEN")
    ) {
      if (kategoriProduk !== "PREKURSOR" && kategoriProduk !== "OOT") {
        kategoriProduk = "FARMA";
      }
    }

    const klasifikasiObat =
      kategoriProduk === "PREKURSOR"
        ? "Prekursor"
        : kategoriProduk === "OOT"
        ? "OOT"
        : getPrekursorOOTClassification(itemDescription, itemCode) || undefined;

    records.push({
      orderDate: normalizeDateStr(rawVal(idx.orderDate) ?? val(idx.orderDate)),
      transactionDate: idx.transactionDate !== undefined ? normalizeDateStr(rawVal(idx.transactionDate) ?? val(idx.transactionDate)) : undefined,
      orderNumber: orderNumber || "-",
      invoiceNumber: invoiceNumber || "-",
      invoiceKey,
      jenisTransaksi,
      customerName: customerName || "-",
      itemCode: itemCode || "-",
      itemDescription: itemDescription || "-",
      qty: (rawVal(idx.qty) as number | string) ?? 0,
      uom: val(idx.uom) || "-",
      lotNumber: val(idx.lotNumber) || "-",
      totalHarga: Number(rawVal(idx.totalHarga) ?? 0),
      kategori,
      kategoriProduk,
      klasifikasiObat,
      isDoubleInv: false,
      sourceFile: "XXCUST",
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

function parseHTMLTable(html: string): FakturRecord[] {
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
  const stripHtml = (s: string) =>
    s
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"')
      .trim();

  let headerCells: string[] = [];
  let trMatch: RegExpExecArray | null;
  const rawRows: string[][] = [];

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowContent = trMatch[1];
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }
    if (cells.length > 0) rawRows.push(cells);
  }

  let dataStartIdx = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const texts = rawRows[i];
    if (texts.some((t) => t.toLowerCase().includes("reference"))) {
      headerCells = texts;
      dataStartIdx = i + 1;
      break;
    }
  }

  if (!headerCells.length) throw new Error("Header tabel tidak ditemukan di file export.");

  const colMap: Record<string, number> = {};
  headerCells.forEach((h, i) => {
    const s = h.toLowerCase().trim();
    if (s === "transaction date" || (!colMap["txDate"] && s.includes("transaction date"))) colMap["txDate"] = i;
    if (s === "accounting date" || (!colMap["date"] && s.includes("date"))) colMap["date"] = i;
    if (s === "reference") colMap["so"] = i;
    if (s === "transaction number" || (!colMap["inv"] && s.includes("transaction number"))) colMap["inv"] = i;
    if (s === "ship-to customer") colMap["customer"] = i;
    if (s === "bill-to customer") colMap["billTo"] = i;
    if (s === "ship-to site" || (!colMap["shipSite"] && s.includes("ship-to site"))) colMap["shipSite"] = i;
    if (s === "bill-to customer site" || (!colMap["billSite"] && s.includes("bill-to customer site"))) colMap["billSite"] = i;
    if (s === "transaction source" || (!colMap["source"] && s.includes("transaction source"))) colMap["source"] = i;
    if (s === "transaction type" || (!colMap["jenis"] && s.includes("transaction type"))) colMap["jenis"] = i;
    if (s === "entered amount" || (!colMap["amount"] && s.includes("entered amount"))) colMap["amount"] = i;
  });

  const records: FakturRecord[] = [];
  for (let i = dataStartIdx; i < rawRows.length; i++) {
    const texts = rawRows[i];
    if (!texts || texts.length < 3) continue;
    if (texts[0] === "Context Value") continue;

    const soVal = texts[colMap["so"] ?? 1] || "";
    const invVal = texts[colMap["inv"] ?? 2] || "";
    if (!soVal && !invVal) continue;

    const customerName = (colMap["customer"] !== undefined && texts[colMap["customer"]])
      ? texts[colMap["customer"]]
      : (colMap["billTo"] !== undefined && texts[colMap["billTo"]])
      ? texts[colMap["billTo"]]
      : "";
    const rawSource = String((colMap["source"] !== undefined ? texts[colMap["source"]] : "") || "").trim().toUpperCase();
    const isOra = rawSource.includes("ORA_") || isOraCustomer(customerName);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";

    const shipSite = colMap["shipSite"] !== undefined ? texts[colMap["shipSite"]] : "";
    const billSite = colMap["billSite"] !== undefined ? texts[colMap["billSite"]] : "";

    const kategori = isOra ? "1P" : categorize(jenisTransaksi, customerName, jenisTransaksi, shipSite, billSite);
    const cleanInv = invVal.replace(/-1P$/i, "");
    const invoiceKey = isOra ? `${cleanInv}-1P` : cleanInv;
    const finalSO = isOra ? "-" : (soVal || "-");
    const txVal = colMap["txDate"] !== undefined ? texts[colMap["txDate"]] : undefined;

    records.push({
      orderDate: normalizeDateStr(texts[colMap["date"] ?? 0] || ""),
      transactionDate: txVal ? normalizeDateStr(txVal) : undefined,
      orderNumber: finalSO,
      invoiceNumber: invVal,
      invoiceKey,
      jenisTransaksi,
      customerName,
      itemCode: "-",
      itemDescription: "-",
      qty: "-",
      uom: "-",
      lotNumber: "-",
      totalHarga: Number(texts[colMap["amount"] ?? 11]?.replace(/[^0-9.-]/g, "") || 0),
      kategori,
      isDoubleInv: false,
      sourceFile: "EXPORT",
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

function parseExportArray(data: unknown[][], headerIdx: number): FakturRecord[] {
  const header = data[headerIdx] as string[];
  const colMap: Record<string, number> = {};
  header.forEach((h, i) => {
    const s = String(h || "").toLowerCase().trim();
    if (s === "transaction date" || (!colMap["txDate"] && s.includes("transaction date"))) colMap["txDate"] = i;
    if (s === "accounting date" || (!colMap["date"] && s.includes("date"))) colMap["date"] = i;
    if (s === "reference") colMap["so"] = i;
    if (s === "transaction number" || (!colMap["inv"] && s.includes("transaction number"))) colMap["inv"] = i;
    if (s === "ship-to customer") colMap["customer"] = i;
    if (s === "bill-to customer") colMap["billTo"] = i;
    if (s === "ship-to site" || (!colMap["shipSite"] && s.includes("ship-to site"))) colMap["shipSite"] = i;
    if (s === "bill-to customer site" || (!colMap["billSite"] && s.includes("bill-to customer site"))) colMap["billSite"] = i;
    if (s === "transaction source" || (!colMap["source"] && s.includes("transaction source"))) colMap["source"] = i;
    if (s === "entered amount" || (!colMap["amount"] && s.includes("entered amount"))) colMap["amount"] = i;
  });

  const records: FakturRecord[] = [];
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 3) continue;

    const soVal = String(row[colMap["so"] ?? 1] ?? "").trim();
    const invVal = String(row[colMap["inv"] ?? 2] ?? "").trim();
    if (!soVal && !invVal) continue;
    if (soVal.toLowerCase() === "reference" || invVal.toLowerCase().includes("transaction")) continue;

    const customerName = String(
      (colMap["customer"] !== undefined && row[colMap["customer"]] ? row[colMap["customer"]] : "") ||
      (colMap["billTo"] !== undefined && row[colMap["billTo"]] ? row[colMap["billTo"]] : "") ||
      row[3] || ""
    ).trim();

    const rawSource = String((colMap["source"] !== undefined ? row[colMap["source"]] : row[4]) || "").trim().toUpperCase();
    const isOra = rawSource.includes("ORA_") || isOraCustomer(customerName);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";

    const shipSite = String((colMap["shipSite"] !== undefined ? row[colMap["shipSite"]] : "") || "");
    const billSite = String((colMap["billSite"] !== undefined ? row[colMap["billSite"]] : "") || "");

    const kategori = isOra ? "1P" : categorize(jenisTransaksi, customerName, jenisTransaksi, shipSite, billSite);
    const cleanInv = invVal.replace(/-1P$/i, "");
    const invoiceKey = isOra ? `${cleanInv}-1P` : cleanInv;
    const rawAmount = row[colMap["amount"] ?? 11];
    const totalHarga = typeof rawAmount === "number" ? rawAmount : Number(String(rawAmount || "").replace(/[^0-9.-]/g, "") || 0);
    const finalSO = isOra ? "-" : (soVal || "-");
    const txVal = colMap["txDate"] !== undefined ? row[colMap["txDate"]] : undefined;

    records.push({
      orderDate: normalizeDateStr(row[colMap["date"] ?? 0]),
      transactionDate: txVal ? normalizeDateStr(txVal) : undefined,
      orderNumber: finalSO,
      invoiceNumber: invVal,
      invoiceKey,
      jenisTransaksi,
      customerName,
      itemCode: "-",
      itemDescription: "-",
      qty: "-",
      uom: "-",
      lotNumber: "-",
      totalHarga,
      kategori,
      isDoubleInv: false,
      sourceFile: "EXPORT",
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

export async function parseExcelFile(
  file: File,
  productOverrides?: Record<string, string>
): Promise<FakturRecord[]> {
  const buffer = await file.arrayBuffer();

  // 1. Try HTML format for Oracle .xls exports
  const headerSample = new TextDecoder().decode(buffer.slice(0, 4096)).toLowerCase();
  if (
    headerSample.includes("<table") ||
    headerSample.includes("<tr") ||
    headerSample.includes("<html") ||
    headerSample.includes("<!doctype") ||
    headerSample.includes("xmlns:") ||
    headerSample.includes("<?xml")
  ) {
    const fullText = new TextDecoder().decode(buffer);
    return parseHTMLTable(fullText);
  }

  // 2. Binary Excel format (.xlsx)
  try {
    const wb = XLSX.read(buffer, {
      type: "array",
      dense: true,
      cellFormula: false,
      cellHTML: false,
      cellText: false,
      cellStyles: false,
    });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = (ws["!data"]
      ? (ws["!data"] as Array<Array<{ v: unknown } | undefined>>).map((row) =>
          row ? row.map((c) => (c ? c.v : undefined)) : []
        )
      : XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })) as unknown[][];

    // Find XXCUST header
    const headerIdx = data.findIndex(
      (row) =>
        row &&
        row.some((cell) => {
          const s = String(cell || "").toLowerCase();
          return s.includes("jenis transaksi") || s.includes("order number");
        })
    );

    if (headerIdx !== -1) {
      return parseXXCUST(data, headerIdx, productOverrides);
    }

    // Find generic Oracle export header
    const exportIdx = data.findIndex(
      (row) =>
        row &&
        row.some((cell) => {
          const s = String(cell || "").toLowerCase();
          return s.includes("reference") || s.includes("transaction number");
        })
    );

    if (exportIdx !== -1) {
      return parseExportArray(data, exportIdx);
    }
  } catch {
    const fullText = new TextDecoder().decode(buffer);
    if (fullText.includes("<table") || fullText.includes("<tr")) {
      return parseHTMLTable(fullText);
    }
  }

  throw new Error("Format file tidak dikenali. Pastikan file adalah hasil export resmi dari Oracle.");
}

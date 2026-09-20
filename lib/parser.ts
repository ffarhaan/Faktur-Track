import * as XLSX from "xlsx";
import { FakturRecord } from "./types";
import masterApotek from "./masterApotek.json";
import master2P from "./master2P.json";
import masterProduct from "./masterProduct.json";
import masterPrekursorOOT from "./masterPrekursorOOT.json";

export function getPrekursorOOTClassification(itemDescription?: string): "Prekursor" | "OOT" | null {
  if (!itemDescription || itemDescription === "-" || itemDescription === "Data DOO") return null;
  const s = " " + String(itemDescription).toUpperCase().replace(/[\t\r\n\s]+/g, " ") + " ";

  // 1. OOT Matchers (Check OOT first to handle overlapping brands like Lapisiv-T, Panadol Flu & Batuk, Siladex Antitussive/DMP)
  if (/\bLAPISIV[- ]?T\b/.test(s)) return "OOT";
  if (/\bSILADEX\s+(ANTITUSSIVE|DMP)\b/.test(s)) return "OOT";
  if (/\bPANADOL\s+(FLU\s*(&|\+|DAN)\s*BATUK|BATUK\s*(&|\+|DAN)\s*FLU)\b/.test(s)) return "OOT";
  if (/\bWOODS(\s+PEPPERMINT)?\s+ANTITUSSIVE\b/.test(s)) return "OOT";
  if (/\bOB[H]?\s+COMBI\s+ANTITUSSIVE\b/.test(s)) return "OOT";
  if (/\b(GRANTUSIF|IFARSYL|PROMEDEX|LODECON\s+FORTE)\b/.test(s)) return "OOT";
  if (/\bBODREX\s+FLU\s+(DAN|&|\+)\s*BATUK\b/.test(s)) return "OOT";
  if (/\bMIXAGRIP\s+FLU\s+(DAN|&|\+)\s*BATUK\b/.test(s)) return "OOT";
  if (/\bPROCOLD\s+FLU(\s+(DAN|&|\+)\s*BATUK)?\b/.test(s)) return "OOT";
  if (/\bVICKS\s+FORMULA\s+44\b/.test(s) || /\bFORMULA\s+44\b/.test(s)) return "OOT";
  if (/\bKONIDIN\b/.test(s) && !/\bANAKONIDIN\b/.test(s)) return "OOT";

  // 2. Prekursor Matchers (Exact Brand checks with word boundaries & exclusions)
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

const apotekMap = masterApotek as Record<string, string>;

function normalize(s: string): string {
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

// Product Category lookup structures (FARMA / ALKES / PREKURSOR / OOT)
const productCodeMap: Record<string, string> = {};
const productNameMap: Record<string, string> = {};
const productList: Array<{ norm: string; cat: string }> = [];

(masterProduct as Array<{ kodeBarang: string; namaBarang: string; kategori: string }>).forEach((p) => {
  const cat = String(p.kategori || "").trim().toUpperCase();
  if (p.kodeBarang) {
    const cleanCode = String(p.kodeBarang).trim();
    productCodeMap[cleanCode] = cat;
    const numOnly = cleanCode.replace(/[^0-9]/g, "");
    if (numOnly) productCodeMap[numOnly] = cat;
  }
  if (p.namaBarang) {
    const norm = normalize(p.namaBarang);
    productNameMap[norm] = cat;
    if (norm.length >= 8) {
      productList.push({ norm, cat });
    }
  }
});

export function getProductCategory(itemCode?: string, itemDescription?: string): string | null {
  if (itemCode) {
    const cleanCode = String(itemCode).trim();
    if (productCodeMap[cleanCode]) return productCodeMap[cleanCode];
    const numOnly = cleanCode.replace(/[^0-9]/g, "");
    if (numOnly && productCodeMap[numOnly]) return productCodeMap[numOnly];
  }
  if (itemDescription) {
    const normDesc = normalize(itemDescription);
    if (productNameMap[normDesc]) return productNameMap[normDesc];
    if (normDesc.length >= 8) {
      for (const item of productList) {
        if (normDesc.includes(item.norm) || item.norm.includes(normDesc)) {
          return item.cat;
        }
      }
    }
  }
  return null;
}

/**
 * ATURAN BAKU KLASIFIKASI TRANSAKSI (LOCKED):
 * - ORA: HANYA untuk PT Helios Alchemist Kesehatan / HAK.
 * - DOO: Semua transaksi reguler DOO (termasuk Apotek Medika Prima, SBS, Pasti Hemat, Halomedika, 2P, 3P).
 */
export function isOraCustomer(customerName?: string, sourceFile?: string): boolean {
  const upperCust = String(customerName || "").toUpperCase().trim();
  const upperSrc = String(sourceFile || "").toUpperCase().trim();
  return (
    upperCust.includes("HELIOS") ||
    upperCust.startsWith("HAK") ||
    upperSrc.includes("ORA") ||
    upperCust === "1001"
  );
}

/**
 * ATURAN BAKU KATEGORI PRIORITAS (LOCKED):
 * - 1P: PT Helios (ORA) + Apotek Prioritas 1 DOO (Medika Prima, SBS, Pasti Hemat, Halomedika, Medika Akses).
 * - 2P: Apotek Prioritas 2 (dicek via Kode Customer / Ship-to Site ID & Nama Apotek di master 2P).
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

  // 1P: Helios (ORA) atau Apotek DOO 1P (Halomedika, Medika Prima, SBS, Pasti Hemat, Medika Akses)
  if (
    rawSource.includes("ORA") ||
    rawJenis === "ORA" ||
    upper.includes("HELIOS") ||
    upper.startsWith("HAK") ||
    upper === "1001" ||
    upper.includes("HALOMEDIKA") ||
    upper.includes("MEDIKA PRIMA") ||
    upper.includes("SBS") ||
    upper.includes("PASTI HEMAT") ||
    upper.includes("MEDIKA AKSES")
  ) {
    return "1P";
  }

  // 2P Lapis 1: Cek Kode Customer dari Ship-to Site
  if (shipToSite) {
    const num = String(shipToSite).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (num && master2PCodeMap.has(num)) {
      return "2P";
    }
  }

  // 2P Lapis 2: Cek Kode Customer dari Bill-to Customer Site
  if (billToSite) {
    const num = String(billToSite).replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (num && master2PCodeMap.has(num)) {
      return "2P";
    }
  }

  // 2P Lapis 3: Cek kecocokan nama apotek di daftar master 2P
  const normCust = normalize(cust);
  if (master2PNameSet.has(normCust)) {
    return "2P";
  }

  // Exact match from master apotek
  const exact = apotekMap[cust.toLowerCase()];
  if (exact === "1P" || exact === "2P" || exact === "3P") return exact as "1P" | "2P" | "3P";

  // Normalized match (ignore spaces and punctuation)
  const norm = normMap[normCust];
  if (norm === "1P" || norm === "2P" || norm === "3P") return norm as "1P" | "2P" | "3P";

  return "3P";
}

function detectDoubleInvoices(records: FakturRecord[]): void {
  const soInvMap: Record<string, Set<string>> = {};
  for (const r of records) {
    if (!soInvMap[r.orderNumber]) soInvMap[r.orderNumber] = new Set();
    soInvMap[r.orderNumber].add(r.invoiceNumber);
  }
  for (const r of records) {
    if (soInvMap[r.orderNumber].size > 1) r.isDoubleInv = true;
  }
}

function parseXXCUST(data: unknown[][], headerIdx: number): FakturRecord[] {
  const header = data[headerIdx] as string[];
  const colMap: Record<string, number> = {};
  header.forEach((h: string, i: number) => {
    if (h) {
      const key = h.trim().toLowerCase();
      if (!colMap[key]) colMap[key] = i;
    }
  });

  const idx = {
    jenisTransaksi: colMap["jenis transaksi"],
    customerName: colMap["nama pelanggan"],
    invoiceNumber: colMap["no invoice ar"],
    orderDate: colMap["order date"],
    orderNumber: colMap["order number"],
    itemCode: colMap["item code"],
    itemDescription: colMap["item description"],
    qty: colMap["qty"],
    uom: colMap["uom"],
    lotNumber: colMap["lot number"],
    totalHarga: colMap["total harga"],
  };

  const records: FakturRecord[] = [];
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const orderNumber = String(row[idx.orderNumber] ?? "").trim();
    const invoiceNumber = String(row[idx.invoiceNumber] ?? "").trim();
    if (!orderNumber && !invoiceNumber) continue;

    const customerName = String(row[idx.customerName] ?? "").trim();
    const rawJenis = String(row[idx.jenisTransaksi] ?? "").toUpperCase().trim();
    const isOra = rawJenis === "ORA" || isOraCustomer(customerName, rawJenis);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";
    const kategori = categorize(jenisTransaksi, customerName, jenisTransaksi);
    const invoiceKey = isOra ? `${invoiceNumber}-1P` : invoiceNumber;

    const itemCode = String(row[idx.itemCode] ?? "").trim();
    const itemDescription = String(row[idx.itemDescription] ?? "").trim();
    const kategoriProduk = getProductCategory(itemCode, itemDescription) || undefined;
    const klasifikasiObat = getPrekursorOOTClassification(itemDescription) || undefined;

    records.push({
      orderDate: String(row[idx.orderDate] ?? "").trim(),
      orderNumber,
      invoiceNumber,
      invoiceKey,
      jenisTransaksi,
      customerName,
      itemCode,
      itemDescription,
      qty: (row[idx.qty] as number | string) ?? 0,
      uom: String(row[idx.uom] ?? "").trim(),
      lotNumber: String(row[idx.lotNumber] ?? "").trim(),
      totalHarga: Number(row[idx.totalHarga] ?? 0),
      kategori,
      kategoriProduk,
      klasifikasiObat,
      isDoubleInv: false,
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

function parseHTMLTable(html: string): FakturRecord[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = doc.querySelectorAll("tr");

  let headerCells: string[] = [];
  let dataStartIdx = 0;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll("th, td");
    const texts = Array.from(cells).map((c) => c.textContent?.trim() || "");
    if (texts.some((t) => t.toLowerCase().includes("reference"))) {
      headerCells = texts;
      dataStartIdx = i + 1;
      break;
    }
  }

  if (!headerCells.length) throw new Error("Header tidak ditemukan di file");

  const colMap: Record<string, number> = {};
  headerCells.forEach((h, i) => {
    const s = h.toLowerCase().trim();
    if (s === "accounting date" || s === "transaction date" || (!colMap["date"] && (s.includes("accounting date") || s.includes("transaction date")))) colMap["date"] = i;
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
  for (let i = dataStartIdx; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll("th, td");
    const texts = Array.from(cells).map((c) => c.textContent?.trim() || "");

    if (texts.length < 5) continue;
    if (texts[0] === "Context Value") continue;
    // Skip rows where SO and Invoice are both empty
    const soVal = texts[colMap["so"]] || "";
    const invVal = texts[colMap["inv"]] || "";
    if (!soVal && !invVal) continue;

    // Ship-to Customer sebagai nama pelanggan, fallback ke Bill-to Customer
    const customerName = (colMap["customer"] !== undefined && texts[colMap["customer"]])
      ? texts[colMap["customer"]]
      : (colMap["billTo"] !== undefined && texts[colMap["billTo"]])
      ? texts[colMap["billTo"]]
      : "";
    const rawSource = texts[colMap["source"]] || "";
    const isOra = isOraCustomer(customerName, rawSource);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";

    const shipSite = colMap["shipSite"] !== undefined ? texts[colMap["shipSite"]] : "";
    const billSite = colMap["billSite"] !== undefined ? texts[colMap["billSite"]] : "";

    const kategori = isOra ? "1P" : categorize(jenisTransaksi, customerName, jenisTransaksi, shipSite, billSite);
    const invoiceKey = isOra ? `${invVal}-1P` : invVal;

    records.push({
      orderDate: texts[colMap["date"]] || "",
      orderNumber: soVal,
      invoiceNumber: invVal,
      invoiceKey,
      jenisTransaksi,
      customerName,
      itemCode: "-",
      itemDescription: "-",
      qty: "-",
      uom: "-",
      lotNumber: "-",
      totalHarga: Number(texts[colMap["amount"]]?.replace(/[^0-9.-]/g, "") || 0),
      kategori,
      isDoubleInv: false,
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

function formatExcelDate(v: unknown): string {
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    }
  }
  return String(v || "").trim();
}

function parseExportArray(data: unknown[][], headerIdx: number = -1): FakturRecord[] {
  let colMap: Record<string, number> = {};
  let startIdx = 0;

  if (headerIdx !== -1) {
    const header = data[headerIdx] as string[];
    header.forEach((h, i) => {
      const s = String(h || "").toLowerCase().trim();
      if (s === "accounting date" || s === "transaction date" || (!colMap["date"] && (s.includes("accounting date") || s.includes("transaction date")))) colMap["date"] = i;
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
    startIdx = headerIdx + 1;
  } else {
    colMap = {
      date: 0,
      so: 1,
      inv: 2,
      customer: 3,
      source: 4,
      jenis: 6,
      amount: 11,
    };
    startIdx = 0;
  }

  const records: FakturRecord[] = [];
  for (let i = startIdx; i < data.length; i++) {
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

    const rawSource = String((colMap["source"] !== undefined ? row[colMap["source"]] : row[4]) || "").trim();
    const isOra = isOraCustomer(customerName, rawSource);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";

    const shipSite = String((colMap["shipSite"] !== undefined ? row[colMap["shipSite"]] : "") || "");
    const billSite = String((colMap["billSite"] !== undefined ? row[colMap["billSite"]] : "") || "");

    const kategori = isOra ? "1P" : categorize(jenisTransaksi, customerName, jenisTransaksi, shipSite, billSite);
    const invoiceKey = isOra ? `${invVal}-1P` : invVal;

    const rawAmount = row[colMap["amount"] ?? 11];
    const totalHarga = typeof rawAmount === "number" ? rawAmount : Number(String(rawAmount || "").replace(/[^0-9.-]/g, "") || 0);

    records.push({
      orderDate: formatExcelDate(row[colMap["date"] ?? 0]),
      orderNumber: soVal,
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
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

export async function parseExcelFile(file: File): Promise<FakturRecord[]> {
  const buffer = await file.arrayBuffer();

  // 1. Try HTML format FIRST for .xls files (Oracle exports are HTML tables)
  // Check the first 4KB for HTML/XML markers
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

  // 2. Otherwise parse binary Excel files (.xlsx)
  try {
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];

    // Find header row with "Jenis Transaksi" or "Order Number" (XXCUST format)
    const headerIdx = data.findIndex(
      (row) =>
        row &&
        row.some((cell) => {
          const s = String(cell || "").toLowerCase();
          return s.includes("jenis transaksi") || s.includes("order number");
        })
    );

    if (headerIdx !== -1) {
      return parseXXCUST(data, headerIdx);
    }

    // Check for export format headers with "reference" or "transaction number"
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

    // If data has at least 5 columns and looks like Oracle export (col 1 is SO code, col 4 is DOO/ORA)
    if (data.length > 0 && data[0] && data[0].length >= 5) {
      const sample = data[0];
      const s1 = String(sample[1] || "");
      const s4 = String(sample[4] || "");
      if (s4.includes("Distributed Order") || s4.includes("ORA_") || s1.includes("-") || /^\d{4,}/.test(s1)) {
        return parseExportArray(data, -1);
      }
    }
  } catch {
    // If XLSX read fails, try HTML as fallback
    const fullText = new TextDecoder().decode(buffer);
    if (fullText.includes("<table") || fullText.includes("<tr")) {
      return parseHTMLTable(fullText);
    }
  }

  throw new Error(
    "Format file tidak dikenali. Pastikan file adalah export dari Oracle."
  );
}

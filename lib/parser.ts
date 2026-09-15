import * as XLSX from "xlsx";
import { FakturRecord } from "./types";
import masterApotek from "./masterApotek.json";

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
    (upperSrc === "ORA" && (upperCust.includes("HELIOS") || upperCust.startsWith("HAK") || !upperCust))
  );
}

/**
 * ATURAN BAKU KATEGORI PRIORITAS (LOCKED):
 * - 1P: PT Helios (ORA) + Apotek Prioritas 1 DOO (Medika Prima, SBS, Pasti Hemat, Halomedika, Medika Akses) + Master Apotek 1P.
 * - 2P: Apotek Prioritas 2 (dari masterApotek.json).
 * - 3P: Apotek Reguler lainnya.
 */
export function categorize(jenisTransaksi: string, customerName: string, sourceFile?: string): "1P" | "2P" | "3P" {
  const cust = String(customerName || "").trim();
  const upper = cust.toUpperCase();
  const rawJenis = String(jenisTransaksi || "").toUpperCase();
  const rawSource = String(sourceFile || "").toUpperCase();

  // 1P: Helios (ORA) atau Apotek DOO 1P (Halomedika, Medika Prima, SBS, Pasti Hemat, Medika Akses)
  if (
    rawSource === "ORA" ||
    rawJenis === "ORA" ||
    upper.includes("HELIOS") ||
    upper.startsWith("HAK") ||
    upper.includes("HALOMEDIKA") ||
    upper.includes("MEDIKA PRIMA") ||
    upper.includes("SBS") ||
    upper.includes("PASTI HEMAT") ||
    upper.includes("MEDIKA AKSES")
  ) {
    return "1P";
  }

  // Exact match from master apotek
  const exact = apotekMap[cust.toLowerCase()];
  if (exact === "1P" || exact === "2P" || exact === "3P") return exact;

  // Normalized match (ignore spaces and punctuation)
  const norm = normMap[normalize(cust)];
  if (norm === "1P" || norm === "2P" || norm === "3P") return norm;

  // Substring matching for 2P and 1P
  const normCust = normalize(cust);
  for (const [name, cat] of Object.entries(apotekMap)) {
    if (cat === "2P" || cat === "1P") {
      const normName = normalize(name);
      if (normCust.includes(normName) || (normName.length > 5 && normName.includes(normCust))) {
        return cat as "1P" | "2P";
      }
    }
  }

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
    const isOra = isOraCustomer(customerName);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";
    const kategori = categorize(jenisTransaksi, customerName, jenisTransaksi);
    const invoiceKey = isOra ? `${invoiceNumber}-1P` : invoiceNumber;

    records.push({
      orderDate: String(row[idx.orderDate] ?? "").trim(),
      orderNumber,
      invoiceNumber,
      invoiceKey,
      jenisTransaksi,
      customerName,
      itemCode: String(row[idx.itemCode] ?? "").trim(),
      itemDescription: String(row[idx.itemDescription] ?? "").trim(),
      qty: (row[idx.qty] as number | string) ?? 0,
      uom: String(row[idx.uom] ?? "").trim(),
      lotNumber: String(row[idx.lotNumber] ?? "").trim(),
      totalHarga: Number(row[idx.totalHarga] ?? 0),
      kategori,
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
    const s = h.toLowerCase();
    if (s.includes("accounting date") || s.includes("transaction date"))
      colMap["date"] = i;
    if (s === "reference") colMap["so"] = i;
    if (s.includes("transaction number")) colMap["inv"] = i;
    // Ship-to Customer = nama pelanggan (utama), Bill-to Customer = fallback
    if (s.includes("ship-to customer")) colMap["customer"] = i;
    if (s.includes("bill-to customer")) colMap["billTo"] = i;
    if (s.includes("transaction source")) colMap["source"] = i;
    if (s.includes("transaction type")) colMap["jenis"] = i;
    if (s.includes("entered amount")) colMap["amount"] = i;
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
    const customerName = texts[colMap["customer"]] || texts[colMap["billTo"]] || "";
    const rawSource = texts[colMap["source"]] || "";
    const isOra = isOraCustomer(customerName, rawSource);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";

    const kategori = isOra ? "1P" : categorize(jenisTransaksi, customerName, jenisTransaksi);
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
      const s = String(h || "").toLowerCase();
      if (s.includes("accounting date") || s.includes("transaction date")) colMap["date"] = i;
      if (s === "reference" || s.includes("reference")) colMap["so"] = i;
      if (s.includes("transaction number")) colMap["inv"] = i;
      if (s.includes("ship-to customer") || s.includes("customer")) colMap["customer"] = i;
      if (s.includes("bill-to customer")) colMap["billTo"] = i;
      if (s.includes("transaction source")) colMap["source"] = i;
      if (s.includes("transaction type")) colMap["jenis"] = i;
      if (s.includes("entered amount") || s.includes("amount")) colMap["amount"] = i;
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
      (colMap["customer"] !== undefined ? row[colMap["customer"]] : "") ||
      (colMap["billTo"] !== undefined ? row[colMap["billTo"]] : "") ||
      row[3] || ""
    ).trim();

    const rawSource = String((colMap["source"] !== undefined ? row[colMap["source"]] : row[4]) || "").trim();
    const isOra = isOraCustomer(customerName, rawSource);
    const jenisTransaksi: "ORA" | "DOO" = isOra ? "ORA" : "DOO";

    const kategori = isOra ? "1P" : categorize(jenisTransaksi, customerName, jenisTransaksi);
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

import * as XLSX from "xlsx";
import { FakturRecord } from "./types";
import masterApotek from "./masterApotek.json";

const apotekMap = masterApotek as Record<string, string>;

function categorize(jenisTransaksi: string, customerName: string): "1P" | "2P" | "3P" {
  // PT Helios Alchemist Kesehatan = TRADE_PRIORITY = 1P (HAK)
  if (jenisTransaksi === "TRADE_PRIORITY") return "1P";

  // Check master apotek list
  const cat = apotekMap[customerName.toLowerCase().trim()];
  if (cat === "1P" || cat === "2P" || cat === "3P") return cat;

  // Fallback: check by name pattern
  const upper = customerName.toUpperCase();
  if (
    upper.includes("HALOMEDIKA") ||
    upper.includes("HELIOS") ||
    upper.includes("SBS") ||
    upper.includes("MEDIKA PRIMA") ||
    upper.includes("PASTI HEMAT") ||
    upper.includes("MEDIKA AKSES")
  ) {
    return "1P";
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

    const jenisTransaksi = String(row[idx.jenisTransaksi] ?? "").trim();
    const customerName = String(row[idx.customerName] ?? "").trim();

    records.push({
      orderDate: String(row[idx.orderDate] ?? "").trim(),
      orderNumber,
      invoiceNumber,
      jenisTransaksi,
      customerName,
      itemCode: String(row[idx.itemCode] ?? "").trim(),
      itemDescription: String(row[idx.itemDescription] ?? "").trim(),
      qty: (row[idx.qty] as number | string) ?? 0,
      uom: String(row[idx.uom] ?? "").trim(),
      lotNumber: String(row[idx.lotNumber] ?? "").trim(),
      totalHarga: Number(row[idx.totalHarga] ?? 0),
      kategori: categorize(jenisTransaksi, customerName),
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
    const jenisTransaksi = texts[colMap["jenis"]] || "";

    records.push({
      orderDate: texts[colMap["date"]] || "",
      orderNumber: soVal,
      invoiceNumber: invVal,
      jenisTransaksi,
      customerName,
      itemCode: "-",
      itemDescription: "-",
      qty: "-",
      uom: "-",
      lotNumber: "-",
      totalHarga: Number(texts[colMap["amount"]]?.replace(/[^0-9.-]/g, "") || 0),
      kategori: categorize(jenisTransaksi, customerName),
      isDoubleInv: false,
      rowIndex: i,
    });
  }

  detectDoubleInvoices(records);
  return records;
}

export async function parseExcelFile(file: File): Promise<FakturRecord[]> {
  const buffer = await file.arrayBuffer();

  // Try xlsx format first
  try {
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];

    // Find header row with "Jenis Transaksi" or "Order Number"
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

    // Check for export format headers
    const exportIdx = data.findIndex(
      (row) =>
        row &&
        row.some((cell) => {
          const s = String(cell || "").toLowerCase();
          return s.includes("reference");
        })
    );

    if (exportIdx !== -1) {
      // xlsx might not parse HTML well, fall through to HTML
    }
  } catch {
    // Not xlsx, try HTML
  }

  // Try HTML format for .xls files
  const text = new TextDecoder().decode(buffer);
  if (text.includes("<table") || text.includes("<tr")) {
    return parseHTMLTable(text);
  }

  throw new Error(
    "Format file tidak dikenali. Pastikan file adalah export dari Oracle."
  );
}

import { FakturRecord } from "./types";
import rawMasterData from "./masterApotekData.json";

export interface MasterApotekInfo {
  name: string;
  kat: string;
  wil: string;
}

const masterDict = rawMasterData as Record<string, MasterApotekInfo>;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function getOrderType(r: FakturRecord): "DOO" | "ORA" | "OTHER" {
  if (r.extra?.order_type) {
    const ot = String(r.extra.order_type).toUpperCase();
    if (ot.includes("3RD") || ot.includes("DOO")) return "DOO";
    if (ot.includes("PRIORITY") || ot.includes("ORA")) return "ORA";
  }
  if (!r.no_sales_order) return "OTHER";
  // Alphanumeric SO (e.g. ZLGMXL-5393, KY74DY-8596) -> DOO (TRADE_3RD PARTY)
  if (/[A-Za-z]/.test(r.no_sales_order)) {
    return "DOO";
  }
  // Numeric SO (e.g. 9066, 9512, 9328) -> ORA (TRADE_PRIORITY)
  if (/^\s*\d+[\d\s,]*$/.test(r.no_sales_order)) {
    return "ORA";
  }
  return "OTHER";
}

export type KategoriTier = "1P" | "2P" | "3P" | "OTHER";

export function getKategori(r: FakturRecord): KategoriTier {
  const custName = r.extra?.nama_pelanggan;
  const oType = getOrderType(r);

  if (custName) {
    const norm = normalizeName(String(custName));
    
    // 1. Direct match di Master Rekapan Pengiriman
    if (masterDict[norm]) {
      const kat = masterDict[norm].kat;
      if (kat === "1P" || kat === "2P" || kat === "3P") return kat;
    }

    // 2. Cek keyword spesifik 1P
    if (
      norm.includes("halomedika") ||
      norm.includes("heliosmedika") ||
      norm.includes("medikaprima") ||
      norm.includes("pastihemat") ||
      norm.includes("sbsfarma") ||
      norm.includes("sbscibinong") ||
      norm.includes("medikaaksesinvestama") ||
      norm.includes("astradaihatsu") ||
      norm.includes("hasanahfarma")
    ) {
      return "1P";
    }

    // 3. Fuzzy search di Master Dictionary jika nama sedikit berbeda
    for (const key in masterDict) {
      if (key.length > 5 && (norm.includes(key) || key.includes(norm))) {
        const kat = masterDict[key].kat;
        if (kat === "1P" || kat === "2P" || kat === "3P") return kat;
      }
    }
  }

  // 4. Fallback jika apotek belum terdaftar di master
  if (oType === "DOO") return "3P";
  if (oType === "ORA") return "2P";

  return "OTHER";
}

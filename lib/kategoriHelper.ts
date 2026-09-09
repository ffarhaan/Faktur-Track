import { FakturRecord } from "./types";

export const LIST_1P_APOTEK = [
  "Apotek SBS Farma Tembalang",
  "Apotek Halomedika Dukuh Pakis",
  "Apotek Halomedika (Kelapa Gading)",
  "Apotek Halomedika (Kp Rambutan)",
  "Apotek Halomedika (Kranggan)",
  "Apotek Halomedika (Medan Satria)",
  "Apotek Halomedika (Pancoran)",
  "Apotek Halomedika (Pekayon)",
  "Apotek Halomedika (Tebet dan HO)",
  "Apotek Helios Medika Saharjo",
  "Apotek Helios Medika Sukmajaya",
  "Apotek Medika Prima (Cipinang)",
  "Apotek Medika Prima (Jagakarsa)",
  "Apotek SBS Farma Pandu Raya",
  "Apotek Medika Prima (Pondok Kelapa)",
  "Apotek SBS Cibinong",
  "PT Medika Akses Investama",
  "Klinik Utama Halomedika Pancoran",
  "Apotek Pasti Hemat Tebet",
  "Klinik Pratama PT. Astra Daihatsu Motor",
  "Apotek Halomedika (Tebet)",
  "Apotek Halomedika (Cempaka Putih)",
  "Apotek Halomedika Perjuangan Bekasi",
  "Apotek Pasti Hemat Pondok Cabe",
  "Apotek Halomedika (Bungur Malang)",
  "Apotek Halomedika (Cicendo)",
  "Apotek Halomedika (Denpasar)",
  "Apotek Halomedika (Dukuh Pakis Surabaya)",
  "Apotek Halomedika (Gejayan Yogyakarta)",
  "Apotek Halomedika (Kemuning Palembang)",
  "Apotek Halomedika (Medan Baru)",
  "Apotek Halomedika (Rancasari Bandung)",
  "Apotek Halomedika (Tirta Raya)",
  "Apotek Hasanah Farma Bandung",
  "Apotek SBS Farma Sukolilo",
  "Apotek SBS Farma Mekarwangi",
  "Apotek Medika Prima Serengan Surakarta",
  "Apotek SBS Farma Gading Serpong",
  "Apotek SBS Farma Kebon Jeruk",
  "Apotek Medika Prima (Duri Kosambi)",
  "Apotek Medika Prima (Tambora)",
  "Apotek Medika Prima (ICE BSD)",
  "Apotek Halomedika (Pondok Aren)",
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

const NORMALIZED_1P_SET = new Set(LIST_1P_APOTEK.map(normalizeName));

export function is1PApotek(custName?: string | null): boolean {
  if (!custName) return false;
  const raw = String(custName).trim();
  const normalized = normalizeName(raw);

  if (NORMALIZED_1P_SET.has(normalized)) return true;

  // Fuzzy check: check if any 1P name is a substring or vice versa
  for (const item of LIST_1P_APOTEK) {
    const nItem = normalizeName(item);
    if (normalized.includes(nItem) || nItem.includes(normalized)) {
      return true;
    }
  }

  // Keywords that belong uniquely to 1P group
  const lower = raw.toLowerCase();
  if (
    lower.includes("halomedika") ||
    lower.includes("helios medika") ||
    lower.includes("medika prima") ||
    lower.includes("pasti hemat") ||
    lower.includes("sbs farma") ||
    lower.includes("sbs cibinong") ||
    lower.includes("medika akses investama") ||
    lower.includes("astra daihatsu") ||
    lower.includes("hasanah farma")
  ) {
    return true;
  }

  return false;
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
  // 1. Cek apakah masuk daftar 1P
  if (is1PApotek(r.extra?.nama_pelanggan)) {
    return "1P";
  }

  // 2. Jika bukan 1P, tentukan dari DOO vs ORA
  const oType = getOrderType(r);
  if (oType === "DOO") {
    return "3P"; // 3rd Party (DOO)
  }
  if (oType === "ORA") {
    return "2P"; // 2nd Party (ORA Priority)
  }

  return "OTHER";
}

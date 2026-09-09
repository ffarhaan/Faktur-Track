export type FakturRecord = {
  id: string;
  no_faktur: string;
  no_delivery_order: string | null;
  no_sales_order: string | null;
  status_cetak: boolean;
  printed_at: string | null;
  extra: Record<string, string | number | null>;
  created_at: string;
  updated_at: string;
  imported_at: string; // kapan terakhir kali diimport dari Excel
};

// Field wajib yang harus dipetakan dari kolom Excel
export const REQUIRED_FIELDS = [
  { key: "no_faktur", label: "No Faktur" },
  { key: "no_delivery_order", label: "No Delivery Order" },
  { key: "no_sales_order", label: "No Sales Order" },
] as const;

export type RequiredFieldKey = (typeof REQUIRED_FIELDS)[number]["key"];

export type ColumnMapping = Record<RequiredFieldKey, string>; // field -> nama kolom Excel

export type ParsedExcelRow = Record<string, string | number | null>;

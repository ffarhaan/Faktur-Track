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

// Field yang dipetakan dari kolom Excel
export const REQUIRED_FIELDS = [
  { key: "no_faktur", label: "No Invoice AR / No Faktur" },
  { key: "no_sales_order", label: "Order Number / No SO" },
] as const;

export type RequiredFieldKey = (typeof REQUIRED_FIELDS)[number]["key"];

export type ColumnMapping = Record<string, string>; // field -> nama kolom Excel

export type ParsedExcelRow = Record<string, string | number | null>;

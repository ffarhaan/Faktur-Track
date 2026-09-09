export type ItemDetail = {
  item_code?: string | number | null;
  item_description?: string | number | null;
  qty?: string | number | null;
  uom?: string | number | null;
  lot_number?: string | number | null;
  harga_jual?: string | number | null;
  total_harga?: string | number | null;
  nama_pelanggan?: string | number | null;
  order_number?: string | number | null;
};

export type FakturRecord = {
  id: string;
  no_faktur: string;
  no_delivery_order: string | null;
  no_sales_order: string | null;
  status_cetak: boolean;
  printed_at: string | null;
  extra: {
    items?: ItemDetail[];
    nama_pelanggan?: string | null;
    [key: string]: unknown;
  };
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

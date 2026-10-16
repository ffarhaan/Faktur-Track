export interface FakturRecord {
  orderDate: string;
  transactionDate?: string;
  orderNumber: string;
  invoiceNumber: string;
  invoiceKey: string;
  jenisTransaksi: "ORA" | "DOO";
  customerName: string;
  itemCode: string;
  itemDescription: string;
  qty: number | string;
  uom: string;
  lotNumber: string;
  totalHarga: number;
  kategori: "1P" | "2P" | "3P";
  kategoriProduk?: string;
  klasifikasiObat?: "Prekursor" | "OOT";
  isDoubleInv: boolean;
  isRetur?: boolean;
  status_cetak?: boolean;
  printed_at?: string | null;
  printed_by?: string | null;
  sourceFile?: string;
  rowIndex?: number;
}

export interface FirestoreFakturDoc {
  id: string;
  no_faktur: string;
  no_sales_order: string;
  customer_name: string;
  order_date: string;
  transaction_date?: string;
  jenis_transaksi: string;
  kategori: string;
  status_cetak?: boolean;
  printed_at?: string | null;
  printed_by?: string | null;
  extra: {
    nama_pelanggan?: string;
    order_date?: string;
    transaction_date?: string;
    accounting_date?: string;
    jenis_transaksi?: string;
    kategori?: string;
    total_harga?: number;
    items?: Array<{
      item_code: string;
      item_description: string;
      kategori_produk: string;
      qty: number | string;
      uom: string;
      lot_number: string;
      total_harga: number;
      order_number?: string;
      klasifikasi_obat?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  updated_at?: string;
  imported_at?: string;
  source_file?: string;
}

export interface PrintState {
  printedKeys: string[];
  printedAtMap: Record<string, string>;
  printedByMap?: Record<string, string>;
  updatedAt: string;
}

export interface InvoiceProgression {
  prev1P?: string | null;
  new1P?: string | null;
  range1P?: string | null;
  prev1PDoo?: string | null;
  new1PDoo?: string | null;
  range1PDoo?: string | null;
  prev2P?: string | null;
  new2P?: string | null;
  range2P?: string | null;
  prev3P?: string | null;
  new3P?: string | null;
  range3P?: string | null;
  prevDoo?: string | null;
  newDoo?: string | null;
  rangeDoo?: string | null;
  prevOra?: string | null;
  newOra?: string | null;
  rangeOra?: string | null;
  updatedAt?: string;
}

export interface FakturGroup {
  key: string;
  invoiceNumber: string;
  invoiceKey: string;
  so: string;
  items: FakturRecord[];
  orderDate: string;
  transactionDate?: string;
  jenisTransaksi: "ORA" | "DOO";
  customerName: string;
  kategori: "1P" | "2P" | "3P";
  kategoriProduk: string;
  hasPrekursor: boolean;
  hasOOT: boolean;
  hasCCP: boolean;
  hasAlkes: boolean;
  hasFarma: boolean;
  isDoubleInv: boolean;
  isRetur?: boolean;
  totalHarga: number;
  totalItems: number;
  allPrinted: boolean;
  printedAt: string | null;
  printedBy?: string | null;
  searchStr?: string;
  invNum?: number;
  printTimeMs?: number;
}

export interface UploadNotification {
  fileName: string;
  prevOra?: string | null;
  maxOra?: string;
  rangeOra?: string | null;
  prevDoo?: string | null;
  maxDoo?: string;
  rangeDoo?: string | null;
  totalItems: number;
  totalInvoices: number;
  newUnprinted: number;
  time: string;
  uploaderId?: string;
}

export interface ActiveUserPresence {
  name: string;
  role: "admin" | "readonly";
  lastActive: number;
  deviceId: string;
}

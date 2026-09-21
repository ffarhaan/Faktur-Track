export type FakturRecord = {
  orderDate: string;
  orderNumber: string;
  invoiceNumber: string;
  invoiceKey: string;
  jenisTransaksi: string;
  customerName: string;
  itemCode: string;
  itemDescription: string;
  qty: number | string;
  uom: string;
  lotNumber: string;
  totalHarga: number;
  kategori: "1P" | "2P" | "3P";
  kategoriProduk?: string;
  klasifikasiObat?: "Prekursor" | "OOT" | null;
  isDoubleInv: boolean;
  rowIndex: number;
};

export type InvoiceProgression = {
  prev1P?: string | null;
  new1P?: string | null;
  range1P?: string | null;
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
};

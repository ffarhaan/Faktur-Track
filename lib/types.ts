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

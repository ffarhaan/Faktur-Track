export type FakturRecord = {
  orderDate: string;
  orderNumber: string;
  invoiceNumber: string;
  jenisTransaksi: string;
  customerName: string;
  itemCode: string;
  itemDescription: string;
  qty: number | string;
  uom: string;
  lotNumber: string;
  totalHarga: number;
  kategori: "1P" | "2P" | "3P";
  isDoubleInv: boolean;
  rowIndex: number;
};

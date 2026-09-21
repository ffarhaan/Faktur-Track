"use client";

import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react";
import * as XLSX from "xlsx";
import { parseExcelFile, categorize, isOraCustomer, getProductCategory, getPrekursorOOTClassification } from "@/lib/parser";
import { FakturRecord } from "@/lib/types";
import {
  subscribeToFakturs,
  getExistingFakturs,
  saveFaktursBatch,
  updateFakturPrintStatus,
  updateFaktursPrintStatusBatch,
  updatePrintState,
  clearAllFakturs,
  FirestoreFakturDoc,
} from "@/lib/firestoreService";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import masterApotekList from "@/lib/masterApotekList.json";
import masterProductList from "@/lib/masterProduct.json";

type Filter = "all" | "belum" | "sudah" | "double";
type KatFilter = "all" | "1P" | "2P" | "3P";
type JenisFilter = "all" | "ORA" | "DOO";
type KlasFilter = "all" | "prekursor" | "oot" | "ccp" | "alkes" | "farma";

const ROWS_PER_PAGE = 50;

function parseInvNum(invs: string[] | string): number {
  if (!invs) return 0;
  if (Array.isArray(invs)) {
    if (invs.length === 0) return 0;
    const n = parseInt(invs[0].replace(/\D/g, ""), 10);
    return isNaN(n) ? 0 : n;
  }
  const n = parseInt(String(invs).replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseDateMs(dStr: string): number {
  if (!dStr) return 0;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dStr)) {
    const [d, m, y] = dStr.split("/").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = Date.parse(dStr);
  return isNaN(t) ? 0 : t;
}

function formatRupiah(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "0";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatPrintTime(dStr?: string | null): string {
  if (!dStr) return "-";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return dStr;
  }
}

type FakturGroup = {
  key: string;
  invoiceNumber: string;
  invoiceKey: string;
  so: string;
  items: FakturRecord[];
  orderDate: string;
  jenisTransaksi: string;
  customerName: string;
  kategori: "1P" | "2P" | "3P";
  kategoriProduk: string;
  kategoriProdukCounts?: Record<string, number>;
  hasPrekursor: boolean;
  hasOOT: boolean;
  hasCCP: boolean;
  hasAlkes: boolean;
  hasFarma: boolean;
  isDoubleInv: boolean;
  totalHarga: number;
  totalItems: number;
  allPrinted: boolean;
  anyPrinted: boolean;
  printedAt: string | null;
};

type UploadedFile = {
  name: string;
  count: number;
  time: string;
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

function dbRowsToFakturRecords(rows: Array<Record<string, unknown>>): {
  records: FakturRecord[];
  printedSet: Set<string>;
  printedAtMap: Record<string, string>;
  progression: InvoiceProgression | null;
} {
  const records: FakturRecord[] = [];
  const printedSet = new Set<string>();
  const printedAtMap: Record<string, string> = {};
  let progression: InvoiceProgression | null = null;

  for (const r of rows) {
    const rawInv = String(r.no_faktur || "");
    if (rawInv === "__SYSTEM_METADATA__") {
      const extra = (r.extra as Record<string, unknown>) || {};
      if (extra.invoiceProgression) {
        progression = extra.invoiceProgression as InvoiceProgression;
      }
      continue;
    }

    const cleanInv = rawInv.replace(/-1P$/i, "");
    const extra = (r.extra as Record<string, unknown>) || {};
    const items = (extra.items as Array<Record<string, unknown>>) || [];
    const cust = String(extra.nama_pelanggan || "");
    const date = String(extra.accounting_date || extra.order_date || r.imported_at || "");
    const isOra = isOraCustomer(cust, (extra.jenis_transaksi as string) || (r.source_file as string));
    const invKey = rawInv || (isOra ? `${cleanInv}-1P` : cleanInv);
    const cleanJenis: "DOO" | "ORA" = isOra ? "ORA" : "DOO";
    const kategori = categorize(cleanJenis, cust, (extra.jenis_transaksi as string) || (r.source_file as string));
    const pAt = (r.printed_at as string) || (extra.printed_at as string) || null;

    if (r.status_cetak) {
      if (invKey) {
        printedSet.add(invKey);
        if (pAt) printedAtMap[invKey] = pAt;
      }
    }

    if (items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemCode = String(it.item_code || "");
        const itemDesc = String(it.item_description || "");
        const katProd = getProductCategory(itemCode, itemDesc);
        const klasObat = getPrekursorOOTClassification(itemDesc, itemCode) || (katProd === "PREKURSOR" ? "Prekursor" : katProd === "OOT" ? "OOT" : undefined);

        const itemSO = String(it.order_number || "").trim();
        const docSO = String(r.no_sales_order || "").trim();
        const validSO = itemSO && itemSO !== "-" ? itemSO : (docSO && docSO !== "-" ? docSO : "-");

        records.push({
          orderDate: date,
          orderNumber: validSO,
          invoiceNumber: cleanInv,
          invoiceKey: invKey,
          jenisTransaksi: cleanJenis,
          customerName: cust,
          itemCode,
          itemDescription: itemDesc,
          qty: (it.qty as number | string) || 0,
          uom: String(it.uom || ""),
          lotNumber: String(it.lot_number || ""),
          totalHarga: typeof it.total_harga === "number" ? it.total_harga : parseFloat(String(it.total_harga || 0)) || 0,
          kategori,
          kategoriProduk: katProd,
          klasifikasiObat: klasObat,
          isDoubleInv: false,
          rowIndex: idx,
        });
      }
    } else {
      const docSO = String(r.no_sales_order || "").trim();
      const validSO = docSO && docSO !== "-" ? docSO : "-";
      records.push({
        orderDate: date,
        orderNumber: validSO,
        invoiceNumber: cleanInv,
        invoiceKey: invKey,
        jenisTransaksi: cleanJenis,
        customerName: cust,
        itemCode: "-",
        itemDescription: "Data DOO",
        qty: 1,
        uom: "-",
        lotNumber: "-",
        totalHarga: 0,
        kategori,
        isDoubleInv: false,
        rowIndex: 0,
      });
    }
  }

  // Detect double invoices
  const soInvMap: Record<string, Set<string>> = {};
  for (const rec of records) {
    if (!soInvMap[rec.orderNumber]) soInvMap[rec.orderNumber] = new Set();
    if (rec.invoiceNumber) soInvMap[rec.orderNumber].add(rec.invoiceNumber);
  }
  for (const rec of records) {
    if (soInvMap[rec.orderNumber]?.size > 1) rec.isDoubleInv = true;
  }

  return { records, printedSet, printedAtMap, progression };
}

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [filter, setFilter] = useState<Filter>("belum");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [jenisFilter, setJenisFilter] = useState<JenisFilter>("all");
  const [klasFilter, setKlasFilter] = useState<KlasFilter>("all");
  const [sortBy, setSortBy] = useState<"invoice" | "date" | "totalHarga">("invoice");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [uploadNotification, setUploadNotification] = useState<{
    fileName: string;
    prevOra: string | null;
    maxOra: string;
    rangeOra: string | null;
    prevDoo: string | null;
    maxDoo: string;
    rangeDoo: string | null;
    totalItems: number;
    totalInvoices: number;
    newUnprinted: number;
    time: string;
  } | null>(null);

  const [invoiceProgression, setInvoiceProgression] = useState<InvoiceProgression | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("invoiceProgression");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return null;
  });

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [sessionPrintedKeys, setSessionPrintedKeys] = useState<Set<string>>(new Set());
  const [printedAtMap, setPrintedAtMap] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [selectedColIdx, setSelectedColIdx] = useState(3); // Default: No Invoice
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showApotekModal, setShowApotekModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const inFlightToggleRef = useRef<Set<string>>(new Set());

  // Realtime subscription to Firebase Firestore
  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToFakturs(
      (docs, prog) => {
        if (prog) {
          setInvoiceProgression(prog);
          try {
            localStorage.setItem("invoiceProgression", JSON.stringify(prog));
          } catch {}
        }

        if (docs.length > 0) {
          const { records: recs, printedSet, printedAtMap: pMap } = dbRowsToFakturRecords(
            docs as unknown as Array<Record<string, unknown>>
          );
          setRecords(recs);
          setPrintedInvoices(printedSet);
          setPrintedAtMap(pMap);
        } else {
          setRecords([]);
          setPrintedInvoices(new Set());
          setPrintedAtMap({});
        }
        setLoading(false);
      },
      (err) => {
        console.error("Firestore sync error:", err);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Auto-refresh on new deploy version
  useEffect(() => {
    let currentVersion: string | null = null;
    const checkVersion = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const data = await res.json();
        if (currentVersion === null) {
          currentVersion = data.version;
        } else if (currentVersion !== data.version) {
          window.location.reload();
        }
      } catch {}
    };
    checkVersion();
    const interval = setInterval(checkVersion, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleManualRefresh = useCallback(() => {
    setSessionPrintedKeys(new Set());
    setLoading(true);
    getExistingFakturs()
      .then(({ docs, progression: prog }) => {
        if (prog) {
          setInvoiceProgression(prog);
          try {
            localStorage.setItem("invoiceProgression", JSON.stringify(prog));
          } catch {}
        }
        const { records: recs, printedSet, printedAtMap: pMap } = dbRowsToFakturRecords(
          docs as unknown as Array<Record<string, unknown>>
        );
        setRecords(recs);
        setPrintedInvoices(printedSet);
        setPrintedAtMap(pMap);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Manual refresh error:", err);
        setLoading(false);
      });
  }, []);

  // Print / Unprint: toggle local state AND sync to Firestore in realtime (1 write, < 50ms)
  const togglePrint = useCallback(
    async (group: FakturGroup) => {
      const willBePrinted = !group.allPrinted;
      const targetKey = group.invoiceKey;

      // Debounce rapid toggles on the same invoice (< 300ms)
      if (inFlightToggleRef.current.has(targetKey)) return;
      inFlightToggleRef.current.add(targetKey);
      setTimeout(() => {
        inFlightToggleRef.current.delete(targetKey);
      }, 300);

      const nowIso = new Date().toISOString();
      const next = new Set(printedInvoices);

      if (willBePrinted) {
        next.add(targetKey);
      } else {
        next.delete(targetKey);
      }
      setPrintedInvoices(next);

      // Optimistic session state
      setSessionPrintedKeys((prev) => {
        const sNext = new Set(prev);
        if (willBePrinted) {
          sNext.add(targetKey);
        } else {
          sNext.delete(targetKey);
        }
        return sNext;
      });

      const nextMap = { ...printedAtMap };
      if (willBePrinted) {
        nextMap[targetKey] = nowIso;
      } else {
        delete nextMap[targetKey];
      }
      setPrintedAtMap(nextMap);
      try {
        localStorage.setItem("printedAtMap", JSON.stringify(nextMap));
        localStorage.setItem("printedInvoices", JSON.stringify([...next]));
      } catch {}

      try {
        await updateFakturPrintStatus(
          targetKey,
          willBePrinted,
          willBePrinted ? nowIso : null,
          next,
          nextMap
        );
      } catch (err) {
        console.error("Failed to update print status in Firestore:", err);
      }
    },
    [printedInvoices, printedAtMap]
  );

  // Upload: Parse & Save directly to Supabase cloud DB so all devices see it
  const handleUpload = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const parsed = await parseExcelFile(file);
        if (parsed.length === 0) {
          setError("File berhasil dibaca tapi tidak ada data.");
          setLoading(false);
          return;
        }

        const importedAt = new Date().toISOString();

        // Fetch ALL existing print status & data from Firestore so we NEVER reset already printed invoices or rich item data
        const { docs: existingDBDocs, progression: loadedProgression, printState: loadedPrintState } = await getExistingFakturs();
        const existingDB = existingDBDocs as unknown as Array<Record<string, unknown>>;

        const existingStatusMap = new Map<
          string,
          {
            no_sales_order: string | null;
            status_cetak: boolean;
            printed_at: string | null;
            extra: Record<string, unknown> | null;
          }
        >();
        let existingProgression: InvoiceProgression = loadedProgression || {};
        let prev1PNum = -1;
        let prev1PStr = "-";
        let prev2PNum = -1;
        let prev2PStr = "-";
        let prev3PNum = -1;
        let prev3PStr = "-";
        let prevDooNum = -1;
        let prevDooStr = "-";
        let prevOraNum = -1;
        let prevOraStr = "-";

        existingDB.forEach((row: Record<string, unknown>) => {
          if (row.no_faktur === "__SYSTEM_METADATA__") {
            const extra = (row.extra as Record<string, unknown>) || {};
            if (extra.invoiceProgression) {
              existingProgression = extra.invoiceProgression as InvoiceProgression;
            }
            return;
          }
          const rawInv = String(row.no_faktur || "");
          const cleanInv = rawInv.replace(/-1P$/i, "");
          const extra = (row.extra as Record<string, unknown>) || {};
          const cust = String(extra.nama_pelanggan || "");
          const isOra = isOraCustomer(cust, (extra.jenis_transaksi as string) || (row.source_file as string));
          const num = parseInvNum(cleanInv);
          const kat = categorize(isOra ? "ORA" : "DOO", cust, (extra.jenis_transaksi as string) || (row.source_file as string));

          if (num > 0) {
            if (kat === "1P" && num > prev1PNum) {
              prev1PNum = num;
              prev1PStr = cleanInv;
            }
            if (kat === "2P" && num > prev2PNum) {
              prev2PNum = num;
              prev2PStr = cleanInv;
            }
            if (kat === "3P" && num > prev3PNum) {
              prev3PNum = num;
              prev3PStr = cleanInv;
            }

            if (isOra) {
              if (num > prevOraNum) {
                prevOraNum = num;
                prevOraStr = cleanInv;
              }
            } else {
              if (num > prevDooNum) {
                prevDooNum = num;
                prevDooStr = cleanInv;
              }
            }
          }

          const rawFaktur = String(row.no_faktur || "").trim();
          const cleanFaktur = rawFaktur.replace(/-1P$/i, "");
          const statusInfo = {
            no_sales_order: (row.no_sales_order as string) || null,
            status_cetak: Boolean(row.status_cetak),
            printed_at: (row.printed_at as string) || null,
            extra: (row.extra as Record<string, unknown>) || null,
          };

          if (rawFaktur) existingStatusMap.set(rawFaktur, statusInfo);
          if (cleanFaktur) existingStatusMap.set(cleanFaktur, statusInfo);
          if (cleanFaktur) existingStatusMap.set(`${cleanFaktur}-1P`, statusInfo);
          if (row.no_sales_order) {
            String(row.no_sales_order).split(",").forEach((s) => {
              const soClean = s.trim();
              if (soClean) existingStatusMap.set(`SO-${soClean}`, statusInfo);
            });
          }
        });

        // Check if uploaded file contains detailed items (XXCUST format)
        const isFileItemRich = parsed.some(
          (r) => r.itemCode && r.itemCode !== "-" && r.itemCode !== ""
        );

        // Pre-populate invMap with ALL existing records from DB so multiple files (ORA + DOO + XXCUST) merge seamlessly
        const invMap = new Map<string, Record<string, unknown>>();
        existingDB.forEach((row) => {
          if (row.no_faktur === "__SYSTEM_METADATA__") return;
          const k = String(row.no_faktur || row.id || "");
          if (k) {
            const extra = (row.extra as Record<string, unknown>) || {};
            const soSet = new Set<string>();
            if (row.no_sales_order) {
              String(row.no_sales_order).split(",").forEach((s) => {
                const t = s.trim();
                if (t && t !== "-") soSet.add(t);
              });
            }
            const prevItems = (extra.items as Array<Record<string, unknown>>) || [];
            prevItems.forEach((it) => {
              const so = String(it.order_number || "").trim();
              if (so && so !== "-") soSet.add(so);
            });
            const hasExistingRichItems =
              prevItems.length > 0 &&
              prevItems.some((it) => it.item_code && it.item_code !== "-" && it.item_code !== "");

            invMap.set(k, {
              ...row,
              _soSet: soSet,
              _hasPreservedItems: hasExistingRichItems,
            });
          }
        });

        // Merge incoming records into invMap
        for (const r of parsed) {
          const isOra = isOraCustomer(r.customerName, r.jenisTransaksi);
          const cleanInv = String(r.invoiceNumber || "").trim();
          const hasInv = cleanInv && cleanInv !== "0" && cleanInv !== "-";
          const noFaktur = hasInv ? (isOra ? `${cleanInv}-1P` : cleanInv) : (r.orderNumber ? `SO-${r.orderNumber}` : `ROW-${r.rowIndex}`);
          if (!noFaktur || noFaktur === "SO-" || noFaktur === "-1P") continue;

          // Check if already in invMap with any key variant
          const targetKey = invMap.has(noFaktur)
            ? noFaktur
            : invMap.has(cleanInv)
            ? cleanInv
            : invMap.has(`${cleanInv}-1P`)
            ? `${cleanInv}-1P`
            : noFaktur;

          const prevInfo =
            existingStatusMap.get(targetKey) ||
            existingStatusMap.get(noFaktur) ||
            existingStatusMap.get(cleanInv) ||
            existingStatusMap.get(`${cleanInv}-1P`) ||
            (r.orderNumber ? existingStatusMap.get(`SO-${r.orderNumber}`) : undefined);
          const isPrinted = prevInfo ? prevInfo.status_cetak : false;
          const printedAt = prevInfo ? prevInfo.printed_at : null;
          const prevExtra = (prevInfo?.extra as Record<string, unknown>) || null;
          const prevItems = (prevExtra?.items as Array<Record<string, unknown>>) || [];
          const hasExistingRichItems =
            prevItems.length > 0 &&
            prevItems.some(
              (it) => it.item_code && it.item_code !== "-" && it.item_code !== ""
            );

          const isIncomingItem = Boolean(
            r.itemCode && r.itemCode !== "-" && r.itemCode !== ""
          );

          if (!invMap.has(targetKey)) {
            const existingName = String(prevExtra?.nama_pelanggan || "").trim();
            const incomingName = String(r.customerName || "").trim();

            const isIncomingGenericHelios =
              incomingName.toUpperCase().includes("HELIOS") ||
              incomingName.toUpperCase() === "PT HELIOS ALCHEMIST KESEHATAN" ||
              incomingName === "1001" ||
              !incomingName ||
              incomingName === "-" ||
              /^\d+$/.test(incomingName);

            const isExistingSpecificCustomer =
              existingName &&
              existingName !== "-" &&
              !/^\d+$/.test(existingName) &&
              existingName.toUpperCase() !== "PT HELIOS ALCHEMIST KESEHATAN" &&
              existingName.toUpperCase() !== "HELIOS";

            let finalCustomerName = incomingName;
            if (isExistingSpecificCustomer && isIncomingGenericHelios) {
              finalCustomerName = existingName;
            } else if (!finalCustomerName || /^\d+$/.test(finalCustomerName)) {
              if (existingName && !/^\d+$/.test(existingName)) {
                finalCustomerName = existingName;
              }
            }

            const soSet = new Set<string>();
            if (prevInfo?.no_sales_order) {
              prevInfo.no_sales_order.split(",").forEach((s) => {
                const t = s.trim();
                if (t && t !== "-") soSet.add(t);
              });
            }
            if (r.orderNumber && r.orderNumber !== "-" && r.orderNumber !== "") {
              soSet.add(r.orderNumber);
            }

            const baseItems: Array<Record<string, unknown>> = [];
            if (hasExistingRichItems) {
              baseItems.push(...prevItems);
            }

            invMap.set(targetKey, {
              no_faktur: targetKey,
              no_sales_order: Array.from(soSet).join(", ") || r.orderNumber || "-",
              customer_name: finalCustomerName || r.customerName || "-",
              order_date: r.orderDate || "-",
              jenis_transaksi: r.jenisTransaksi,
              kategori: r.kategori,
              status_cetak: isPrinted,
              printed_at: printedAt,
              imported_at: importedAt,
              source_file: r.jenisTransaksi,
              extra: {
                nama_pelanggan: finalCustomerName || r.customerName,
                order_date: r.orderDate,
                accounting_date: r.orderDate,
                jenis_transaksi: r.jenisTransaksi,
                kategori: r.kategori,
                items: baseItems,
              },
              _soSet: soSet,
              _hasPreservedItems: hasExistingRichItems,
            });
          }

          const existing = invMap.get(targetKey)!;
          if (isPrinted) {
            existing.status_cetak = true;
            if (printedAt) existing.printed_at = printedAt;
          }

          // ALWAYS preserve and accumulate valid SO numbers
          if (r.orderNumber && r.orderNumber !== "-" && r.orderNumber !== "") {
            (existing._soSet as Set<string>).add(r.orderNumber);
          }

          // Customer name refinement: If incoming has a specific name and existing is generic Helios, update it
          const currentCust = String(existing.customer_name || (existing.extra as Record<string, unknown>)?.nama_pelanggan || "");
          const incomingCust = String(r.customerName || "");
          const isCurrentGeneric =
            !currentCust ||
            currentCust === "-" ||
            currentCust.toUpperCase().includes("HELIOS") ||
            currentCust.toUpperCase() === "PT HELIOS ALCHEMIST KESEHATAN" ||
            currentCust === "1001" ||
            /^\d+$/.test(currentCust);
          const isIncomingSpecific =
            incomingCust &&
            incomingCust !== "-" &&
            !incomingCust.toUpperCase().includes("HELIOS") &&
            !/^\d+$/.test(incomingCust);

          if (isCurrentGeneric && isIncomingSpecific) {
            existing.customer_name = incomingCust;
            if (existing.extra) {
              (existing.extra as Record<string, unknown>).nama_pelanggan = incomingCust;
            }
          }

          if (isFileItemRich && isIncomingItem) {
            const itList = (existing.extra as Record<string, unknown>).items as Array<Record<string, unknown>>;
            const katProd = getProductCategory(r.itemCode, r.itemDescription) || r.kategoriProduk || "FARMA";
            itList.push({
              item_code: r.itemCode,
              item_description: r.itemDescription,
              kategori_produk: katProd,
              qty: r.qty,
              uom: r.uom,
              lot_number: r.lotNumber,
              total_harga: r.totalHarga,
              order_number: r.orderNumber,
            });
          } else if (!existing._hasPreservedItems) {
            const itList = (existing.extra as Record<string, unknown>).items as Array<Record<string, unknown>>;
            if (itList.length === 0) {
              const katProd = getProductCategory(r.itemCode, r.itemDescription) || r.kategoriProduk || "FARMA";
              itList.push({
                item_code: r.itemCode,
                item_description: r.itemDescription,
                kategori_produk: katProd,
                qty: r.qty,
                uom: r.uom,
                lot_number: r.lotNumber,
                total_harga: r.totalHarga,
                order_number: r.orderNumber,
              });
            }
          }
        }

        const payload: FirestoreFakturDoc[] = Array.from(invMap.values()).map(({ _soSet, _hasPreservedItems, ...rest }) => {
          const soArr = Array.from(_soSet as Set<string>).filter((s) => s && s !== "-");
          const finalSO = soArr.length > 0 ? soArr.join(", ") : (rest.no_sales_order && rest.no_sales_order !== "-" ? String(rest.no_sales_order) : "-");
          return {
            ...rest,
            id: String(rest.no_faktur),
            no_sales_order: finalSO,
            updated_at: new Date().toISOString(),
          };
        }) as unknown as FirestoreFakturDoc[];

        // Calculate min/max invoices per category (1P, 2P, 3P, ORA, DOO) in uploaded file
        let minUploaded1PNum = Infinity;
        let minUploaded1PStr = "-";
        let maxUploaded1PNum = -1;
        let maxUploaded1PStr = "-";

        let minUploaded2PNum = Infinity;
        let minUploaded2PStr = "-";
        let maxUploaded2PNum = -1;
        let maxUploaded2PStr = "-";

        let minUploaded3PNum = Infinity;
        let minUploaded3PStr = "-";
        let maxUploaded3PNum = -1;
        let maxUploaded3PStr = "-";

        let minUploadedOraNum = Infinity;
        let minUploadedOraStr = "-";
        let maxUploadedOraNum = -1;
        let maxUploadedOraStr = "-";

        let minUploadedDooNum = Infinity;
        let minUploadedDooStr = "-";
        let maxUploadedDooNum = -1;
        let maxUploadedDooStr = "-";
        let newUnprintedCount = 0;

        for (const [noFaktur, item] of invMap.entries()) {
          const isPrinted = (item as { status_cetak?: boolean }).status_cetak;
          if (!isPrinted) newUnprintedCount++;
          const extra = (item as { extra?: Record<string, unknown> }).extra || {};
          const cust = String(extra.nama_pelanggan || "");
          const isOra = (item as { source_file?: string }).source_file === "ORA";
          const cleanInv = noFaktur.replace(/-1P$/i, "");
          const num = parseInvNum(cleanInv);
          const kat = (extra.kategori as "1P" | "2P" | "3P") || categorize(isOra ? "ORA" : "DOO", cust, isOra ? "ORA" : "DOO");

          if (num > 0) {
            if (kat === "1P") {
              if (num > maxUploaded1PNum) {
                maxUploaded1PNum = num;
                maxUploaded1PStr = cleanInv;
              }
              if (num < minUploaded1PNum) {
                minUploaded1PNum = num;
                minUploaded1PStr = cleanInv;
              }
            }
            if (kat === "2P") {
              if (num > maxUploaded2PNum) {
                maxUploaded2PNum = num;
                maxUploaded2PStr = cleanInv;
              }
              if (num < minUploaded2PNum) {
                minUploaded2PNum = num;
                minUploaded2PStr = cleanInv;
              }
            }
            if (kat === "3P") {
              if (num > maxUploaded3PNum) {
                maxUploaded3PNum = num;
                maxUploaded3PStr = cleanInv;
              }
              if (num < minUploaded3PNum) {
                minUploaded3PNum = num;
                minUploaded3PStr = cleanInv;
              }
            }
            if (isOra) {
              if (num > maxUploadedOraNum) {
                maxUploadedOraNum = num;
                maxUploadedOraStr = cleanInv;
              }
              if (num < minUploadedOraNum) {
                minUploadedOraNum = num;
                minUploadedOraStr = cleanInv;
              }
            }
            if (!isOra) {
              if (num > maxUploadedDooNum) {
                maxUploadedDooNum = num;
                maxUploadedDooStr = cleanInv;
              }
              if (num < minUploadedDooNum) {
                minUploadedDooNum = num;
                minUploadedDooStr = cleanInv;
              }
            }
          }
        }

        let range1P = existingProgression.range1P || null;
        let prev1P = existingProgression.prev1P || null;
        let new1P = existingProgression.new1P || null;
        if (maxUploaded1PNum > 0) {
          new1P = maxUploaded1PStr;
          if (prev1PNum > 0 && maxUploaded1PNum > prev1PNum) {
            prev1P = prev1PStr;
            range1P = `${prev1PStr} ➔ ${maxUploaded1PStr}`;
          } else if (minUploaded1PNum > 0 && minUploaded1PNum !== maxUploaded1PNum) {
            prev1P = minUploaded1PStr;
            range1P = `${minUploaded1PStr} ➔ ${maxUploaded1PStr}`;
          } else {
            prev1P = prev1PStr !== "-" ? prev1PStr : maxUploaded1PStr;
            range1P = maxUploaded1PStr;
          }
        }

        let range2P = existingProgression.range2P || null;
        let prev2P = existingProgression.prev2P || null;
        let new2P = existingProgression.new2P || null;
        if (maxUploaded2PNum > 0) {
          new2P = maxUploaded2PStr;
          if (prev2PNum > 0 && maxUploaded2PNum > prev2PNum) {
            prev2P = prev2PStr;
            range2P = `${prev2PStr} ➔ ${maxUploaded2PStr}`;
          } else if (minUploaded2PNum > 0 && minUploaded2PNum !== maxUploaded2PNum) {
            prev2P = minUploaded2PStr;
            range2P = `${minUploaded2PStr} ➔ ${maxUploaded2PStr}`;
          } else {
            prev2P = prev2PStr !== "-" ? prev2PStr : maxUploaded2PStr;
            range2P = maxUploaded2PStr;
          }
        }

        let range3P = existingProgression.range3P || null;
        let prev3P = existingProgression.prev3P || null;
        let new3P = existingProgression.new3P || null;
        if (maxUploaded3PNum > 0) {
          new3P = maxUploaded3PStr;
          if (prev3PNum > 0 && maxUploaded3PNum > prev3PNum) {
            prev3P = prev3PStr;
            range3P = `${prev3PStr} ➔ ${maxUploaded3PStr}`;
          } else if (minUploaded3PNum > 0 && minUploaded3PNum !== maxUploaded3PNum) {
            prev3P = minUploaded3PStr;
            range3P = `${minUploaded3PStr} ➔ ${maxUploaded3PStr}`;
          } else {
            prev3P = prev3PStr !== "-" ? prev3PStr : maxUploaded3PStr;
            range3P = maxUploaded3PStr;
          }
        }

        let rangeOra = existingProgression.rangeOra || null;
        let prevOra = existingProgression.prevOra || null;
        let newOra = existingProgression.newOra || null;
        if (maxUploadedOraNum > 0) {
          newOra = maxUploadedOraStr;
          if (prevOraNum > 0 && maxUploadedOraNum > prevOraNum) {
            prevOra = prevOraStr;
            rangeOra = `${prevOraStr} ➔ ${maxUploadedOraStr}`;
          } else if (minUploadedOraNum > 0 && minUploadedOraNum !== maxUploadedOraNum) {
            prevOra = minUploadedOraStr;
            rangeOra = `${minUploadedOraStr} ➔ ${maxUploadedOraStr}`;
          } else {
            prevOra = prevOraStr !== "-" ? prevOraStr : maxUploadedOraStr;
            rangeOra = maxUploadedOraStr;
          }
        }

        let rangeDoo = existingProgression.rangeDoo || null;
        let prevDoo = existingProgression.prevDoo || null;
        let newDoo = existingProgression.newDoo || null;
        if (maxUploadedDooNum > 0) {
          newDoo = maxUploadedDooStr;
          if (prevDooNum > 0 && maxUploadedDooNum > prevDooNum) {
            prevDoo = prevDooStr;
            rangeDoo = `${prevDooStr} ➔ ${maxUploadedDooStr}`;
          } else if (minUploadedDooNum > 0 && minUploadedDooNum !== maxUploadedDooNum) {
            prevDoo = minUploadedDooStr;
            rangeDoo = `${minUploadedDooStr} ➔ ${maxUploadedDooStr}`;
          } else {
            prevDoo = prevDooStr !== "-" ? prevDooStr : maxUploadedDooStr;
            rangeDoo = maxUploadedDooStr;
          }
        }

        const progObj: InvoiceProgression = {
          ...existingProgression,
          prev1P,
          new1P,
          range1P,
          prev2P,
          new2P,
          range2P,
          prev3P,
          new3P,
          range3P,
          prevDoo,
          newDoo,
          rangeDoo,
          prevOra,
          newOra,
          rangeOra,
          updatedAt: new Date().toLocaleTimeString("id-ID"),
        };

        // 1. INSTANT LOCAL STATE UPDATE (0ms perceptible delay)
        const { records: localRecs, printedSet: localPrintedSet, printedAtMap: localPrintedAtMap } = dbRowsToFakturRecords(
          payload as unknown as Array<Record<string, unknown>>
        );

        setRecords(localRecs);
        setPrintedInvoices(localPrintedSet);
        setPrintedAtMap(localPrintedAtMap);
        setInvoiceProgression(progObj);
        try {
          localStorage.setItem("invoiceProgression", JSON.stringify(progObj));
        } catch {}

        setUploadNotification({
          fileName: file.name,
          prevOra,
          maxOra: maxUploadedOraStr,
          rangeOra,
          prevDoo,
          maxDoo: maxUploadedDooStr,
          rangeDoo,
          totalItems: parsed.length,
          totalInvoices: invMap.size,
          newUnprinted: newUnprintedCount,
          time: new Date().toLocaleTimeString("id-ID"),
        });

        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, count: parsed.length, time: new Date().toLocaleString("id-ID") },
        ]);
        setPage(0);
        setLoading(false); // Instant unlock!

        // 2. BACKGROUND FIRESTORE SYNC (Non-blocking)
        saveFaktursBatch(
          payload as FirestoreFakturDoc[],
          progObj,
          loadedPrintState || {
            printedKeys: Array.from(localPrintedSet),
            printedAtMap: localPrintedAtMap,
            updatedAt: new Date().toISOString(),
          }
        ).catch((err) => {
          console.error("Background Firestore save warning:", err);
        });
        setPage(0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal membaca file.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      e.target.value = "";
    },
    [handleUpload]
  );

  const clearAll = async () => {
    if (!confirm("Yakin ingin menghapus semua data? Data di database cloud juga akan terhapus.")) return;
    setLoading(true);
    setRecords([]);
    setUploadedFiles([]);
    setPrintedInvoices(new Set());
    setExpandedInvoices(new Set());
    setPrintedAtMap({});
    setFilter("all");
    setKatFilter("all");
    setJenisFilter("all");
    setSearch("");
    setPage(0);
    try {
      localStorage.removeItem("records");
      localStorage.removeItem("uploadedFiles");
      localStorage.removeItem("printedInvoices");
      localStorage.removeItem("printedAtMap");
      localStorage.removeItem("invoiceProgression");
    } catch {}

    await clearAllFakturs();
    setLoading(false);
  };

  // Group strictly by Invoice Key so every individual faktur/invoice is isolated with exact total harga
  const grouped = useMemo<FakturGroup[]>(() => {
    const map: Record<string, FakturRecord[]> = {};
    for (const r of records) {
      const gKey = r.invoiceKey || r.invoiceNumber;
      if (!map[gKey]) map[gKey] = [];
      map[gKey].push(r);
    }

    // Detect double invoices per SO
    const soInvMap: Record<string, Set<string>> = {};
    for (const r of records) {
      if (!soInvMap[r.orderNumber]) soInvMap[r.orderNumber] = new Set();
      if (r.invoiceNumber && r.invoiceNumber !== "0" && r.invoiceNumber !== "-") {
        soInvMap[r.orderNumber].add(r.invoiceNumber);
      }
    }

    return Object.entries(map)
      .map(([key, items]) => {
        const invNum = items[0].invoiceNumber;
        const invKey = items[0].invoiceKey;
        const soList = [...new Set(items.map((i) => i.orderNumber).filter(Boolean))];
        const soStr = soList.join(", ");
        const isDouble = soList.some((s) => (soInvMap[s]?.size || 0) > 1);
        const pAt = printedAtMap[invKey] || null;
        const isPrinted = printedInvoices.has(invKey);

        const catCounts: Record<string, number> = {};
        let hasPrekursor = false;
        let hasOOT = false;
        let hasCCP = false;
        let hasAlkes = false;
        let hasFarma = false;

        items.forEach((i) => {
          const itemCat = (i.kategoriProduk || getProductCategory(i.itemCode, i.itemDescription) || "FARMA").toUpperCase();
          if (itemCat === "PREKURSOR") hasPrekursor = true;
          else if (itemCat === "OOT") hasOOT = true;
          else if (itemCat === "CCP") hasCCP = true;
          else if (itemCat === "ALKES") hasAlkes = true;
          else hasFarma = true;

          catCounts[itemCat] = (catCounts[itemCat] || 0) + 1;
        });

        // Tentukan kategori dominan (prioritas pengawasan: PREKURSOR > OOT > CCP > ALKES > FARMA jika ada)
        const prioOrder = ["PREKURSOR", "OOT", "CCP", "ALKES", "FARMA"];
        let dominantCategory = "FARMA";
        for (const p of prioOrder) {
          if (catCounts[p]) {
            dominantCategory = p;
            break;
          }
        }

        return {
          key,
          invoiceNumber: invNum,
          invoiceKey: invKey,
          so: soStr || items[0].orderNumber,
          items,
          orderDate: items[0].orderDate,
          jenisTransaksi: items[0].jenisTransaksi,
          customerName: items[0].customerName,
          kategori: items[0].kategori,
          kategoriProduk: dominantCategory,
          kategoriProdukCounts: catCounts,
          hasPrekursor,
          hasOOT,
          hasCCP,
          hasAlkes,
          hasFarma,
          isDoubleInv: isDouble,
          totalHarga: items.reduce((sum, i) => sum + i.totalHarga, 0),
          totalItems: items.length,
          allPrinted: isPrinted,
          anyPrinted: isPrinted,
          printedAt: pAt,
        };
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === "date") {
          diff = parseDateMs(a.orderDate) - parseDateMs(b.orderDate);
          if (diff === 0) diff = parseInvNum(a.invoiceNumber) - parseInvNum(b.invoiceNumber);
        } else if (sortBy === "totalHarga") {
          diff = a.totalHarga - b.totalHarga;
          if (diff === 0) diff = parseInvNum(a.invoiceNumber) - parseInvNum(b.invoiceNumber);
        } else {
          // Default: Sort by Invoice Number
          const invA = parseInvNum(a.invoiceNumber);
          const invB = parseInvNum(b.invoiceNumber);
          diff = invA !== invB ? invA - invB : parseDateMs(a.orderDate) - parseDateMs(b.orderDate);
        }
        return sortOrder === "desc" ? -diff : diff;
      });
  }, [records, printedInvoices, printedAtMap, sortBy, sortOrder]);

  const highestInvoices = useMemo(() => {
    let max1POra = { invoiceNumber: "-", totalHarga: 0, orderDate: "-", isPrinted: false, customerName: "", jenisTransaksi: "ORA" };
    let max1PDoo = { invoiceNumber: "-", totalHarga: 0, orderDate: "-", isPrinted: false, customerName: "", jenisTransaksi: "DOO" };
    let max2P = { invoiceNumber: "-", totalHarga: 0, orderDate: "-", isPrinted: false, customerName: "", jenisTransaksi: "2P" };
    let max3P = { invoiceNumber: "-", totalHarga: 0, orderDate: "-", isPrinted: false, customerName: "", jenisTransaksi: "3P" };

    let max1POraNum = -1;
    let max1PDooNum = -1;
    let max2PNum = -1;
    let max3PNum = -1;

    for (const g of grouped) {
      const num = parseInvNum(g.invoiceNumber);
      if (num <= 0) continue;

      const itemInfo = {
        invoiceNumber: g.invoiceNumber,
        totalHarga: g.totalHarga,
        orderDate: g.orderDate,
        isPrinted: g.allPrinted,
        customerName: g.customerName,
        jenisTransaksi: g.jenisTransaksi,
      };

      if (g.kategori === "1P") {
        if (g.jenisTransaksi === "ORA" && num > max1POraNum) {
          max1POraNum = num;
          max1POra = itemInfo;
        } else if (g.jenisTransaksi === "DOO" && num > max1PDooNum) {
          max1PDooNum = num;
          max1PDoo = itemInfo;
        }
      }
      if (g.kategori === "2P" && num > max2PNum) {
        max2PNum = num;
        max2P = itemInfo;
      }
      if (g.kategori === "3P" && num > max3PNum) {
        max3PNum = num;
        max3P = itemInfo;
      }
    }

    return {
      max1POra,
      max1PDoo,
      max2P,
      max3P,
    };
  }, [grouped]);

  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.orderDate && r.orderDate !== "-") set.add(r.orderDate);
    }
    return Array.from(set).sort((a, b) => parseDateMs(b) - parseDateMs(a));
  }, [records]);

  const filtered = useMemo(() => {
    let result = grouped;

    if (dateFilter !== "all") {
      result = result.filter((g) => g.orderDate === dateFilter);
    }

    if (search.trim()) {
      const s = search.toLowerCase().trim();
      const allMatches = result.filter(
        (g) =>
          g.so.toLowerCase().includes(s) ||
          g.invoiceNumber.toLowerCase().includes(s) ||
          g.customerName.toLowerCase().includes(s) ||
          (g.kategoriProduk && g.kategoriProduk.toLowerCase().includes(s)) ||
          g.items.some(
            (i) =>
              i.itemDescription.toLowerCase().includes(s) ||
              i.itemCode.toLowerCase().includes(s) ||
              (i.kategoriProduk && i.kategoriProduk.toLowerCase().includes(s)) ||
              (i.klasifikasiObat && i.klasifikasiObat.toLowerCase().includes(s))
          )
      );

      // Try applying current active tab filters to the matches
      let tabMatches = allMatches;
      if (filter === "belum") {
        tabMatches = tabMatches.filter(
          (g) => !g.allPrinted || sessionPrintedKeys.has(g.invoiceKey)
        );
      } else if (filter === "sudah") {
        tabMatches = tabMatches.filter((g) => g.allPrinted);
      } else if (filter === "double") {
        tabMatches = tabMatches.filter((g) => g.isDoubleInv);
      }

      if (katFilter !== "all") tabMatches = tabMatches.filter((g) => g.kategori === katFilter);
      if (jenisFilter !== "all") tabMatches = tabMatches.filter((g) => g.jenisTransaksi === jenisFilter);
      if (klasFilter === "prekursor") tabMatches = tabMatches.filter((g) => g.hasPrekursor);
      if (klasFilter === "oot") tabMatches = tabMatches.filter((g) => g.hasOOT);
      if (klasFilter === "ccp") tabMatches = tabMatches.filter((g) => g.hasCCP);
      if (klasFilter === "alkes") tabMatches = tabMatches.filter((g) => g.hasAlkes);
      if (klasFilter === "farma") tabMatches = tabMatches.filter((g) => g.hasFarma);

      // If matches exist in current tab, show them; otherwise fallback to allMatches so user is never misled
      return tabMatches.length > 0 ? tabMatches : allMatches;
    }

    if (filter === "belum") {
      result = result.filter(
        (g) => !g.allPrinted || sessionPrintedKeys.has(g.invoiceKey)
      );
    } else if (filter === "sudah") {
      result = result.filter((g) => g.allPrinted);
    } else if (filter === "double") {
      result = result.filter((g) => g.isDoubleInv);
    }
    if (katFilter !== "all") result = result.filter((g) => g.kategori === katFilter);
    if (jenisFilter !== "all") result = result.filter((g) => g.jenisTransaksi === jenisFilter);
    if (klasFilter === "prekursor") result = result.filter((g) => g.hasPrekursor);
    if (klasFilter === "oot") result = result.filter((g) => g.hasOOT);
    if (klasFilter === "ccp") result = result.filter((g) => g.hasCCP);
    if (klasFilter === "alkes") result = result.filter((g) => g.hasAlkes);
    if (klasFilter === "farma") result = result.filter((g) => g.hasFarma);

    return result;
  }, [grouped, filter, katFilter, jenisFilter, klasFilter, dateFilter, search, sessionPrintedKeys]);

  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  const unprintedCountInFiltered = useMemo(() => {
    return filtered.filter(
      (g) => !g.allPrinted && g.invoiceNumber && g.invoiceNumber !== "0" && g.invoiceNumber !== "-"
    ).length;
  }, [filtered]);

  // Mark All As Printed (Tandai Semua Selesai)
  const handleMarkAllPrinted = useCallback(async () => {
    const unprintedInView = filtered.filter(
      (g) => !g.allPrinted && g.invoiceNumber && g.invoiceNumber !== "0" && g.invoiceNumber !== "-"
    );

    if (unprintedInView.length === 0) {
      alert("Semua faktur yang tampil sudah berstatus Selesai Terprint.");
      return;
    }

    const confirmMsg = `Yakin ingin menandai ${unprintedInView.length} faktur yang tampil sebagai SUDAH TERPRINT?`;
    if (!confirm(confirmMsg)) return;

    const nowIso = new Date().toISOString();
    const targetKeys = unprintedInView.map((g) => g.invoiceKey);

    // 1. Optimistic Update Local State
    setPrintedInvoices((prev) => {
      const next = new Set(prev);
      targetKeys.forEach((k) => {
        const cleanK = k.replace(/-1P$/i, "");
        next.add(k);
        next.add(cleanK);
        next.add(`${cleanK}-1P`);
      });
      try {
        localStorage.setItem("printedInvoices", JSON.stringify([...next]));
      } catch {}
      return next;
    });

    setSessionPrintedKeys((prev) => {
      const sNext = new Set(prev);
      targetKeys.forEach((k) => {
        const cleanK = k.replace(/-1P$/i, "");
        sNext.add(k);
        sNext.add(cleanK);
        sNext.add(`${cleanK}-1P`);
      });
      return sNext;
    });

    setPrintedAtMap((prev) => {
      const nextMap = { ...prev };
      targetKeys.forEach((k) => {
        const cleanK = k.replace(/-1P$/i, "");
        nextMap[k] = nowIso;
        nextMap[cleanK] = nowIso;
        nextMap[`${cleanK}-1P`] = nowIso;
      });
      try {
        localStorage.setItem("printedAtMap", JSON.stringify(nextMap));
      } catch {}
      return nextMap;
    });

    // 2. Batch Update to Firestore Cloud DB
    try {
      setLoading(true);
      await updateFaktursPrintStatusBatch(targetKeys, true, nowIso);
      setCopyToast(`✓ Berhasil menandai ${targetKeys.length} faktur selesai diprint!`);
      setTimeout(() => setCopyToast(null), 3500);
    } catch (err) {
      console.error("Gagal update batch print ke Firestore:", err);
      alert("Terjadi kesalahan saat menyimpan status ke database cloud.");
    } finally {
      setLoading(false);
    }
  }, [filtered]);

  useEffect(() => {
    setPage(0);
    setSelectedRowIndex(0);
  }, [filter, katFilter, jenisFilter, klasFilter, dateFilter, search, sortBy, sortOrder]);

  // Clamp selection on page change
  useEffect(() => {
    setSelectedRowIndex((prev) => Math.min(Math.max(0, prev), Math.max(0, pageData.length - 1)));
  }, [page, pageData.length]);

  // Auto-scroll active row into view instantly (0ms delay)
  useEffect(() => {
    if (pageData.length === 0) return;
    const rowEl = document.getElementById(`faktur-row-${selectedRowIndex}`);
    if (rowEl) {
      rowEl.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [selectedRowIndex, pageData.length]);

  // Keyboard navigation listener (Spreadsheet-like)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (pageData.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedRowIndex((prev) => {
          if (prev < pageData.length - 1) return prev + 1;
          if (page < totalPages - 1) {
            setPage((p) => p + 1);
            return 0;
          }
          return prev;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRowIndex((prev) => {
          if (prev > 0) return prev - 1;
          if (page > 0) {
            setPage((p) => p - 1);
            return ROWS_PER_PAGE - 1;
          }
          return prev;
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedColIdx((prev) => Math.min(10, prev + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedColIdx((prev) => Math.max(0, prev - 1));
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (target && target.tagName === "BUTTON") {
          target.blur();
        }
        const currentGroup = pageData[selectedRowIndex];
        if (
          currentGroup &&
          currentGroup.invoiceNumber &&
          currentGroup.invoiceNumber !== "0" &&
          currentGroup.invoiceNumber !== "-"
        ) {
          togglePrint(currentGroup);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const currentGroup = pageData[selectedRowIndex];
        if (currentGroup) {
          toggleExpand(currentGroup.key);
        }
      } else if (e.key === "PageDown" || e.key === "]") {
        e.preventDefault();
        setPage((p) => Math.min(totalPages - 1, p + 1));
      } else if (e.key === "PageUp" || e.key === "[") {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const selection = window.getSelection()?.toString();
        if (!selection) {
          e.preventDefault();
          const currentGroup = pageData[selectedRowIndex];
          if (currentGroup) {
            let textToCopy = "";
            switch (selectedColIdx) {
              case 0: // Expand / Whole row
                textToCopy = [
                  currentGroup.allPrinted ? "✓" : "○",
                  currentGroup.so,
                  currentGroup.invoiceNumber,
                  currentGroup.kategoriProduk || "-",
                  currentGroup.jenisTransaksi,
                  currentGroup.customerName,
                  currentGroup.orderDate,
                  currentGroup.kategori,
                  currentGroup.printedAt ? formatPrintTime(currentGroup.printedAt) : "-",
                  currentGroup.totalHarga,
                ].join("\t");
                break;
              case 1: // Print status
                textToCopy = currentGroup.allPrinted ? "Sudah Terprint" : "Belum Terprint";
                break;
              case 2: // No SO
                textToCopy = currentGroup.so;
                break;
              case 3: // No Invoice
                textToCopy = currentGroup.invoiceNumber;
                break;
              case 4: // Kategori Produk
                textToCopy = currentGroup.kategoriProduk || "-";
                break;
              case 5: // Jenis Transaksi
                textToCopy = currentGroup.jenisTransaksi;
                break;
              case 6: // Pelanggan
                textToCopy = currentGroup.customerName;
                break;
              case 7: // Order Date
                textToCopy = currentGroup.orderDate;
                break;
              case 8: // Kategori 1P/2P/3P
                textToCopy = currentGroup.kategori;
                break;
              case 9: // Done Print
                textToCopy = currentGroup.printedAt ? formatPrintTime(currentGroup.printedAt) : "-";
                break;
              case 10: // Total Harga
                textToCopy = String(currentGroup.totalHarga);
                break;
              default:
                textToCopy = currentGroup.invoiceNumber || currentGroup.so;
            }

            if (textToCopy) {
              navigator.clipboard.writeText(textToCopy);
              const preview = textToCopy.length > 35 ? textToCopy.slice(0, 35) + "..." : textToCopy;
              setCopyToast(`📋 Disalin: ${preview}`);
              setTimeout(() => setCopyToast(null), 2500);
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pageData, selectedRowIndex, selectedColIdx, page, totalPages, togglePrint, toggleExpand]);

  const summary = useMemo(() => {
    const uniqueInvoices = new Set(records.map((r) => r.invoiceKey));
    const uniqueSO = new Set(records.map((r) => r.orderNumber));
    const belumTerprint = [...uniqueInvoices].filter(
      (key) => !printedInvoices.has(key)
    ).length;
    const sudahTerprint = [...uniqueInvoices].filter((key) =>
      printedInvoices.has(key)
    ).length;
    const doubleInv = grouped.filter((g) => g.isDoubleInv).length;
    const totalHarga = records.reduce((sum, r) => sum + r.totalHarga, 0);

    return {
      totalInvoices: uniqueInvoices.size,
      totalSO: uniqueSO.size,
      totalItems: records.length,
      belumTerprint,
      sudahTerprint,
      doubleInv,
      totalHarga,
    };
  }, [records, printedInvoices, grouped]);

  const exportToExcel = useCallback(() => {
    if (records.length === 0 && grouped.length === 0) {
      alert("Tidak ada data untuk diekspor.");
      return;
    }

    // Sheet 1: Rekap Faktur (Diurutkan nomor faktur ascending)
    const sortedGroups = [...grouped].sort((a, b) => {
      const invA = parseInvNum(a.invoiceNumber);
      const invB = parseInvNum(b.invoiceNumber);
      if (invA > 0 && invB > 0 && invA !== invB) return invA - invB;
      if (invA > 0 && invB <= 0) return -1;
      if (invB > 0 && invA <= 0) return 1;
      return parseDateMs(a.orderDate) - parseDateMs(b.orderDate);
    });

    const rekapFakturData = sortedGroups.map((g, idx) => ({
      "No": idx + 1,
      "Order Date": g.orderDate || "-",
      "No Invoice": g.invoiceNumber || "Menunggu Faktur",
      "No SO": g.so || "-",
      "Kategori Produk": g.kategoriProduk || "-",
      "Jenis Transaksi": g.jenisTransaksi || "-",
      "Kategori": g.kategori || "-",
      "Pelanggan": g.customerName || "-",
      "Status Cetak": g.allPrinted ? "Sudah Terprint" : g.anyPrinted ? "Sebagian Terprint" : "Belum Terprint",
      "Waktu Selesai Cetak": g.printedAt ? formatPrintTime(g.printedAt) : "-",
      "Jumlah Item": g.totalItems || g.items.length || 1,
      "Total Harga": g.totalHarga,
    }));

    // Sheet 2: Rekap per Sales Order (100% Seluruh SO Pasti Masuk Satu per Satu)
    const soMap = new Map<string, FakturRecord[]>();
    for (const r of records) {
      const soKey = String(r.orderNumber || "").trim() || (r.invoiceNumber ? `INV-${r.invoiceNumber}` : `ROW-${r.rowIndex}`);
      if (!soMap.has(soKey)) soMap.set(soKey, []);
      soMap.get(soKey)!.push(r);
    }

    const sortedSORows = Array.from(soMap.entries()).map(([soKey, items]) => {
      const invList = [...new Set(items.map((i) => i.invoiceNumber).filter((x) => x && x !== "0" && x !== "-"))];
      const invKeyList = [...new Set(items.map((i) => i.invoiceKey).filter(Boolean))];
      const isPrinted = invKeyList.some((k) => printedInvoices.has(k));
      const pAt = invKeyList.map((k) => printedAtMap[k]).find(Boolean) || null;

      const catCounts: Record<string, number> = {};
      items.forEach((i) => {
        const itemCat = (i.kategoriProduk || getProductCategory(i.itemCode, i.itemDescription) || "FARMA").toUpperCase();
        catCounts[itemCat] = (catCounts[itemCat] || 0) + 1;
      });

      const prioOrder = ["PREKURSOR", "OOT", "CCP", "ALKES", "FARMA"];
      let dominantCategory = "FARMA";
      for (const p of prioOrder) {
        if (catCounts[p]) {
          dominantCategory = p;
          break;
        }
      }

      return {
        soNumber: items[0].orderNumber || soKey,
        invoiceNumber: invList.length > 0 ? invList.join(", ") : "Menunggu Faktur",
        orderDate: items[0].orderDate || "-",
        kategoriProduk: dominantCategory,
        jenisTransaksi: items[0].jenisTransaksi || "-",
        kategori: items[0].kategori || "3P",
        customerName: items[0].customerName || "-",
        isPrinted,
        printedAt: pAt,
        totalItems: items.length,
        totalHarga: items.reduce((sum, i) => sum + (Number(i.totalHarga) || 0), 0),
      };
    }).sort((a, b) => {
      return a.soNumber.localeCompare(b.soNumber, undefined, { numeric: true });
    });

    const rekapSOData = sortedSORows.map((s, idx) => ({
      "No": idx + 1,
      "Order Date": s.orderDate,
      "No SO": s.soNumber,
      "No Invoice": s.invoiceNumber,
      "Kategori Produk": s.kategoriProduk,
      "Jenis Transaksi": s.jenisTransaksi,
      "Kategori": s.kategori,
      "Pelanggan": s.customerName,
      "Status Cetak": s.isPrinted ? "Sudah Terprint" : "Belum Terprint",
      "Waktu Selesai Cetak": s.printedAt ? formatPrintTime(s.printedAt) : "-",
      "Jumlah Item": s.totalItems,
      "Total Harga SO": s.totalHarga,
    }));

    // Sheet 3: Detail Rincian Barang per Baris (Semua Item dari Seluruh SO)
    const detailItemsData: Array<Record<string, unknown>> = [];
    let itemIdx = 1;
    for (const r of records) {
      const hasInv = r.invoiceNumber && r.invoiceNumber !== "0" && r.invoiceNumber !== "-";
      detailItemsData.push({
        "No": itemIdx++,
        "No SO": r.orderNumber || "-",
        "No Invoice": hasInv ? r.invoiceNumber : "Menunggu Faktur",
        "Kode Barang": r.itemCode || "-",
        "Kategori Produk": r.kategoriProduk || getProductCategory(r.itemCode, r.itemDescription) || "FARMA",
        "Nama Barang / Deskripsi": r.itemDescription || "-",
        "Qty": r.qty,
        "UOM": r.uom || "-",
        "LOT / Batch Number": r.lotNumber || "-",
        "Total Harga Barang": r.totalHarga,
        "Pelanggan": r.customerName || "-",
        "Order Date": r.orderDate || "-",
        "Jenis Transaksi": r.jenisTransaksi || "-",
        "Kategori": r.kategori || "-",
        "Status Cetak": printedInvoices.has(r.invoiceKey) ? "Sudah Terprint" : "Belum Terprint",
      });
    }

    const workbook = XLSX.utils.book_new();

    // 1. Append Sheet Rekap Faktur
    const wsRekap = XLSX.utils.json_to_sheet(rekapFakturData);
    wsRekap["!cols"] = [
      { wch: 6 },  // No
      { wch: 14 }, // Order Date
      { wch: 16 }, // No Invoice
      { wch: 20 }, // No SO
      { wch: 20 }, // Kategori Produk
      { wch: 16 }, // Jenis Transaksi
      { wch: 10 }, // Kategori
      { wch: 35 }, // Pelanggan
      { wch: 18 }, // Status Cetak
      { wch: 22 }, // Waktu Selesai Cetak
      { wch: 14 }, // Jumlah Item
      { wch: 18 }, // Total Harga
    ];
    XLSX.utils.book_append_sheet(workbook, wsRekap, "Rekap Faktur");

    // 2. Append Sheet Rekap per SO
    const wsRekapSO = XLSX.utils.json_to_sheet(rekapSOData);
    wsRekapSO["!cols"] = [
      { wch: 6 },  // No
      { wch: 14 }, // Order Date
      { wch: 20 }, // No SO
      { wch: 18 }, // No Invoice
      { wch: 20 }, // Kategori Produk
      { wch: 16 }, // Jenis Transaksi
      { wch: 10 }, // Kategori
      { wch: 35 }, // Pelanggan
      { wch: 18 }, // Status Cetak
      { wch: 22 }, // Waktu Selesai Cetak
      { wch: 14 }, // Jumlah Item
      { wch: 18 }, // Total Harga SO
    ];
    XLSX.utils.book_append_sheet(workbook, wsRekapSO, "Rekap per SO");

    // 3. Append Sheet Detail Barang
    if (detailItemsData.length > 0) {
      const wsDetail = XLSX.utils.json_to_sheet(detailItemsData);
      wsDetail["!cols"] = [
        { wch: 6 },  // No
        { wch: 20 }, // No SO
        { wch: 16 }, // No Invoice
        { wch: 14 }, // Kode Barang
        { wch: 18 }, // Kategori Produk
        { wch: 45 }, // Nama Barang / Deskripsi
        { wch: 10 }, // Qty
        { wch: 10 }, // UOM
        { wch: 20 }, // LOT / Batch Number
        { wch: 18 }, // Total Harga Barang
        { wch: 35 }, // Pelanggan
        { wch: 14 }, // Order Date
        { wch: 16 }, // Jenis Transaksi
        { wch: 10 }, // Kategori
        { wch: 18 }, // Status Cetak
      ];
      XLSX.utils.book_append_sheet(workbook, wsDetail, "Detail Barang");
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    XLSX.writeFile(workbook, `Rekap_Faktur_Lengkap_${dateStr}.xlsx`);
  }, [grouped, records, printedInvoices, printedAtMap]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              FT
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Faktur Tracker</h1>
              <p className="text-xs text-gray-500">Tracking faktur dari Oracle export</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelpModal(true)}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 flex items-center justify-center text-sm shadow-xs transition-all hover:scale-105"
              title="Panduan & Pintasan Keyboard"
            >
              ⌨️
            </button>
            <button
              onClick={handleManualRefresh}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              title="Refresh dan perbarui data dari database cloud"
            >
              <span>🔄</span>
              <span>Refresh Data</span>
              {sessionPrintedKeys.size > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 bg-blue-600 text-white text-[10px] font-bold rounded-full">
                  {sessionPrintedKeys.size}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowApotekModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              title="Buka Database Master Apotek (1P, 2P, 3P)"
            >
              <span>🏪</span>
              <span>Master Apotek</span>
            </button>
            <button
              onClick={() => setShowProductModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-300 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              title="Buka Database Master Produk (Farma, Alkes, CCP, Prekursor, OOT)"
            >
              <span>📦</span>
              <span>Master Produk</span>
            </button>
            {records.length > 0 && (
              <button
                onClick={exportToExcel}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 rounded-lg shadow-sm transition-colors"
                title="Ekspor rekap faktur ascending (terkecil ke terbesar) ke Excel"
              >
                <span>📥</span>
                <span>Ekspor Excel (Ascending)</span>
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200"
              >
                Hapus Semua Data
              </button>
            )}
          </div>
        </div>
      </header>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="max-w-7xl mx-auto px-4 py-4"
      >
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Upload Notification Banner (Slim & Compact) */}
        {uploadNotification && (
          <div className="mb-3 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-1.5 shadow-2xs flex items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="font-bold text-emerald-950 flex items-center gap-1">
                <span>✓</span> Upload Sukses: {uploadNotification.fileName}
              </span>
              <span className="text-[11px] font-mono text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                {uploadNotification.time}
              </span>
              <span className="text-gray-600">
                ({uploadNotification.totalInvoices.toLocaleString("id-ID")} faktur · {uploadNotification.totalItems.toLocaleString("id-ID")} baris)
              </span>
              {uploadNotification.maxDoo !== "-" && (
                <span className="font-medium bg-emerald-100/90 text-emerald-950 px-1.5 py-0.2 rounded font-mono text-[11px]">
                  🏬 DOO: {uploadNotification.prevDoo && uploadNotification.prevDoo !== uploadNotification.maxDoo ? `${uploadNotification.prevDoo}➔${uploadNotification.maxDoo}` : `#${uploadNotification.maxDoo}`}
                </span>
              )}
              {uploadNotification.maxOra !== "-" && (
                <span className="font-medium bg-blue-100/90 text-blue-950 px-1.5 py-0.2 rounded font-mono text-[11px]">
                  🏢 ORA: {uploadNotification.prevOra && uploadNotification.prevOra !== uploadNotification.maxOra ? `${uploadNotification.prevOra}➔${uploadNotification.maxOra}` : `#${uploadNotification.maxOra}`}
                </span>
              )}
              {uploadNotification.newUnprinted > 0 ? (
                <span className="font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded text-[11px]">
                  🚨 {uploadNotification.newUnprinted} Belum Print
                </span>
              ) : (
                <span className="text-emerald-700 font-semibold text-[11px]">
                  ✅ Semua Terprint
                </span>
              )}
            </div>
            <button
              onClick={() => setUploadNotification(null)}
              className="text-gray-400 hover:text-gray-700 font-bold px-1.5 py-0.5 rounded hover:bg-emerald-100 text-xs transition-colors"
              title="Tutup notifikasi"
            >
              ✕
            </button>
          </div>
        )}

        {/* Empty state when no data loaded */}
        {records.length === 0 && (
          <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-12 text-center my-6 shadow-xs">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-3">
              📊
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-1">Belum Ada Data Faktur</h3>
            <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
              Silakan upload file Excel export dari Oracle (.xlsx / .xls) untuk tracking faktur dan sinkronisasi otomatis antar perangkat.
            </p>
            <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl cursor-pointer text-sm font-semibold shadow transition-colors">
              <span>📁</span>
              <span>Upload File Excel</span>
              <input type="file" accept=".xlsx,.xls" onChange={onFileInput} className="hidden" />
            </label>
            {loading && <p className="text-xs text-gray-500 mt-3 animate-pulse">Membaca file...</p>}
          </div>
        )}

        {/* Data loaded */}
        {records.length > 0 && (
          <>
            {/* Summary & Category Cards: 2 Rows x 4 Columns (Compact & Sleek) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2.5">
              {/* Row 1, Col 1: Total SO */}
              <div className="bg-white rounded-md border border-gray-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 truncate">Total SO</p>
                <p className="text-sm font-bold font-mono text-gray-900 truncate leading-tight">{summary.totalSO.toLocaleString("id-ID")}</p>
              </div>

              {/* Row 1, Col 2: Belum Terprint */}
              <div className="bg-white rounded-md border border-orange-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-orange-600 truncate">Belum Terprint</p>
                  {summary.belumTerprint > 0 && (
                    <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-orange-100 text-orange-800">
                      🚨 Pending
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold font-mono text-orange-600 truncate leading-tight">{summary.belumTerprint.toLocaleString("id-ID")}</p>
              </div>

              {/* Row 1, Col 3: 1P ORA */}
              <div className="bg-white rounded-md border border-blue-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold text-blue-800 uppercase flex items-center gap-0.5 truncate">
                      <span>🏢</span> 1P ORA
                    </span>
                    {highestInvoices.max1POra.invoiceNumber !== "-" && (
                      <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${
                        highestInvoices.max1POra.isPrinted ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
                      }`}>
                        {highestInvoices.max1POra.isPrinted ? "✓" : "○"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold font-mono text-blue-950 truncate leading-tight">
                    {highestInvoices.max1POra.invoiceNumber !== "-" ? `#${highestInvoices.max1POra.invoiceNumber}` : "-"}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-1 text-[8.5px] font-mono mt-0.5 pt-0.5 border-t border-blue-50">
                  {invoiceProgression?.rangeOra ? (
                    <span className="text-blue-700 font-bold bg-blue-50 border border-blue-200 px-1 py-0.2 rounded text-[8px] truncate" title={`Rentang Upload: ${invoiceProgression.rangeOra}`}>
                      {invoiceProgression.rangeOra}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                  <span className="text-gray-500 text-[8px] truncate">📅 {highestInvoices.max1POra.orderDate || "-"}</span>
                </div>
              </div>

              {/* Row 1, Col 4: 2P */}
              <div className="bg-white rounded-md border border-emerald-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold text-emerald-800 uppercase flex items-center gap-0.5 truncate">
                      <span>🏪</span> 2P
                    </span>
                    {highestInvoices.max2P.invoiceNumber !== "-" && (
                      <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${
                        highestInvoices.max2P.isPrinted ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
                      }`}>
                        {highestInvoices.max2P.isPrinted ? "✓" : "○"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold font-mono text-emerald-950 truncate leading-tight">
                    {highestInvoices.max2P.invoiceNumber !== "-" ? `#${highestInvoices.max2P.invoiceNumber}` : "-"}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-1 text-[8.5px] font-mono mt-0.5 pt-0.5 border-t border-emerald-50">
                  {invoiceProgression?.range2P ? (
                    <span className="text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded text-[8px] truncate" title={`Rentang Upload: ${invoiceProgression.range2P}`}>
                      {invoiceProgression.range2P}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                  <span className="text-gray-500 text-[8px] truncate">📅 {highestInvoices.max2P.orderDate || "-"}</span>
                </div>
              </div>

              {/* Row 2, Col 1: Total Invoice */}
              <div className="bg-white rounded-md border border-gray-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 truncate">Total Invoice</p>
                <p className="text-sm font-bold font-mono text-gray-900 truncate leading-tight">{summary.totalInvoices.toLocaleString("id-ID")}</p>
              </div>

              {/* Row 2, Col 2: Double INV */}
              <div className="bg-white rounded-md border border-red-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-600 truncate">Double INV</p>
                  {summary.doubleInv > 0 && (
                    <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-red-100 text-red-800">
                      ⚠️ Cek
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold font-mono text-red-600 truncate leading-tight">{summary.doubleInv.toLocaleString("id-ID")}</p>
              </div>

              {/* Row 2, Col 3: 1P DOO */}
              <div className="bg-white rounded-md border border-teal-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold text-teal-800 uppercase flex items-center gap-0.5 truncate">
                      <span>🏬</span> 1P DOO
                    </span>
                    {highestInvoices.max1PDoo.invoiceNumber !== "-" && (
                      <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${
                        highestInvoices.max1PDoo.isPrinted ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
                      }`}>
                        {highestInvoices.max1PDoo.isPrinted ? "✓" : "○"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold font-mono text-teal-950 truncate leading-tight">
                    {highestInvoices.max1PDoo.invoiceNumber !== "-" ? `#${highestInvoices.max1PDoo.invoiceNumber}` : "-"}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-1 text-[8.5px] font-mono mt-0.5 pt-0.5 border-t border-teal-50">
                  {invoiceProgression?.rangeDoo || invoiceProgression?.range1P ? (
                    <span className="text-teal-700 font-bold bg-teal-50 border border-teal-200 px-1 py-0.2 rounded text-[8px] truncate" title={`Rentang Upload: ${invoiceProgression?.rangeDoo || invoiceProgression?.range1P}`}>
                      {invoiceProgression?.rangeDoo || invoiceProgression?.range1P}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                  <span className="text-gray-500 text-[8px] truncate">📅 {highestInvoices.max1PDoo.orderDate || "-"}</span>
                </div>
              </div>

              {/* Row 2, Col 4: 3P */}
              <div className="bg-white rounded-md border border-purple-200 px-2 py-1 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold text-purple-800 uppercase flex items-center gap-0.5 truncate">
                      <span>🏢</span> 3P
                    </span>
                    {highestInvoices.max3P.invoiceNumber !== "-" && (
                      <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${
                        highestInvoices.max3P.isPrinted ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
                      }`}>
                        {highestInvoices.max3P.isPrinted ? "✓" : "○"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold font-mono text-purple-950 truncate leading-tight">
                    {highestInvoices.max3P.invoiceNumber !== "-" ? `#${highestInvoices.max3P.invoiceNumber}` : "-"}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-1 text-[8.5px] font-mono mt-0.5 pt-0.5 border-t border-purple-50">
                  {invoiceProgression?.range3P ? (
                    <span className="text-purple-700 font-bold bg-purple-50 border border-purple-200 px-1 py-0.2 rounded text-[8px] truncate" title={`Rentang Upload: ${invoiceProgression.range3P}`}>
                      {invoiceProgression.range3P}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                  <span className="text-gray-500 text-[8px] truncate">📅 {highestInvoices.max3P.orderDate || "-"}</span>
                </div>
              </div>
            </div>

            {/* Filters & Sorting Toolbar */}
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 mb-4 space-y-2 shadow-xs">
              {/* Row 1: All Filters & Sorting in 1 strict line */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 select-none">
                <button
                  onClick={handleManualRefresh}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md border border-blue-400 bg-blue-50 text-blue-800 hover:bg-blue-100 flex items-center gap-1 whitespace-nowrap shadow-2xs transition-colors shrink-0"
                  title="Refresh dan perbarui data dari database cloud"
                >
                  <span>🔄</span>
                  <span>Refresh</span>
                  {sessionPrintedKeys.size > 0 && (
                    <span className="px-1.5 py-0.2 bg-blue-600 text-white text-[10px] font-bold rounded-full">
                      {sessionPrintedKeys.size}
                    </span>
                  )}
                </button>
                <div className="h-5 w-px bg-gray-200 mx-0.5 shrink-0" />
                
                {/* Tab Status */}
                <div className="flex gap-1 shrink-0">
                  <FBtn active={filter === "belum"} onClick={() => setFilter("belum")} color="orange">Belum Terprint</FBtn>
                  <FBtn active={filter === "sudah"} onClick={() => setFilter("sudah")} color="green">Sudah Terprint</FBtn>
                  <FBtn active={filter === "all"} onClick={() => setFilter("all")}>Semua</FBtn>
                  <FBtn active={filter === "double"} onClick={() => setFilter("double")} color="red">Double INV</FBtn>
                </div>
                <div className="h-5 w-px bg-gray-200 mx-0.5 shrink-0" />

                {/* Tandai Semua Selesai Button */}
                {unprintedCountInFiltered > 0 && (
                  <>
                    <button
                      onClick={handleMarkAllPrinted}
                      className="px-2.5 py-1 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-2xs transition-all shrink-0 active:scale-95 animate-pulse hover:animate-none"
                      title={`Tandai ${unprintedCountInFiltered} faktur yang belum selesai di tampilan ini sebagai SUDAH TERPRINT`}
                    >
                      <span>✓✓</span>
                      <span>Tandai Semua Selesai ({unprintedCountInFiltered})</span>
                    </button>
                    <div className="h-5 w-px bg-gray-200 mx-0.5 shrink-0" />
                  </>
                )}

                {/* Kategori */}
                <div className="flex gap-1 shrink-0">
                  <FBtn active={katFilter === "all"} onClick={() => setKatFilter("all")}>All Kat</FBtn>
                  <FBtn active={katFilter === "1P"} onClick={() => setKatFilter("1P")} color="blue">1P</FBtn>
                  <FBtn active={katFilter === "2P"} onClick={() => setKatFilter("2P")} color="green">2P</FBtn>
                  <FBtn active={katFilter === "3P"} onClick={() => setKatFilter("3P")} color="purple">3P</FBtn>
                </div>
                <div className="h-5 w-px bg-gray-200 mx-0.5 shrink-0" />

                {/* Jenis Transaksi */}
                <div className="flex gap-1 shrink-0">
                  <FBtn active={jenisFilter === "all"} onClick={() => setJenisFilter("all")}>All Jenis</FBtn>
                  <FBtn active={jenisFilter === "ORA"} onClick={() => setJenisFilter("ORA")} color="blue">ORA</FBtn>
                  <FBtn active={jenisFilter === "DOO"} onClick={() => setJenisFilter("DOO")} color="emerald">DOO</FBtn>
                </div>
                <div className="h-5 w-px bg-gray-200 mx-0.5 shrink-0" />

                {/* Kategori Produk & Regulasi */}
                <div className="flex gap-1 shrink-0">
                  <FBtn active={klasFilter === "all"} onClick={() => setKlasFilter("all")}>All Produk</FBtn>
                  <FBtn active={klasFilter === "prekursor"} onClick={() => setKlasFilter((prev) => (prev === "prekursor" ? "all" : "prekursor"))} color="amber">💊 Prekursor</FBtn>
                  <FBtn active={klasFilter === "oot"} onClick={() => setKlasFilter((prev) => (prev === "oot" ? "all" : "oot"))} color="purple">🧪 OOT</FBtn>
                  <FBtn active={klasFilter === "ccp"} onClick={() => setKlasFilter((prev) => (prev === "ccp" ? "all" : "ccp"))} color="sky">❄️ CCP</FBtn>
                  <FBtn active={klasFilter === "alkes"} onClick={() => setKlasFilter((prev) => (prev === "alkes" ? "all" : "alkes"))} color="teal">🩺 Alkes</FBtn>
                  <FBtn active={klasFilter === "farma"} onClick={() => setKlasFilter((prev) => (prev === "farma" ? "all" : "farma"))} color="indigo">💊 Farma</FBtn>
                </div>
                <div className="h-5 w-px bg-gray-200 mx-0.5 shrink-0" />

                {/* Filter Tanggal */}
                {availableDates.length > 0 && (
                  <div className="flex items-center shrink-0">
                    <select
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="px-2 py-1 text-xs font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
                      title="Filter berdasarkan tanggal order tertentu"
                    >
                      <option value="all">📅 Semua Tanggal ({availableDates.length})</option>
                      {availableDates.map((d) => (
                        <option key={d} value={d}>
                          📅 {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Pengurutan (Sorting) - Sebelah Semua Tanggal */}
                <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-md border border-gray-300 shadow-2xs shrink-0">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "invoice" | "date" | "totalHarga")}
                    className="bg-transparent text-xs font-semibold text-gray-800 px-1 py-0.5 focus:outline-none cursor-pointer"
                    title="Pilih kolom yang ingin diurutkan"
                  >
                    <option value="invoice">🔢 No Faktur</option>
                    <option value="date">📅 Tanggal Order</option>
                    <option value="totalHarga">💰 Total Harga</option>
                  </select>
                  <button
                    onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
                    className="px-1.5 py-0.5 text-xs font-bold rounded bg-white hover:bg-gray-50 text-blue-700 border border-gray-300 flex items-center gap-0.5 shadow-2xs transition-colors"
                    title="Klik untuk mengubah arah urutan (Ascending / Descending)"
                  >
                    {sortOrder === "desc" ? "⬇ Terbesar" : "⬆ Terkecil"}
                  </button>
                </div>
              </div>

              {/* Row 2: Long Search Bar & Upload Excel Button */}
              <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                <div className="flex-1 flex items-center">
                  <div className="relative w-full">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 text-xs">
                      🔍
                    </span>
                    <input
                      type="text"
                      placeholder="Cari nomor SO, no Invoice, nama Apotek / Pelanggan, item obat..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-2xs"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-gray-600 font-bold text-xs"
                        title="Hapus pencarian"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <label className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg cursor-pointer text-xs font-semibold whitespace-nowrap shadow-sm flex items-center gap-1.5 transition-colors">
                  <span>📁</span>
                  <span>Upload Excel</span>
                  <input type="file" accept=".xlsx,.xls" onChange={onFileInput} className="hidden" />
                </label>
                {loading && <span className="text-xs text-gray-500 animate-pulse whitespace-nowrap">Membaca...</span>}
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              {/* Top Pagination & Summary Header */}
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                    Hal {page + 1} / {totalPages || 1}
                  </span>
                  <p className="text-xs text-gray-600 font-medium">
                    {filtered.length.toLocaleString("id-ID")} SO · {summary.totalInvoices.toLocaleString("id-ID")} invoice
                  </p>
                  {unprintedCountInFiltered > 0 && (
                    <button
                      onClick={handleMarkAllPrinted}
                      className="ml-1.5 px-2.5 py-1 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-xs transition-all active:scale-95"
                      title={`Tandai ${unprintedCountInFiltered} faktur yang belum selesai sebagai SUDAH TERPRINT`}
                    >
                      <span>✓✓</span>
                      <span>Tandai Semua Selesai ({unprintedCountInFiltered})</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-100 transition-colors shadow-sm"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs font-semibold text-gray-700 px-1">
                    {page + 1} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-100 transition-colors shadow-sm"
                  >
                    Next →
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm select-text">
                  <thead className="bg-gray-50 border-b border-gray-200 select-none">
                    <tr>
                      <th className="px-2 py-2 w-8 text-center text-xs font-medium text-gray-500">#</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Print</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">No SO</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">No Invoice</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Kat Produk</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Jenis Transaksi</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Pelanggan</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Order Date</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Kat</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Done Print (Waktu)</th>
                      <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">Total Harga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageData.map((g, rowIdx) => {
                      const expanded = expandedInvoices.has(g.key);
                      const hasInvoice = !!g.invoiceNumber && g.invoiceNumber !== "0" && g.invoiceNumber !== "-";
                      const isRowSelected = selectedRowIndex === rowIdx;

                      const getCellCls = (colIdx: number) => {
                        if (isRowSelected && selectedColIdx === colIdx) {
                          return "ring-2 ring-blue-600 ring-inset bg-blue-100/90 font-semibold relative z-10";
                        }
                        return "";
                      };

                      return (
                        <Fragment key={g.key}>
                          <tr
                            id={`faktur-row-${rowIdx}`}
                            onClick={() => setSelectedRowIndex(rowIdx)}
                            onDoubleClick={() => toggleExpand(g.key)}
                            className={`cursor-pointer transition-colors ${
                              isRowSelected
                                ? "bg-blue-50/70 border-l-4 border-l-blue-600 shadow-sm"
                                : g.isDoubleInv
                                ? "bg-red-50 hover:bg-red-100/70"
                                : g.allPrinted
                                ? "bg-green-50/50 hover:bg-green-100/50"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            {/* Col 0: Expand */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(0);
                                toggleExpand(g.key);
                              }}
                              className={`px-2 py-2 text-center text-gray-400 text-xs ${getCellCls(0)}`}
                              title="Klik atau tekan Enter untuk buka rincian"
                            >
                              {expanded ? "▼" : "▶"}
                            </td>

                            {/* Col 1: Print Status */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(1);
                              }}
                              className={`px-2 py-2 ${getCellCls(1)}`}
                            >
                              <button
                                type="button"
                                tabIndex={-1}
                                onKeyDown={(e) => {
                                  if (e.key === " " || e.code === "Space") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePrint(g);
                                }}
                                disabled={!hasInvoice}
                                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all shadow-sm ${
                                   !hasInvoice
                                    ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                                    : g.allPrinted
                                    ? "bg-green-500 text-white hover:bg-orange-500 hover:rotate-180"
                                    : g.anyPrinted
                                    ? "bg-yellow-400 text-white hover:bg-yellow-500"
                                    : "bg-gray-200 text-gray-600 hover:bg-green-500 hover:text-white"
                                }`}
                                title={
                                  !hasInvoice
                                    ? "Menunggu No Faktur (Belum bisa diprint)"
                                    : g.allPrinted
                                    ? "Sudah Terprint · Klik untuk UNPRINT (Batal Cetak)"
                                    : g.anyPrinted
                                    ? "Sebagian terprint · Klik untuk tandai"
                                    : "Belum terprint · Klik atau tekan Space untuk SUDAH PRINT"
                                }
                              >
                                {!hasInvoice ? "–" : g.allPrinted ? "✓" : g.anyPrinted ? "◑" : "○"}
                              </button>
                            </td>

                            {/* Col 2: No SO */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(2);
                              }}
                              className={`px-2 py-2 font-mono text-xs text-gray-900 whitespace-nowrap ${getCellCls(2)}`}
                            >
                              <div className="flex items-center gap-1">
                                <span>{g.so}</span>
                                {g.isDoubleInv && <span className="text-red-600 font-bold" title="SO ini memiliki lebih dari 1 faktur">⚠</span>}
                              </div>
                              {g.totalHarga < 0 && (
                                <div className="mt-0.5">
                                  <span className="inline-block text-[9px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-1 py-0.2 rounded leading-none">
                                    Memo Retur
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* Col 3: No Invoice */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(3);
                              }}
                              className={`px-2 py-2 font-mono text-xs text-gray-900 whitespace-nowrap font-medium ${getCellCls(3)}`}
                            >
                              {hasInvoice ? (
                                g.invoiceNumber
                              ) : (
                                <span className="text-gray-400 italic text-xs">Menunggu Faktur</span>
                              )}
                            </td>

                            {/* Col 4: Kat Produk (Dominant Category) */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(4);
                              }}
                              className={`px-2 py-2 whitespace-nowrap ${getCellCls(4)}`}
                            >
                              <div className="flex flex-wrap gap-1 items-center">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border shadow-2xs ${
                                    g.kategoriProduk === "ALKES"
                                      ? "bg-teal-100 text-teal-800 border-teal-300"
                                      : g.kategoriProduk === "CCP"
                                      ? "bg-sky-100 text-sky-900 border-sky-300"
                                      : g.kategoriProduk === "PREKURSOR"
                                      ? "bg-amber-100 text-amber-900 border-amber-300"
                                      : g.kategoriProduk === "OOT"
                                      ? "bg-purple-100 text-purple-900 border-purple-300"
                                      : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                  }`}
                                >
                                  {g.kategoriProduk === "CCP" ? "❄️ CCP" : g.kategoriProduk}
                                </span>
                                {g.hasPrekursor && g.kategoriProduk !== "PREKURSOR" && (
                                  <span className="inline-block px-1 py-0.2 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-300" title="Mengandung item Prekursor">
                                    💊 Prekursor
                                  </span>
                                )}
                                {g.hasOOT && g.kategoriProduk !== "OOT" && (
                                  <span className="inline-block px-1 py-0.2 rounded text-[9px] font-bold bg-purple-50 text-purple-800 border border-purple-300" title="Mengandung item OOT">
                                    🧪 OOT
                                  </span>
                                )}
                                {g.hasCCP && g.kategoriProduk !== "CCP" && (
                                  <span className="inline-block px-1 py-0.2 rounded text-[9px] font-bold bg-sky-50 text-sky-800 border border-sky-300" title="Mengandung item CCP (Cold Chain)">
                                    ❄️ CCP
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Col 5: Jenis Transaksi */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(5);
                              }}
                              className={`px-2 py-2 whitespace-nowrap ${getCellCls(5)}`}
                            >
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                                g.jenisTransaksi === "ORA"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}>
                                {g.jenisTransaksi}
                              </span>
                            </td>

                            {/* Col 6: Pelanggan */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(6);
                              }}
                              className={`px-2 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate ${getCellCls(6)}`}
                            >
                              {g.customerName}
                            </td>

                            {/* Col 7: Order Date */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(7);
                              }}
                              className={`px-2 py-2 text-gray-600 whitespace-nowrap text-xs ${getCellCls(7)}`}
                            >
                              {g.orderDate}
                            </td>

                            {/* Col 8: Kategori */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(8);
                              }}
                              className={`px-2 py-2 ${getCellCls(8)}`}
                            >
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                g.kategori === "1P" ? "bg-blue-100 text-blue-700"
                                : g.kategori === "2P" ? "bg-green-100 text-green-700"
                                : "bg-purple-100 text-purple-700"
                              }`}>
                                {g.kategori}
                              </span>
                            </td>

                            {/* Col 9: Done Print Time */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(9);
                              }}
                              className={`px-2 py-2 whitespace-nowrap ${getCellCls(9)}`}
                            >
                              {g.allPrinted && g.printedAt ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200" title={`Selesai diprint pada: ${formatPrintTime(g.printedAt)}`}>
                                  <span className="text-emerald-600 font-bold">⏱</span>
                                  {formatPrintTime(g.printedAt)}
                                </span>
                              ) : g.anyPrinted ? (
                                <span className="text-xs text-yellow-600 italic">Sebagian</span>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>

                            {/* Col 10: Total Harga */}
                            <td
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowIndex(rowIdx);
                                setSelectedColIdx(10);
                              }}
                              className={`px-2 py-2 text-right text-gray-900 whitespace-nowrap font-medium text-xs ${getCellCls(10)}`}
                            >
                              {formatRupiah(g.totalHarga)}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="bg-gray-50">
                              <td colSpan={11} className="px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between pb-2 mb-2 border-b border-gray-200 gap-2">
                                  <div className="text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Invoice: <span className="font-mono text-blue-700 font-bold">{g.invoiceNumber}</span></span> · SO: <span className="font-semibold text-gray-900">{g.so}</span> {g.totalHarga < 0 && <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.2 rounded">Memo Retur</span>} · Pelanggan: <span className="font-semibold text-gray-900">{g.customerName}</span>
                                    <span className="ml-2 inline-flex items-center gap-1">
                                      <span className="font-medium text-gray-500">Kat Dominan:</span>
                                      <span
                                        className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                          g.kategoriProduk === "ALKES"
                                            ? "bg-teal-100 text-teal-800 border-teal-300"
                                            : g.kategoriProduk === "PREKURSOR"
                                            ? "bg-amber-100 text-amber-900 border-amber-300"
                                            : g.kategoriProduk === "OOT"
                                            ? "bg-purple-100 text-purple-900 border-purple-300"
                                            : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                        }`}
                                      >
                                        {g.kategoriProduk}
                                      </span>
                                    </span>
                                    {g.allPrinted && g.printedAt && (
                                      <span className="ml-2 inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                        <span>⏱ Selesai Print:</span>
                                        <span className="font-mono font-bold text-emerald-900">{formatPrintTime(g.printedAt)}</span>
                                      </span>
                                    )}
                                  </div>
                                  <div>
                                    {g.allPrinted ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); togglePrint(g); }}
                                        className="px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded-lg text-xs font-bold hover:bg-orange-200 transition-colors flex items-center gap-1.5 shadow-sm"
                                      >
                                        <span>↩</span> Unprint Faktur Ini
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); togglePrint(g); }}
                                        className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-colors flex items-center gap-1.5 shadow-sm"
                                      >
                                        <span>✓</span> Tandai Sudah Terprint
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-200">
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">No Invoice</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Item Code</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Kat Produk</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Item Description</th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">Qty</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">UOM</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">LOT Number</th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">Total Harga</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {g.items.map((item, i) => (
                                      <tr key={i} className="hover:bg-gray-100">
                                        <td className="px-2 py-1 font-mono text-gray-900 whitespace-nowrap">{item.invoiceNumber}</td>
                                        <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{item.itemCode}</td>
                                        <td className="px-2 py-1 whitespace-nowrap">
                                          {(() => {
                                            const itemCat = (item.kategoriProduk || getProductCategory(item.itemCode, item.itemDescription) || "FARMA").toUpperCase();
                                            return (
                                              <span
                                                className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                                  itemCat === "ALKES"
                                                    ? "bg-teal-100 text-teal-800 border-teal-300"
                                                    : itemCat === "CCP"
                                                    ? "bg-sky-100 text-sky-900 border-sky-300"
                                                    : itemCat === "PREKURSOR"
                                                    ? "bg-amber-100 text-amber-900 border-amber-300"
                                                    : itemCat === "OOT"
                                                    ? "bg-purple-100 text-purple-900 border-purple-300"
                                                    : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                                }`}
                                              >
                                                {itemCat === "CCP" ? "❄️ CCP" : itemCat}
                                              </span>
                                            );
                                          })()}
                                        </td>
                                        <td className="px-2 py-1 text-gray-700">{item.itemDescription}</td>
                                        <td className="px-2 py-1 text-right text-gray-900">{item.qty}</td>
                                        <td className="px-2 py-1 text-gray-600">{item.uom}</td>
                                        <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{item.lotNumber}</td>
                                        <td className="px-2 py-1 text-right text-gray-900 whitespace-nowrap">{formatRupiah(item.totalHarga)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {filtered.length.toLocaleString("id-ID")} SO · {summary.totalInvoices.toLocaleString("id-ID")} invoice
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50">←</button>
                  <span className="text-sm text-gray-600">{page + 1} / {totalPages || 1}</span>
                  <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50">→</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Floating Copy Toast */}
      {copyToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900/95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-2xl border border-slate-700 flex items-center gap-2 animate-bounce">
          <span>📋</span>
          <span>{copyToast}</span>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      <HelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />

      {/* Master Apotek Modal */}
      <MasterApotekModal isOpen={showApotekModal} onClose={() => setShowApotekModal(false)} />

      {/* Master Product Modal */}
      <MasterProductModal isOpen={showProductModal} onClose={() => setShowProductModal(false)} />
    </main>
  );
}

function HelpModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-lg"
          title="Tutup"
        >
          ✕
        </button>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xl shadow-xs">
            ⌨️
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Cara Penggunaan & Pintasan Keyboard</h2>
            <p className="text-xs text-gray-500">Navigasi cepat ala spreadsheet tanpa perlu mouse</p>
          </div>
        </div>

        <div className="space-y-2.5 text-xs">
          <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between pr-2 border-r border-gray-200">
              <span className="text-gray-700">Pindah Baris</span>
              <div className="flex gap-1">
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">↑</kbd>
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">↓</kbd>
              </div>
            </div>
            <div className="flex items-center justify-between pl-1">
              <span className="text-gray-700">Pindah Kolom/Sel</span>
              <div className="flex gap-1">
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">←</kbd>
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">→</kbd>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between pr-2 border-r border-gray-200">
              <span className="text-gray-700">Cetak (Centang)</span>
              <kbd className="px-2 py-0.5 bg-amber-500 text-white rounded border border-amber-600 text-[11px] font-mono font-bold shadow-2xs">Space</kbd>
            </div>
            <div className="flex items-center justify-between pl-1">
              <span className="text-gray-700">Salin Data Sel</span>
              <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">Ctrl+C</kbd>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between pr-2 border-r border-gray-200">
              <span className="text-gray-700">Buka Detail Item</span>
              <kbd className="px-2 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">Enter</kbd>
            </div>
            <div className="flex items-center justify-between pl-1">
              <span className="text-gray-700">Pindah Halaman</span>
              <div className="flex gap-1">
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">PgUp</kbd>
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-300 text-[11px] font-mono font-bold shadow-2xs">PgDn</kbd>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900 mt-3">
            <p className="font-bold mb-1 flex items-center gap-1">
              <span>💡</span> Tips Singkronisasi Multi-Device:
            </p>
            <p className="text-[11px] text-blue-800 leading-relaxed">
              Data faktur, status centang cetak, dan rentang faktur terbaru otomatis tersinkronisasi realtime ke semua perangkat melalui Supabase Cloud.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-xl shadow transition-colors"
          >
            Mengerti & Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

function MasterApotekModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [katFilter, setKatFilter] = useState<"all" | "1P" | "2P" | "3P">("all");
  const [page, setPage] = useState(0);
  const rowsPerPage = 30;

  const filtered = useMemo(() => {
    let list = masterApotekList as Array<{
      namaApotek: string;
      kodeCustomer: string;
      namaMerchant: string;
      kategori: string;
      keterangan: string;
    }>;

    if (katFilter !== "all") {
      list = list.filter((a) => a.kategori === katFilter);
    }

    if (search.trim()) {
      const s = search.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.namaApotek.toLowerCase().includes(s) ||
          a.kodeCustomer.toLowerCase().includes(s) ||
          a.namaMerchant.toLowerCase().includes(s) ||
          a.keterangan.toLowerCase().includes(s)
      );
    }

    return list;
  }, [search, katFilter]);

  const totalPages = Math.ceil(filtered.length / rowsPerPage);
  const pagedData = useMemo(() => {
    const start = page * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-gray-100 relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xl shadow-xs">
              🏪
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Database Master Apotek & Pelanggan</h2>
              <p className="text-xs text-gray-500">
                Total {masterApotekList.length.toLocaleString("id-ID")} apotek terdaftar (Acuan Klasifikasi 1P / 2P / 3P)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-lg"
            title="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="py-3 flex flex-wrap items-center justify-between gap-2 shrink-0 border-b border-gray-100">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <FBtn active={katFilter === "all"} onClick={() => { setKatFilter("all"); setPage(0); }}>
              Semua ({masterApotekList.length})
            </FBtn>
            <FBtn active={katFilter === "1P"} onClick={() => { setKatFilter("1P"); setPage(0); }} color="blue">
              🏪 1P Prioritas 1 (45)
            </FBtn>
            <FBtn active={katFilter === "2P"} onClick={() => { setKatFilter("2P"); setPage(0); }} color="green">
              🏪 2P Mitra Merchant (252)
            </FBtn>
            <FBtn active={katFilter === "3P"} onClick={() => { setKatFilter("3P"); setPage(0); }} color="purple">
              🏢 3P Reguler (2.400)
            </FBtn>
          </div>

          <div className="relative w-72">
            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400 text-xs">
              🔍
            </span>
            <input
              type="text"
              placeholder="Cari apotek, kode, merchant, zona..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full pl-7 pr-7 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white shadow-2xs"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setPage(0); }}
                className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600 font-bold text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-y-auto flex-1 my-2 border border-gray-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 select-none">
              <tr>
                <th className="px-2.5 py-2 text-center text-gray-500 w-10">#</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-24">Kategori</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-28">Kode Customer</th>
                <th className="px-2.5 py-2 text-left text-gray-500">Nama Apotek</th>
                <th className="px-2.5 py-2 text-left text-gray-500">Nama Merchant / Platform</th>
                <th className="px-2.5 py-2 text-left text-gray-500">Zona / Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    Tidak ditemukan apotek yang sesuai pencarian.
                  </td>
                </tr>
              ) : (
                pagedData.map((a, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-2.5 py-1.5 text-center text-gray-400 font-mono">
                      {page * rowsPerPage + idx + 1}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          a.kategori === "1P"
                            ? "bg-blue-100 text-blue-800"
                            : a.kategori === "2P"
                            ? "bg-green-100 text-green-800"
                            : "bg-purple-100 text-purple-800"
                        }`}
                      >
                        {a.kategori}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-gray-700 whitespace-nowrap">
                      {a.kodeCustomer !== "-" ? a.kodeCustomer : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-2.5 py-1.5 font-medium text-gray-900">{a.namaApotek}</td>
                    <td className="px-2.5 py-1.5 text-gray-600 font-mono text-[11px]">{a.namaMerchant}</td>
                    <td className="px-2.5 py-1.5 text-gray-500">{a.keterangan}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <div className="pt-3 border-t border-gray-200 flex items-center justify-between text-xs shrink-0">
          <span className="text-gray-500">
            Menampilkan {filtered.length.toLocaleString("id-ID")} apotek · Halaman {page + 1} / {totalPages || 1}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-30 shadow-2xs"
            >
              ← Prev
            </button>
            <span className="font-semibold text-gray-700 px-1">
              {page + 1} / {totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-30 shadow-2xs"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MasterProductModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const rowsPerPage = 30;

  const filtered = useMemo(() => {
    let list = masterProductList as Array<{
      kodeBarang?: string;
      kodeOracle?: string | number;
      kodeAccurate?: string | number;
      namaBarang: string;
      kategori: string;
      klasifikasi?: string;
      kategoriWarehouse?: string;
    }>;

    if (catFilter !== "all") {
      list = list.filter((p) => p.kategori.toUpperCase() === catFilter.toUpperCase());
    }

    if (search.trim()) {
      const s = search.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.namaBarang.toLowerCase().includes(s) ||
          String(p.kodeOracle || "").toLowerCase().includes(s) ||
          String(p.kodeAccurate || "").toLowerCase().includes(s) ||
          String(p.kodeBarang || "").toLowerCase().includes(s) ||
          String(p.klasifikasi || "").toLowerCase().includes(s) ||
          String(p.kategoriWarehouse || "").toLowerCase().includes(s)
      );
    }

    return list;
  }, [search, catFilter]);

  const totalPages = Math.ceil(filtered.length / rowsPerPage);
  const pagedData = useMemo(() => {
    const start = page * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-5xl w-full p-6 shadow-2xl border border-gray-100 relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center text-xl shadow-xs">
              📦
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Database Master Produk & Obat</h2>
              <p className="text-xs text-gray-500">
                Total {masterProductList.length.toLocaleString("id-ID")} produk terdaftar (Acuan FARMA, ALKES, CCP, PREKURSOR, OOT)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-lg"
            title="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="py-3 flex flex-wrap items-center justify-between gap-2 shrink-0 border-b border-gray-100">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <FBtn active={catFilter === "all"} onClick={() => { setCatFilter("all"); setPage(0); }}>
              Semua ({masterProductList.length})
            </FBtn>
            <FBtn active={catFilter === "PREKURSOR"} onClick={() => { setCatFilter("PREKURSOR"); setPage(0); }} color="amber">
              💊 Prekursor (96)
            </FBtn>
            <FBtn active={catFilter === "OOT"} onClick={() => { setCatFilter("OOT"); setPage(0); }} color="purple">
              🧪 OOT (21)
            </FBtn>
            <FBtn active={catFilter === "CCP"} onClick={() => { setCatFilter("CCP"); setPage(0); }} color="sky">
              ❄️ CCP (70)
            </FBtn>
            <FBtn active={catFilter === "ALKES"} onClick={() => { setCatFilter("ALKES"); setPage(0); }} color="teal">
              🩺 Alkes (821)
            </FBtn>
            <FBtn active={catFilter === "FARMA"} onClick={() => { setCatFilter("FARMA"); setPage(0); }} color="indigo">
              💊 Farma (6.143)
            </FBtn>
          </div>

          <div className="relative w-72">
            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400 text-xs">
              🔍
            </span>
            <input
              type="text"
              placeholder="Cari obat, kode Oracle/Accurate..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full pl-7 pr-7 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white shadow-2xs"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setPage(0); }}
                className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600 font-bold text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-y-auto flex-1 my-2 border border-gray-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 select-none">
              <tr>
                <th className="px-2.5 py-2 text-center text-gray-500 w-10">#</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-28">Kategori</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-28">Kode Oracle</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-28">Kode Accurate</th>
                <th className="px-2.5 py-2 text-left text-gray-500">Nama Barang / Deskripsi</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-36">Klasifikasi</th>
                <th className="px-2.5 py-2 text-left text-gray-500 w-36">Warehouse Cat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    Tidak ditemukan produk yang sesuai pencarian.
                  </td>
                </tr>
              ) : (
                pagedData.map((p, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-2.5 py-1.5 text-center text-gray-400 font-mono">
                      {page * rowsPerPage + idx + 1}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                          p.kategori === "ALKES"
                            ? "bg-teal-100 text-teal-800 border-teal-300"
                            : p.kategori === "CCP"
                            ? "bg-sky-100 text-sky-900 border-sky-300"
                            : p.kategori === "PREKURSOR"
                            ? "bg-amber-100 text-amber-900 border-amber-300"
                            : p.kategori === "OOT"
                            ? "bg-purple-100 text-purple-900 border-purple-300"
                            : "bg-indigo-50 text-indigo-700 border-indigo-200"
                        }`}
                      >
                        {p.kategori === "CCP" ? "❄️ CCP" : p.kategori}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-gray-800 whitespace-nowrap">
                      {p.kodeOracle ? String(p.kodeOracle) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-gray-600 whitespace-nowrap">
                      {p.kodeAccurate ? String(p.kodeAccurate) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-2.5 py-1.5 font-medium text-gray-900">{p.namaBarang}</td>
                    <td className="px-2.5 py-1.5 text-gray-600">{p.klasifikasi || "-"}</td>
                    <td className="px-2.5 py-1.5 text-gray-500">{p.kategoriWarehouse || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <div className="pt-3 border-t border-gray-200 flex items-center justify-between text-xs shrink-0">
          <span className="text-gray-500">
            Menampilkan {filtered.length.toLocaleString("id-ID")} produk · Halaman {page + 1} / {totalPages || 1}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-30 shadow-2xs"
            >
              ← Prev
            </button>
            <span className="font-semibold text-gray-700 px-1">
              {page + 1} / {totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-30 shadow-2xs"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, color, small }: { label: string; value: string; color?: "orange" | "red"; small?: boolean }) {
  const colorClass = color === "orange" ? "text-orange-600" : color === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-2.5 shadow-2xs flex flex-col justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5 truncate">{label}</p>
      <p className={`${small ? "text-sm" : "text-base"} font-bold font-mono ${colorClass} truncate`}>{value}</p>
    </div>
  );
}

function FBtn({ active, onClick, children, color = "gray" }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  color?: "gray" | "orange" | "red" | "blue" | "green" | "purple" | "emerald" | "amber" | "sky" | "teal" | "indigo";
}) {
  const colors: Record<string, string> = {
    gray: active ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
    orange: active ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200",
    red: active ? "bg-red-500 text-white" : "bg-red-100 text-red-700 hover:bg-red-200",
    blue: active ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700 hover:bg-blue-200",
    green: active ? "bg-green-600 text-white" : "bg-green-100 text-green-700 hover:bg-green-200",
    purple: active ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700 hover:bg-purple-200",
    emerald: active ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
    amber: active ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-800 hover:bg-amber-200",
    sky: active ? "bg-sky-600 text-white" : "bg-sky-100 text-sky-800 hover:bg-sky-200",
    teal: active ? "bg-teal-600 text-white" : "bg-teal-100 text-teal-800 hover:bg-teal-200",
    indigo: active ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200",
  };
  return (
    <button onClick={onClick} className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shadow-2xs ${colors[color]}`}>
      {children}
    </button>
  );
}

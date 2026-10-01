"use client";

import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react";
import * as XLSX from "xlsx";
import {
  parseExcelFile,
  categorize,
  isOraCustomer,
  getProductCategory,
  getPrekursorOOTClassification,
  normalize,
} from "@/lib/parser";
import { FakturRecord, FirestoreFakturDoc, InvoiceProgression, FakturGroup } from "@/lib/types";
import {
  subscribeToFakturs,
  getExistingFakturs,
  saveFaktursBatch,
  updateFakturPrintStatus,
  updateFaktursPrintStatusBatch,
  updateFakturCategory,
  clearAllFakturs,
} from "@/lib/firestoreService";
import MasterApotekModal from "@/components/MasterApotekModal";
import MasterProductModal from "@/components/MasterProductModal";

type Filter = "belum" | "sudah" | "all" | "double";
type KatFilter = "all" | "1P" | "2P" | "3P";
type JenisFilter = "all" | "ORA" | "DOO";
type KlasFilter = "all" | "prekursor" | "oot" | "ccp" | "alkes" | "farma";

const ROWS_PER_PAGE = 50;

function parseInvNum(invs: string | string[]): number {
  if (!invs) return 0;
  const s = Array.isArray(invs) ? invs[0] : String(invs);
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseDateMs(dStr: string): number {
  if (!dStr || dStr === "-") return 0;
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

function dbRowsToFakturRecords(rows: Array<Record<string, unknown>>): {
  records: FakturRecord[];
  printedSet: Set<string>;
  printedAtMap: Record<string, string>;
} {
  const records: FakturRecord[] = [];
  const printedSet = new Set<string>();
  const printedAtMap: Record<string, string> = {};

  for (const r of rows) {
    const rawInv = String(r.no_faktur || "");
    const cleanInv = rawInv.replace(/-1P$/i, "");
    const extra = (r.extra as Record<string, unknown>) || {};
    const items = (extra.items as Array<Record<string, unknown>>) || [];
    const cust = String(extra.nama_pelanggan || r.customer_name || "");
    const date = String(extra.accounting_date || extra.order_date || r.order_date || "");
    const isOra = isOraCustomer(cust);
    const invKey = isOra ? `${cleanInv}-1P` : cleanInv;
    const cleanJenis: "DOO" | "ORA" = isOra ? "ORA" : "DOO";
    const kategori = (r.kategori as "1P" | "2P" | "3P") || categorize(cleanJenis, cust, cleanJenis);
    const pAt = (r.printed_at as string) || null;

    if (r.status_cetak) {
      printedSet.add(invKey);
      if (pAt) printedAtMap[invKey] = pAt;
    }

    if (items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemCode = String(it.item_code || "");
        const itemDesc = String(it.item_description || "");
        const katProd = getProductCategory(itemCode, itemDesc);
        const klasObat = getPrekursorOOTClassification(itemDesc, itemCode) || undefined;
        const validSO = String(it.order_number || r.no_sales_order || "-").trim();

        records.push({
          orderDate: date,
          orderNumber: validSO || "-",
          invoiceNumber: cleanInv,
          invoiceKey: invKey,
          jenisTransaksi: cleanJenis,
          customerName: cust,
          itemCode,
          itemDescription: itemDesc,
          qty: (it.qty as number | string) || 0,
          uom: String(it.uom || "-"),
          lotNumber: String(it.lot_number || "-"),
          totalHarga: typeof it.total_harga === "number" ? it.total_harga : parseFloat(String(it.total_harga || 0)) || 0,
          kategori,
          kategoriProduk: katProd,
          klasifikasiObat: klasObat,
          isDoubleInv: false,
          rowIndex: idx,
        });
      }
    } else {
      const docSO = String(r.no_sales_order || "-").trim();
      const docAmount = typeof extra.total_harga === "number" ? extra.total_harga : parseFloat(String(extra.total_harga || 0)) || 0;

      records.push({
        orderDate: date,
        orderNumber: docSO || "-",
        invoiceNumber: cleanInv,
        invoiceKey: invKey,
        jenisTransaksi: cleanJenis,
        customerName: cust,
        itemCode: "-",
        itemDescription: "-",
        qty: 1,
        uom: "-",
        lotNumber: "-",
        totalHarga: docAmount,
        kategori,
        isDoubleInv: false,
        rowIndex: 0,
      });
    }
  }

  // Detect double invoices
  const soInvMap: Record<string, Set<string>> = {};
  for (const rec of records) {
    if (rec.orderNumber && rec.orderNumber !== "-") {
      if (!soInvMap[rec.orderNumber]) soInvMap[rec.orderNumber] = new Set();
      if (rec.invoiceNumber && rec.invoiceNumber !== "-") {
        soInvMap[rec.orderNumber].add(rec.invoiceNumber);
      }
    }
  }
  for (const rec of records) {
    if (rec.orderNumber && rec.orderNumber !== "-" && (soInvMap[rec.orderNumber]?.size || 0) > 1) {
      rec.isDoubleInv = true;
    }
  }

  return { records, printedSet, printedAtMap };
}

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("belum");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [jenisFilter, setJenisFilter] = useState<JenisFilter>("all");
  const [klasFilter, setKlasFilter] = useState<KlasFilter>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [printedAtMap, setPrintedAtMap] = useState<Record<string, string>>({});
  const [invoiceProgression, setInvoiceProgression] = useState<InvoiceProgression | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showApotekModal, setShowApotekModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
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

  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [selectedColIdx, setSelectedColIdx] = useState(3); // Default to No Invoice column
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, "1P" | "2P" | "3P">>({});
  const categoryOverridesRef = useRef<Record<string, "1P" | "2P" | "3P">>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);

  useEffect(() => {
    categoryOverridesRef.current = categoryOverrides;
  }, [categoryOverrides]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleUpdateCategory = useCallback(
    async (invoiceKey: string, newKat: "1P" | "2P" | "3P", customerName?: string) => {
      const cleanInv = invoiceKey.replace(/-1P$/i, "");
      const cleanCust = (customerName || "").trim();
      const normCust = cleanCust ? normalize(cleanCust) : "";

      // 1. Optimistic instant local update for all records of this apotek/customer
      setRecords((prev) =>
        prev.map((r) => {
          const rCleanCust = (r.customerName || "").trim();
          const rNormCust = rCleanCust ? normalize(rCleanCust) : "";
          const isMatch =
            r.invoiceKey === invoiceKey ||
            r.invoiceNumber === cleanInv ||
            (normCust && rNormCust === normCust) ||
            (cleanCust && rCleanCust === cleanCust);

          return isMatch && r.jenisTransaksi !== "ORA"
            ? { ...r, kategori: newKat }
            : r;
        })
      );

      // 2. Persist in memory ref and state
      if (normCust) categoryOverridesRef.current[normCust] = newKat;
      if (cleanCust) categoryOverridesRef.current[cleanCust] = newKat;
      if (cleanInv) categoryOverridesRef.current[cleanInv] = newKat;
      setCategoryOverrides((prev) => ({
        ...prev,
        ...(normCust ? { [normCust]: newKat } : {}),
        ...(cleanCust ? { [cleanCust]: newKat } : {}),
        ...(cleanInv ? { [cleanInv]: newKat } : {}),
      }));

      showToast(`✓ Kategori ${cleanCust ? `Apotek "${cleanCust}"` : `faktur ${cleanInv}`} disimpan ke ${newKat}`);

      // 3. Persist to Firestore chunk & category_overrides doc
      try {
        await updateFakturCategory(invoiceKey, newKat, cleanCust);
      } catch (err) {
        console.warn("Update category error:", err);
      }
    },
    []
  );

  // Real-time Firestore Subscription
  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToFakturs(
      (docs, prog, printState, overrides, reason) => {
        if (isUploadingRef.current) return;

        if (prog) setInvoiceProgression(prog);

        if (overrides) {
          setCategoryOverrides(overrides);
          categoryOverridesRef.current = overrides;
        }

        if (printState) {
          const pSet = new Set(printState.printedKeys || []);
          const pMap = printState.printedAtMap || {};
          setPrintedInvoices(pSet);
          setPrintedAtMap(pMap);
        }

        if (reason === "print" || reason === "meta") {
          setLoading(false);
          return;
        }

        if (docs.length > 0) {
          const { records: recs } = dbRowsToFakturRecords(
            docs as unknown as Array<Record<string, unknown>>
          );
          setRecords(recs);
        } else {
          setRecords([]);
          setPrintedInvoices(new Set());
          setPrintedAtMap({});
        }
        setLoading(false);
      },
      (err) => {
        console.error("Firestore sync error:", err);
        setError("Gagal sinkronisasi data dengan database.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleManualRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const { docs, progression: prog, printState, categoryOverrides: overrides } = await getExistingFakturs();
      if (prog) setInvoiceProgression(prog);
      if (overrides) {
        setCategoryOverrides(overrides);
        categoryOverridesRef.current = overrides;
      }
      if (printState) {
        setPrintedInvoices(new Set(printState.printedKeys || []));
        setPrintedAtMap(printState.printedAtMap || {});
      }
      const { records: recs } = dbRowsToFakturRecords(
        docs as unknown as Array<Record<string, unknown>>
      );
      setRecords(recs);
      showToast("✓ Data berhasil diperbarui.");
    } catch (err) {
      console.error("Refresh error:", err);
      setError("Gagal memperbarui data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Toggle Print Status (Immediate Firestore write & real-time sync)
  const togglePrint = useCallback(
    async (group: FakturGroup) => {
      const willBePrinted = !group.allPrinted;
      const targetKey = group.invoiceKey;
      const nowIso = new Date().toISOString();

      // 1. Optimistic Local Update
      setPrintedInvoices((prev) => {
        const next = new Set(prev);
        if (willBePrinted) next.add(targetKey);
        else next.delete(targetKey);
        return next;
      });

      setPrintedAtMap((prev) => {
        const next = { ...prev };
        if (willBePrinted) next[targetKey] = nowIso;
        else delete next[targetKey];
        return next;
      });

      // 2. Firestore Sync
      try {
        await updateFakturPrintStatus(targetKey, willBePrinted, willBePrinted ? nowIso : null);
      } catch (err) {
        console.error("Print toggle sync error:", err);
      }
    },
    []
  );

  // Group items by Invoice Key
  const grouped = useMemo<FakturGroup[]>(() => {
    const map = new Map<string, FakturGroup>();

    for (const r of records) {
      const key = r.invoiceKey || r.invoiceNumber;
      if (!key) continue;

      if (!map.has(key)) {
        const isPrinted = printedInvoices.has(key);
        const pAt = printedAtMap[key] || null;

        map.set(key, {
          key,
          invoiceNumber: r.invoiceNumber,
          invoiceKey: key,
          so: r.orderNumber,
          items: [],
          orderDate: r.orderDate,
          jenisTransaksi: r.jenisTransaksi,
          customerName: r.customerName,
          kategori: r.kategori,
          kategoriProduk: r.kategoriProduk || "FARMA",
          hasPrekursor: false,
          hasOOT: false,
          hasCCP: false,
          hasAlkes: false,
          hasFarma: false,
          isDoubleInv: false,
          totalHarga: 0,
          totalItems: 0,
          allPrinted: isPrinted,
          printedAt: pAt,
        });
      }

      const g = map.get(key)!;
      g.items.push(r);
      g.totalHarga += r.totalHarga;
      g.totalItems += 1;

      if (r.isDoubleInv) g.isDoubleInv = true;

      const kat = (r.kategoriProduk || getProductCategory(r.itemCode, r.itemDescription) || "FARMA").toUpperCase();
      if (kat === "PREKURSOR" || r.klasifikasiObat === "Prekursor") g.hasPrekursor = true;
      if (kat === "OOT" || r.klasifikasiObat === "OOT") g.hasOOT = true;
      if (kat === "CCP") g.hasCCP = true;
      if (kat === "ALKES") g.hasAlkes = true;
      if (kat === "FARMA") g.hasFarma = true;

      if (g.hasCCP) g.kategoriProduk = "CCP";
      else if (g.hasPrekursor) g.kategoriProduk = "PREKURSOR";
      else if (g.hasOOT) g.kategoriProduk = "OOT";
      else if (g.hasAlkes) g.kategoriProduk = "ALKES";
      else g.kategoriProduk = "FARMA";
    }

    return Array.from(map.values()).sort((a, b) => {
      const na = parseInvNum(a.invoiceNumber);
      const nb = parseInvNum(b.invoiceNumber);
      return nb - na; // Descending
    });
  }, [records, printedInvoices, printedAtMap]);

  // Max Invoice KPIs
  const highestInvoices = useMemo(() => {
    let maxOraStr = "-";
    let maxOraNum = -1;
    let max1PDooStr = "-";
    let max1PDooNum = -1;
    let max2PStr = "-";
    let max2PNum = -1;
    let max3PStr = "-";
    let max3PNum = -1;

    for (const g of grouped) {
      const num = parseInvNum(g.invoiceNumber);
      if (num <= 0) continue;

      if (g.jenisTransaksi === "ORA") {
        if (num > maxOraNum) {
          maxOraNum = num;
          maxOraStr = g.invoiceNumber;
        }
      } else {
        if (g.kategori === "1P" && num > max1PDooNum) {
          max1PDooNum = num;
          max1PDooStr = g.invoiceNumber;
        } else if (g.kategori === "2P" && num > max2PNum) {
          max2PNum = num;
          max2PStr = g.invoiceNumber;
        } else if (g.kategori === "3P" && num > max3PNum) {
          max3PNum = num;
          max3PStr = g.invoiceNumber;
        }
      }
    }

    return { maxOraStr, max1PDooStr, max2PStr, max3PStr };
  }, [grouped]);

  // Unique order dates for filter dropdown
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.orderDate && r.orderDate !== "-") set.add(r.orderDate);
    }
    return Array.from(set).sort((a, b) => parseDateMs(b) - parseDateMs(a));
  }, [records]);

  // Filtered Faktur Groups
  const filtered = useMemo(() => {
    if (search.trim()) {
      const s = search.toLowerCase().trim();
      return grouped.filter(
        (g) =>
          g.so.toLowerCase().includes(s) ||
          g.invoiceNumber.toLowerCase().includes(s) ||
          g.customerName.toLowerCase().includes(s) ||
          (g.kategoriProduk && g.kategoriProduk.toLowerCase().includes(s)) ||
          g.items.some(
            (i) =>
              i.itemDescription.toLowerCase().includes(s) ||
              i.itemCode.toLowerCase().includes(s)
          )
      );
    }

    let result = grouped;

    if (filter === "belum") {
      result = result.filter((g) => !g.allPrinted);
    } else if (filter === "sudah") {
      result = result.filter((g) => g.allPrinted);
    } else if (filter === "double") {
      result = result.filter((g) => g.isDoubleInv);
    }

    if (dateFilter !== "all") {
      result = result.filter((g) => g.orderDate === dateFilter);
    }
    if (katFilter !== "all") {
      result = result.filter((g) => g.kategori === katFilter);
    }
    if (jenisFilter !== "all") {
      result = result.filter((g) => g.jenisTransaksi === jenisFilter);
    }
    if (klasFilter === "prekursor") result = result.filter((g) => g.hasPrekursor);
    else if (klasFilter === "oot") result = result.filter((g) => g.hasOOT);
    else if (klasFilter === "ccp") result = result.filter((g) => g.hasCCP);
    else if (klasFilter === "alkes") result = result.filter((g) => g.hasAlkes);
    else if (klasFilter === "farma") result = result.filter((g) => g.hasFarma);

    return result;
  }, [grouped, filter, katFilter, jenisFilter, klasFilter, dateFilter, search]);

  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  const unprintedCountInFiltered = useMemo(() => {
    return filtered.filter((g) => !g.allPrinted).length;
  }, [filtered]);

  // Batch Done Print: Mark All Visible As Printed
  const handleMarkAllPrinted = useCallback(async () => {
    const unprinted = filtered.filter((g) => !g.allPrinted);
    if (unprinted.length === 0) {
      alert("Semua faktur yang sedang tampil sudah selesai dicetak.");
      return;
    }

    if (!confirm(`Tandai ${unprinted.length} faktur yang tampil sebagai SUDAH TERPRINT?`)) return;

    const nowIso = new Date().toISOString();
    const targetKeys = unprinted.map((g) => g.invoiceKey);

    setPrintedInvoices((prev) => {
      const next = new Set(prev);
      targetKeys.forEach((k) => next.add(k));
      return next;
    });

    setPrintedAtMap((prev) => {
      const next = { ...prev };
      targetKeys.forEach((k) => {
        next[k] = nowIso;
      });
      return next;
    });

    try {
      setLoading(true);
      await updateFaktursPrintStatusBatch(targetKeys, true, nowIso);
      showToast(`✓ Berhasil menandai ${targetKeys.length} faktur selesai dicetak!`);
    } catch (err) {
      console.error("Batch print error:", err);
      alert("Terjadi kesalahan saat menyimpan ke database.");
    } finally {
      setLoading(false);
    }
  }, [filtered]);

  // Global Keyboard Navigation & Shortcut Controller
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

      if (e.key === "Escape") {
        if (isInput) (target as HTMLElement).blur();
        if (showApotekModal) setShowApotekModal(false);
        if (showProductModal) setShowProductModal(false);
        return;
      }

      if (isInput) return;

      const maxRow = Math.max(0, pageData.length - 1);
      const currentRow = pageData[selectedRowIndex];

      // Quick Search Focus: '/' or 'f'
      if (e.key === "/" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Space: Toggle Print on active row
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (currentRow) togglePrint(currentRow);
        return;
      }

      // Enter: Toggle Expand Detail on active row
      if (e.key === "Enter") {
        e.preventDefault();
        if (currentRow) toggleExpand(currentRow.key);
        return;
      }

      // Arrow Navigation
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedRowIndex((prev) => Math.min(maxRow, prev + 1));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedRowIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        setSelectedColIdx((prev) => Math.min(10, prev + 1));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "h") {
        e.preventDefault();
        setSelectedColIdx((prev) => Math.max(0, prev - 1));
        return;
      }

      // Page Navigation
      if (e.key === "PageDown") {
        e.preventDefault();
        setPage((p) => Math.min(totalPages - 1, p + 1));
        setSelectedRowIndex(0);
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
        setSelectedRowIndex(0);
        return;
      }

      // Copy Invoice / SO on 'c'
      if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey) {
        if (currentRow) {
          const textToCopy = selectedColIdx === 2 ? currentRow.so : currentRow.invoiceNumber;
          navigator.clipboard.writeText(textToCopy).then(() => {
            showToast(`📋 Disalin ke clipboard: ${textToCopy}`);
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pageData, selectedRowIndex, selectedColIdx, showApotekModal, showProductModal, totalPages, togglePrint]);

  // File Upload Handler
  const handleUpload = useCallback(
    async (filesInput: File[] | FileList | File) => {
      const files: File[] = Array.isArray(filesInput)
        ? filesInput
        : typeof FileList !== "undefined" && filesInput instanceof FileList
        ? Array.from(filesInput)
        : [filesInput as File];

      if (files.length === 0) return;

      isUploadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const parsed: FakturRecord[] = [];
        const fileNames: string[] = [];

        for (const file of files) {
          fileNames.push(file.name);
          const p = await parseExcelFile(file);
          parsed.push(...p);
        }

        if (parsed.length === 0) {
          setError("File berhasil dibaca tetapi tidak memiliki baris data transaksi.");
          setLoading(false);
          return;
        }

        const importedAt = new Date().toISOString();

        // 1. Fetch fresh state from Firestore
        let existingDBDocs: FirestoreFakturDoc[] = [];
        let loadedProgression: InvoiceProgression | null = null;
        let loadedPrintState: { printedKeys: string[]; printedAtMap: Record<string, string> } | null = null;

        try {
          const res = await getExistingFakturs();
          existingDBDocs = res.docs;
          loadedProgression = res.progression;
          loadedPrintState = res.printState;
        } catch (err) {
          console.warn("Could not fetch remote DB:", err);
        }

        const existingDB = existingDBDocs as unknown as Array<Record<string, unknown>>;
        
        // Authoritative live printed keys from both Firestore print_state and active state
        const livePrintedKeys = new Set<string>([
          ...(loadedPrintState?.printedKeys || []),
          ...Array.from(printedInvoices),
        ]);
        const livePrintedAtMap: Record<string, string> = {
          ...(loadedPrintState?.printedAtMap || {}),
          ...printedAtMap,
        };

        const existingStatusMap = new Map<
          string,
          { status_cetak: boolean; printed_at: string | null; no_sales_order: string; extra: Record<string, unknown> }
        >();

        let prevOraNum = -1;
        let prevOraStr = "-";
        let prevDooNum = -1;
        let prevDooStr = "-";
        let prev1PDooNum = -1;
        let prev1PDooStr = "-";
        let prev2PNum = -1;
        let prev2PStr = "-";
        let prev3PNum = -1;
        let prev3PStr = "-";

        existingDB.forEach((row) => {
          const rawInv = String(row.no_faktur || "");
          const cleanInv = rawInv.replace(/-1P$/i, "");
          const extra = (row.extra as Record<string, unknown>) || {};
          const cust = String(extra.nama_pelanggan || row.customer_name || "");
          const isOra = isOraCustomer(cust);
          const num = parseInvNum(cleanInv);
          const kat = isOra ? "1P" : categorize("DOO", cust);

          if (num > 0) {
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
              if (kat === "1P" && num > prev1PDooNum) {
                prev1PDooNum = num;
                prev1PDooStr = cleanInv;
              } else if (kat === "2P" && num > prev2PNum) {
                prev2PNum = num;
                prev2PStr = cleanInv;
              } else if (kat === "3P" && num > prev3PNum) {
                prev3PNum = num;
                prev3PStr = cleanInv;
              }
            }
          }

          const isDocPrinted = Boolean(
            row.status_cetak ||
            livePrintedKeys.has(rawInv) ||
            livePrintedKeys.has(cleanInv) ||
            livePrintedKeys.has(`${cleanInv}-1P`)
          );
          const docPrintedAt =
            livePrintedAtMap[rawInv] ||
            livePrintedAtMap[cleanInv] ||
            livePrintedAtMap[`${cleanInv}-1P`] ||
            (row.printed_at as string) ||
            null;

          const statusInfo = {
            status_cetak: isDocPrinted,
            printed_at: docPrintedAt,
            no_sales_order: String(row.no_sales_order || "-"),
            extra,
          };

          existingStatusMap.set(rawInv, statusInfo);
          existingStatusMap.set(cleanInv, statusInfo);
          existingStatusMap.set(`${cleanInv}-1P`, statusInfo);
        });

        // 2. Pre-populate invMap with existing records
        const invMap = new Map<string, FirestoreFakturDoc>();
        existingDBDocs.forEach((doc) => {
          const k = doc.id || doc.no_faktur;
          const cleanK = k.replace(/-1P$/i, "");
          const isDocPrinted = Boolean(
            doc.status_cetak ||
            livePrintedKeys.has(k) ||
            livePrintedKeys.has(cleanK) ||
            livePrintedKeys.has(`${cleanK}-1P`)
          );
          const docPAt =
            livePrintedAtMap[k] ||
            livePrintedAtMap[cleanK] ||
            livePrintedAtMap[`${cleanK}-1P`] ||
            doc.printed_at ||
            null;

          invMap.set(k, {
            ...doc,
            status_cetak: isDocPrinted,
            printed_at: docPAt,
          });
        });

        const newUnprintedKeys: string[] = [];
        const mergedPrintedSet = new Set(livePrintedKeys);
        const mergedPrintedAtMap = { ...livePrintedAtMap };

        // 3. Merge incoming records
        for (const r of parsed) {
          const isOra = isOraCustomer(r.customerName);
          const cleanInv = String(r.invoiceNumber || "").trim().replace(/-1P$/i, "");
          const num = parseInvNum(cleanInv);
          if (!cleanInv || cleanInv === "-" || cleanInv === "0") continue;

          const targetKey = isOra ? `${cleanInv}-1P` : cleanInv;
          const prevInfo = existingStatusMap.get(targetKey) || existingStatusMap.get(cleanInv);

          let isPrinted = false;
          let printedAt: string | null = null;

          if (prevInfo !== undefined) {
            // Already in database: preserve existing user print status!
            isPrinted = Boolean(
              prevInfo.status_cetak ||
              mergedPrintedSet.has(targetKey) ||
              mergedPrintedSet.has(cleanInv) ||
              mergedPrintedSet.has(`${cleanInv}-1P`)
            );
            printedAt = isPrinted
              ? (mergedPrintedAtMap[targetKey] || mergedPrintedAtMap[cleanInv] || mergedPrintedAtMap[`${cleanInv}-1P`] || prevInfo.printed_at || new Date().toISOString())
              : null;

            if (isPrinted) {
              mergedPrintedSet.add(targetKey);
              if (printedAt) mergedPrintedAtMap[targetKey] = printedAt;
            } else {
              newUnprintedKeys.push(targetKey);
            }
          } else {
            // Brand new invoice
            const isHistorical = num > 0 && (
              (isOra && prevOraNum > 0 && num <= prevOraNum) ||
              (!isOra && prevDooNum > 0 && num <= prevDooNum)
            );
            if (isHistorical) {
              isPrinted = true;
              printedAt = null;
              mergedPrintedSet.add(targetKey);
            } else {
              isPrinted = false;
              printedAt = null;
              newUnprintedKeys.push(targetKey);
              mergedPrintedSet.delete(targetKey);
              delete mergedPrintedAtMap[targetKey];
            }
          }

          const rawCust = String(r.customerName || "-").trim();
          const normCust = rawCust ? normalize(rawCust) : "";
          const overriddenKat =
            categoryOverridesRef.current[normCust] ||
            categoryOverridesRef.current[rawCust] ||
            categoryOverridesRef.current[cleanInv] ||
            (prevInfo && (prevInfo.extra?.kategori as ("1P" | "2P" | "3P") | undefined));

          if (!invMap.has(targetKey)) {
            const kategori = isOra
              ? "1P"
              : (overriddenKat || r.kategori || categorize("DOO", r.customerName));
            invMap.set(targetKey, {
              id: targetKey,
              no_faktur: targetKey,
              no_sales_order: r.orderNumber || "-",
              customer_name: r.customerName || "-",
              order_date: r.orderDate || "-",
              jenis_transaksi: isOra ? "ORA" : "DOO",
              kategori,
              status_cetak: isPrinted,
              printed_at: printedAt,
              imported_at: importedAt,
              source_file: isOra ? "ORA" : "DOO",
              extra: {
                nama_pelanggan: r.customerName,
                order_date: r.orderDate,
                accounting_date: r.orderDate,
                jenis_transaksi: isOra ? "ORA" : "DOO",
                kategori,
                total_harga: r.totalHarga || 0,
                items: [],
              },
            });
          }

          const entry = invMap.get(targetKey)!;
          entry.status_cetak = isPrinted;
          entry.printed_at = printedAt;

          if (overriddenKat && !isOra) {
            entry.kategori = overriddenKat;
            if (entry.extra) entry.extra.kategori = overriddenKat;
          }

          if (isOra && r.orderNumber && r.orderNumber !== "-") {
            entry.no_sales_order = r.orderNumber;
          } else if (!isOra && (entry.no_sales_order === "-" || !entry.no_sales_order) && r.orderNumber) {
            entry.no_sales_order = r.orderNumber;
          }

          const currentCust = String(entry.customer_name || "");
          const incomingCust = String(r.customerName || "");
          if (
            (currentCust.includes("HELIOS") || currentCust === "1001" || currentCust === "-") &&
            incomingCust && !incomingCust.includes("HELIOS") && incomingCust !== "1001"
          ) {
            entry.customer_name = incomingCust;
            entry.extra.nama_pelanggan = incomingCust;
          }

          if (r.itemCode && r.itemCode !== "-") {
            if (!Array.isArray(entry.extra.items)) entry.extra.items = [];
            const katProd = getProductCategory(r.itemCode, r.itemDescription) || r.kategoriProduk || "FARMA";
            const isDup = entry.extra.items.some(
              (it) => it.item_code === r.itemCode && it.lot_number === r.lotNumber && it.qty === r.qty
            );
            if (!isDup) {
              entry.extra.items.push({
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

        const payload = Array.from(invMap.values());

        // 4. Calculate Progression Ranges
        let minOra = Infinity; let maxOra = -1; let maxOraStr = "-"; let minOraStr = "-";
        let minDoo = Infinity; let maxDoo = -1; let maxDooStr = "-"; let minDooStr = "-";
        let min1PDoo = Infinity; let max1PDoo = -1; let max1PDooStr = "-"; let min1PDooStr = "-";
        let min2P = Infinity; let max2P = -1; let max2PStr = "-"; let min2PStr = "-";
        let min3P = Infinity; let max3P = -1; let max3PStr = "-"; let min3PStr = "-";

        for (const r of parsed) {
          const isOra = isOraCustomer(r.customerName);
          const cleanInv = String(r.invoiceNumber || "").trim().replace(/-1P$/i, "");
          const num = parseInvNum(cleanInv);
          const kat = isOra ? "1P" : (r.kategori || categorize("DOO", r.customerName));

          if (num > 0) {
            if (isOra) {
              if (num > maxOra) { maxOra = num; maxOraStr = cleanInv; }
              if (num < minOra) { minOra = num; minOraStr = cleanInv; }
            } else {
              if (num > maxDoo) { maxDoo = num; maxDooStr = cleanInv; }
              if (num < minDoo) { minDoo = num; minDooStr = cleanInv; }

              if (kat === "1P") {
                if (num > max1PDoo) { max1PDoo = num; max1PDooStr = cleanInv; }
                if (num < min1PDoo) { min1PDoo = num; min1PDooStr = cleanInv; }
              } else if (kat === "2P") {
                if (num > max2P) { max2P = num; max2PStr = cleanInv; }
                if (num < min2P) { min2P = num; min2PStr = cleanInv; }
              } else if (kat === "3P") {
                if (num > max3P) { max3P = num; max3PStr = cleanInv; }
                if (num < min3P) { min3P = num; min3PStr = cleanInv; }
              }
            }
          }
        }

        const existingProg: InvoiceProgression = loadedProgression || {};
        let rangeOra = existingProg.rangeOra || null;
        let prevOra = existingProg.prevOra || null;
        let newOra = existingProg.newOra || null;
        if (maxOra > 0) {
          newOra = maxOraStr;
          if (prevOraNum > 0 && maxOra > prevOraNum) {
            prevOra = prevOraStr;
            rangeOra = `${prevOraNum + 1} ➔ ${maxOraStr}`;
          } else {
            prevOra = prevOraStr !== "-" ? prevOraStr : maxOraStr;
            rangeOra = minOraStr !== maxOraStr ? `${minOraStr} ➔ ${maxOraStr}` : maxOraStr;
          }
        }

        let rangeDoo = existingProg.rangeDoo || null;
        let prevDoo = existingProg.prevDoo || null;
        let newDoo = existingProg.newDoo || null;
        if (maxDoo > 0) {
          newDoo = maxDooStr;
          if (prevDooNum > 0 && maxDoo > prevDooNum) {
            prevDoo = prevDooStr;
            rangeDoo = `${prevDooNum + 1} ➔ ${maxDooStr}`;
          } else {
            prevDoo = prevDooStr !== "-" ? prevDooStr : maxDooStr;
            rangeDoo = minDooStr !== maxDooStr ? `${minDooStr} ➔ ${maxDooStr}` : maxDooStr;
          }
        }

        let range1PDoo = existingProg.range1PDoo || null;
        let prev1PDoo = existingProg.prev1PDoo || null;
        let new1PDoo = existingProg.new1PDoo || null;
        if (max1PDoo > 0) {
          new1PDoo = max1PDooStr;
          if (prev1PDooNum > 0 && max1PDoo > prev1PDooNum) {
            prev1PDoo = prev1PDooStr;
            range1PDoo = `${prev1PDooNum + 1} ➔ ${max1PDooStr}`;
          } else {
            prev1PDoo = prev1PDooStr !== "-" ? prev1PDooStr : max1PDooStr;
            range1PDoo = min1PDooStr !== max1PDooStr ? `${min1PDooStr} ➔ ${max1PDooStr}` : max1PDooStr;
          }
        }

        let range2P = existingProg.range2P || null;
        let prev2P = existingProg.prev2P || null;
        let new2P = existingProg.new2P || null;
        if (max2P > 0) {
          new2P = max2PStr;
          if (prev2PNum > 0 && max2P > prev2PNum) {
            prev2P = prev2PStr;
            range2P = `${prev2PNum + 1} ➔ ${max2PStr}`;
          } else {
            prev2P = prev2PStr !== "-" ? prev2PStr : max2PStr;
            range2P = min2PStr !== max2PStr ? `${min2PStr} ➔ ${max2PStr}` : max2PStr;
          }
        }

        let range3P = existingProg.range3P || null;
        let prev3P = existingProg.prev3P || null;
        let new3P = existingProg.new3P || null;
        if (max3P > 0) {
          new3P = max3PStr;
          if (prev3PNum > 0 && max3P > prev3PNum) {
            prev3P = prev3PStr;
            range3P = `${prev3PNum + 1} ➔ ${max3PStr}`;
          } else {
            prev3P = prev3PStr !== "-" ? prev3PStr : max3PStr;
            range3P = min3PStr !== max3PStr ? `${min3PStr} ➔ ${max3PStr}` : max3PStr;
          }
        }

        const progObj: InvoiceProgression = {
          ...existingProg,
          prev1PDoo,
          new1PDoo,
          range1PDoo,
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

        // 5. Update Local State Instantly (< 1 second response)
        const { records: localRecs } = dbRowsToFakturRecords(
          payload as unknown as Array<Record<string, unknown>>
        );

        setRecords(localRecs);
        setPrintedInvoices(mergedPrintedSet);
        setPrintedAtMap(mergedPrintedAtMap);
        setInvoiceProgression(progObj);

        setUploadNotification({
          fileName: fileNames.join(", "),
          prevOra,
          maxOra: maxOraStr,
          rangeOra,
          prevDoo,
          maxDoo: maxDooStr,
          rangeDoo,
          totalItems: parsed.length,
          totalInvoices: invMap.size,
          newUnprinted: newUnprintedKeys.length,
          time: new Date().toLocaleTimeString("id-ID"),
        });

        setPage(0);
        setLoading(false);
        showToast(`✓ Berhasil mengupload ${parsed.length} baris data!`);

        // 6. Save to Firestore in background with high concurrency
        saveFaktursBatch(
          payload,
          progObj,
          {
            printedKeys: Array.from(mergedPrintedSet),
            printedAtMap: mergedPrintedAtMap,
            updatedAt: new Date().toISOString(),
          },
          newUnprintedKeys
        ).catch((err) => {
          console.error("Background Firestore save error:", err);
        }).finally(() => {
          isUploadingRef.current = false;
        });
      } catch (err) {
        console.error("Upload error:", err);
        setError(err instanceof Error ? err.message : "Gagal memproses file upload.");
        isUploadingRef.current = false;
        setLoading(false);
      }
    },
    []
  );

  // Clear / Reset All Data
  const handleClearAll = async () => {
    if (!confirm("⚠️ YAKIN INGIN MENGHAPUS SEMUA DATA?\n\nSemua data faktur dan riwayat status cetak di database cloud akan direset seperti semula.")) {
      return;
    }

    setLoading(true);
    try {
      await clearAllFakturs();
      setRecords([]);
      setPrintedInvoices(new Set());
      setPrintedAtMap({});
      setInvoiceProgression(null);
      setUploadNotification(null);
      setExpandedInvoices(new Set());
      setPage(0);
      showToast("✓ Seluruh data berhasil direset.");
    } catch (err) {
      console.error("Clear error:", err);
      alert("Gagal mereset data di database.");
    } finally {
      setLoading(false);
    }
  };

  // Export to Excel (Ascending order)
  const handleExportExcel = () => {
    if (filtered.length === 0) {
      alert("Tidak ada data faktur untuk diekspor.");
      return;
    }

    const sortedForExport = [...filtered].sort((a, b) => {
      const na = parseInvNum(a.invoiceNumber);
      const nb = parseInvNum(b.invoiceNumber);
      return na - nb; // Ascending
    });

    const rows = sortedForExport.map((g, idx) => ({
      No: idx + 1,
      "No SO": g.so,
      "No Invoice": g.invoiceNumber,
      "Kat Produk": g.kategoriProduk,
      "Jenis Transaksi": g.jenisTransaksi,
      Pelanggan: g.customerName,
      "Tanggal Order": g.orderDate,
      Kategori: g.kategori,
      "Status Cetak": g.allPrinted ? "Sudah Terprint" : "Belum Terprint",
      "Waktu Cetak": g.allPrinted && g.printedAt ? formatPrintTime(g.printedAt) : "-",
      "Total Harga": g.totalHarga,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Faktur Tracker");
    XLSX.writeFile(wb, `Faktur_Tracker_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const toggleExpand = (key: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="text-emerald-400 font-bold">✓</span>
          <span className="text-sm font-medium">{toastMsg}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-5">
        {/* Top Header Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/20 text-lg">
              🖨️
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                Faktur Tracker
                <span className="text-xs px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                  v2.0
                </span>
              </h1>
              <p className="text-xs text-slate-500">
                Sistem Pelacak Status Cetak Faktur Farmasi Oracle ERP
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Upload File Button */}
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length > 0) handleUpload(files);
              }}
              className={`cursor-pointer px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs ${
                dragOver
                  ? "bg-blue-100 text-blue-700 border-2 border-dashed border-blue-500"
                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20"
              }`}
            >
              <span>📤</span>
              <span>Upload Export (.xls / .xlsx)</span>
              <input
                type="file"
                multiple
                accept=".xls,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length > 0) handleUpload(files);
                  e.target.value = "";
                }}
              />
            </label>

            {/* Refresh Button */}
            <button
              onClick={handleManualRefresh}
              disabled={loading}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
              title="Refresh Data dari Server"
            >
              <span className={loading ? "animate-spin" : ""}>🔄</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Master Apotek Button */}
            <button
              onClick={() => setShowApotekModal(true)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
              title="Lihat Database Master Apotek (1P / 2P / 3P)"
            >
              <span>🏢</span>
              <span className="hidden sm:inline">Master Apotek</span>
            </button>

            {/* Master Produk Button */}
            <button
              onClick={() => setShowProductModal(true)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
              title="Lihat Database Master Produk (Farma / Alkes / Prekursor / OOT / CCP)"
            >
              <span>💊</span>
              <span className="hidden sm:inline">Master Produk</span>
            </button>

            {/* Export Excel Button */}
            <button
              onClick={handleExportExcel}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
              title="Ekspor Data ke Excel (Ascending)"
            >
              <span>📥</span>
              <span className="hidden sm:inline">Ekspor Excel</span>
            </button>

            {/* Reset / Hapus Semua Data Button */}
            <button
              onClick={handleClearAll}
              className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
              title="Hapus Semua Data & Reset Database"
            >
              <span className="text-rose-600">🗑️</span>
              <span className="hidden sm:inline">Reset Data</span>
            </button>
          </div>
        </div>

        {/* Upload Notification Banner */}
        {uploadNotification && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 flex items-start justify-between gap-3 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="text-xl">📋</span>
              <div className="space-y-1">
                <div className="font-bold flex items-center gap-2">
                  <span>File Berhasil Diunggah: <span className="underline">{uploadNotification.fileName}</span></span>
                  <span className="text-[10px] bg-blue-200/80 px-2 py-0.5 rounded-full font-semibold">{uploadNotification.time}</span>
                </div>
                <div className="text-blue-800/90 flex flex-wrap gap-x-4 gap-y-1">
                  {uploadNotification.rangeOra && (
                    <span>• <strong>ORA</strong>: {uploadNotification.rangeOra}</span>
                  )}
                  {uploadNotification.rangeDoo && (
                    <span>• <strong>DOO</strong>: {uploadNotification.rangeDoo}</span>
                  )}
                  <span>• Total Baru: <strong>{uploadNotification.newUnprinted} faktur belum dicetak</strong></span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setUploadNotification(null)}
              className="text-blue-400 hover:text-blue-700 p-1 rounded-lg"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-medium">
              <span className="text-rose-600">⚠️</span>
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-700">
              ✕
            </button>
          </div>
        )}

        {/* 8 Metric KPI Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Card 1: Total SO */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">Total SO</span>
              <span className="text-xs">📄</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900 font-mono">
              {new Set(grouped.map((g) => g.so).filter((s) => s && s !== "-")).size}
            </div>
          </div>

          {/* Card 2: Belum Terprint */}
          <div className="bg-white border border-amber-200 rounded-xl p-3.5 shadow-xs bg-gradient-to-br from-amber-50/50 to-white">
            <div className="flex items-center justify-between text-amber-700 mb-1">
              <span className="text-xs font-bold">Belum Terprint</span>
              <span className="text-xs">⏱️</span>
            </div>
            <div className="text-xl font-extrabold text-amber-800 font-mono">
              {grouped.filter((g) => !g.allPrinted).length}
            </div>
          </div>

          {/* Card 3: 1P ORA */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">1P ORA (Max)</span>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-bold">ORA</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {highestInvoices.maxOraStr}
            </div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {invoiceProgression?.rangeOra ? `Rentang: ${invoiceProgression.rangeOra}` : "Belum ada upload"}
            </div>
          </div>

          {/* Card 4: 2P */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">2P (Max)</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-bold">2P</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {highestInvoices.max2PStr}
            </div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {invoiceProgression?.range2P ? `Rentang: ${invoiceProgression.range2P}` : "Belum ada upload"}
            </div>
          </div>

          {/* Card 5: Total Invoice */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">Total Faktur</span>
              <span className="text-xs">📑</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900 font-mono">
              {grouped.length}
            </div>
          </div>

          {/* Card 6: Double Invoice */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">Double INV</span>
              <span className="text-xs text-rose-500 font-bold">⚠️</span>
            </div>
            <div className="text-xl font-extrabold text-rose-600 font-mono">
              {grouped.filter((g) => g.isDoubleInv).length}
            </div>
          </div>

          {/* Card 7: 1P DOO */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">1P DOO (Max)</span>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-bold">1P DOO</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {highestInvoices.max1PDooStr}
            </div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {invoiceProgression?.range1PDoo ? `Rentang: ${invoiceProgression.range1PDoo}` : "Belum ada upload"}
            </div>
          </div>

          {/* Card 8: 3P */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-semibold">3P (Max)</span>
              <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded font-bold">3P</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {highestInvoices.max3PStr}
            </div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {invoiceProgression?.range3P ? `Rentang: ${invoiceProgression.range3P}` : "Belum ada upload"}
            </div>
          </div>
        </div>

        {/* Filter and Search Bar Section */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
          {/* Top Row Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Status Filter Tabs */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => { setFilter("belum"); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filter === "belum"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Belum Terprint ({grouped.filter((g) => !g.allPrinted).length})
              </button>
              <button
                onClick={() => { setFilter("sudah"); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filter === "sudah"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Sudah Terprint ({grouped.filter((g) => g.allPrinted).length})
              </button>
              <button
                onClick={() => { setFilter("all"); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filter === "all"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Semua ({grouped.length})
              </button>
              <button
                onClick={() => { setFilter("double"); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filter === "double"
                    ? "bg-white text-rose-700 shadow-xs"
                    : "text-rose-600 hover:text-rose-800"
                }`}
              >
                Double INV ({grouped.filter((g) => g.isDoubleInv).length})
              </button>
            </div>

            {/* Batch Done Print Button */}
            {unprintedCountInFiltered > 0 && (
              <button
                onClick={handleMarkAllPrinted}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <span>✓</span>
                <span>Tandai Semua Selesai ({unprintedCountInFiltered})</span>
              </button>
            )}
          </div>

          {/* Secondary Dropdown Filters & Search */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100">
            {/* Global Search Input */}
            <div className="relative md:col-span-1">
              <span className="absolute left-3 top-2.5 text-xs text-slate-400">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Cari SO / Invoice / Obat... (Tekan '/' atau 'f')"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            {/* Kategori Filter */}
            <select
              value={katFilter}
              onChange={(e) => { setKatFilter(e.target.value as KatFilter); setPage(0); }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500"
            >
              <option value="all">Semua Kategori (1P/2P/3P)</option>
              <option value="1P">1P</option>
              <option value="2P">2P</option>
              <option value="3P">3P</option>
            </select>

            {/* Jenis Transaksi Filter */}
            <select
              value={jenisFilter}
              onChange={(e) => { setJenisFilter(e.target.value as JenisFilter); setPage(0); }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500"
            >
              <option value="all">Semua Jenis (ORA/DOO)</option>
              <option value="ORA">ORA</option>
              <option value="DOO">DOO</option>
            </select>

            {/* Kategori Produk Filter */}
            <select
              value={klasFilter}
              onChange={(e) => { setKlasFilter(e.target.value as KlasFilter); setPage(0); }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500"
            >
              <option value="all">Semua Produk</option>
              <option value="prekursor">Prekursor</option>
              <option value="oot">OOT</option>
              <option value="ccp">CCP (Cold Chain)</option>
              <option value="alkes">Alkes</option>
              <option value="farma">Farma</option>
            </select>

            {/* Filter Tanggal */}
            <select
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); setPage(0); }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500"
            >
              <option value="all">Semua Tanggal</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Faktur Table Card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="px-3 py-2.5 w-8 text-center">#</th>
                  <th className="px-3 py-2.5 w-12 text-center">Print</th>
                  <th className="px-3 py-2.5">No SO</th>
                  <th className="px-3 py-2.5">No Invoice</th>
                  <th className="px-3 py-2.5">Kat Produk</th>
                  <th className="px-3 py-2.5">Jenis</th>
                  <th className="px-3 py-2.5">Pelanggan</th>
                  <th className="px-3 py-2.5">Order Date</th>
                  <th className="px-3 py-2.5">Kat</th>
                  <th className="px-3 py-2.5">Done Print (Waktu)</th>
                  <th className="px-3 py-2.5 text-right">Total Harga</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-12 text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-2xl animate-spin">🔄</span>
                        <span className="text-xs font-medium">Memuat data faktur...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-12 text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-3xl">📄</span>
                        <span className="text-xs font-medium">Tidak ada faktur yang sesuai filter.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pageData.map((g, rowIdx) => {
                    const isExpanded = expandedInvoices.has(g.key);
                    const isRowSelected = selectedRowIndex === rowIdx;
                    const getCellCls = (colIdx: number) =>
                      isRowSelected && selectedColIdx === colIdx
                        ? "ring-2 ring-blue-600 ring-inset bg-blue-100/90 font-semibold"
                        : "";

                    const onSelectCell = (colIdx: number) => {
                      setSelectedRowIndex(rowIdx);
                      setSelectedColIdx(colIdx);
                    };

                    return (
                      <Fragment key={g.key}>
                        <tr
                          onClick={() => {
                            setSelectedRowIndex(rowIdx);
                            toggleExpand(g.key);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isRowSelected
                              ? "bg-blue-50/90 border-l-4 border-l-blue-600 shadow-xs"
                              : g.isDoubleInv
                              ? "bg-rose-50/70 hover:bg-rose-100/70"
                              : g.allPrinted
                              ? "bg-emerald-50/40 hover:bg-emerald-100/50"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          {/* Col 0: Expand */}
                          <td
                            className={`px-3 py-2 text-center text-slate-400 ${getCellCls(0)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(0);
                              toggleExpand(g.key);
                            }}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </td>

                          {/* Col 1: Print Checkbox */}
                          <td
                            className={`px-3 py-2 text-center ${getCellCls(1)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(1);
                              togglePrint(g);
                            }}
                          >
                            <button
                              type="button"
                              className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold transition-all shadow-xs ${
                                g.allPrinted
                                  ? "bg-emerald-600 text-white hover:bg-orange-500"
                                  : "bg-slate-200 text-slate-600 hover:bg-emerald-500 hover:text-white"
                              }`}
                              title={g.allPrinted ? "Klik untuk UNPRINT" : "Klik untuk TANDAI PRINT"}
                            >
                              {g.allPrinted ? "✓" : "○"}
                            </button>
                          </td>

                          {/* Col 2: No SO */}
                          <td
                            className={`px-3 py-2 font-mono font-medium text-slate-900 whitespace-nowrap ${getCellCls(2)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(2);
                            }}
                          >
                            <div className="flex items-center gap-1">
                              <span>{g.so}</span>
                              {g.isDoubleInv && (
                                <span className="text-rose-600 font-bold" title="Double Invoice Detected">⚠</span>
                              )}
                            </div>
                          </td>

                          {/* Col 3: No Invoice */}
                          <td
                            className={`px-3 py-2 font-mono font-bold text-blue-700 whitespace-nowrap ${getCellCls(3)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(3);
                            }}
                          >
                            {g.invoiceNumber}
                          </td>

                          {/* Col 4: Kat Produk */}
                          <td
                            className={`px-3 py-2 whitespace-nowrap ${getCellCls(4)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(4);
                            }}
                          >
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                                g.kategoriProduk === "ALKES"
                                  ? "bg-teal-50 text-teal-800 border-teal-200"
                                  : g.kategoriProduk === "CCP"
                                  ? "bg-sky-50 text-sky-800 border-sky-200"
                                  : g.kategoriProduk === "PREKURSOR"
                                  ? "bg-amber-50 text-amber-900 border-amber-200"
                                  : g.kategoriProduk === "OOT"
                                  ? "bg-purple-50 text-purple-900 border-purple-200"
                                  : "bg-indigo-50 text-indigo-700 border-indigo-200"
                              }`}
                            >
                              {g.kategoriProduk}
                            </span>
                          </td>

                          {/* Col 5: Jenis */}
                          <td
                            className={`px-3 py-2 whitespace-nowrap ${getCellCls(5)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(5);
                            }}
                          >
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              g.jenisTransaksi === "ORA"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}>
                              {g.jenisTransaksi}
                            </span>
                          </td>

                          {/* Col 6: Pelanggan */}
                          <td
                            className={`px-3 py-2 text-slate-700 max-w-xs truncate font-medium ${getCellCls(6)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(6);
                            }}
                          >
                            {g.customerName}
                          </td>

                          {/* Col 7: Order Date */}
                          <td
                            className={`px-3 py-2 text-slate-500 whitespace-nowrap ${getCellCls(7)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(7);
                            }}
                          >
                            {g.orderDate}
                          </td>

                          {/* Col 8: Kat (Editable Dropdown) */}
                          <td
                            className={`px-3 py-2 whitespace-nowrap ${getCellCls(8)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(8);
                            }}
                          >
                            <select
                              value={g.kategori}
                              onChange={(e) => {
                                handleUpdateCategory(g.invoiceKey, e.target.value as "1P" | "2P" | "3P", g.customerName);
                              }}
                              className={`cursor-pointer px-2 py-0.5 rounded text-[11px] font-bold border border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none transition-colors ${
                                g.kategori === "1P"
                                  ? "bg-blue-100 text-blue-700"
                                  : g.kategori === "2P"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-purple-100 text-purple-700"
                              }`}
                              title="Klik untuk ubah Kategori (1P / 2P / 3P)"
                            >
                              <option value="1P">1P</option>
                              <option value="2P">2P</option>
                              <option value="3P">3P</option>
                            </select>
                          </td>

                          {/* Col 9: Done Print Waktu */}
                          <td
                            className={`px-3 py-2 whitespace-nowrap font-mono text-[11px] ${getCellCls(9)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(9);
                            }}
                          >
                            {g.allPrinted && g.printedAt ? (
                              <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                ⏱ {formatPrintTime(g.printedAt)}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>

                          {/* Col 10: Total Harga */}
                          <td
                            className={`px-3 py-2 text-right font-medium text-slate-900 whitespace-nowrap ${getCellCls(10)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(10);
                            }}
                          >
                            {formatRupiah(g.totalHarga)}
                          </td>
                        </tr>

                        {/* Expanded Detail Rows */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80 border-b border-slate-200">
                            <td colSpan={11} className="p-4">
                              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 text-xs">
                                  <div className="text-slate-600">
                                    <span className="font-semibold text-slate-900">Rincian Obat (Invoice: {g.invoiceNumber})</span> · SO: <span className="font-mono text-slate-900">{g.so}</span> · Pelanggan: <span className="font-semibold text-slate-900">{g.customerName}</span>
                                    {g.allPrinted && g.printedAt && (
                                      <span className="ml-3 inline-flex items-center gap-1 font-semibold text-emerald-700">
                                        <span>⏱ Selesai Print:</span>
                                        <span className="font-mono">{formatPrintTime(g.printedAt)}</span>
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePrint(g);
                                    }}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                                      g.allPrinted
                                        ? "bg-orange-100 text-orange-800 hover:bg-orange-200"
                                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                                    }`}
                                  >
                                    {g.allPrinted ? "↩ Batalkan Print" : "✓ Tandai Selesai Print"}
                                  </button>
                                </div>

                                <table className="w-full text-xs text-left">
                                  <thead>
                                    <tr className="text-slate-500 border-b border-slate-100 font-semibold">
                                      <th className="py-1.5 px-2">Item Code</th>
                                      <th className="py-1.5 px-2">Kat</th>
                                      <th className="py-1.5 px-2">Item Description</th>
                                      <th className="py-1.5 px-2 text-right">Qty</th>
                                      <th className="py-1.5 px-2">UOM</th>
                                      <th className="py-1.5 px-2">LOT Number</th>
                                      <th className="py-1.5 px-2 text-right">Total Harga</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {g.items.map((it, idx) => (
                                      <tr key={idx} className="hover:bg-slate-50">
                                        <td className="py-1.5 px-2 font-mono text-slate-600">{it.itemCode}</td>
                                        <td className="py-1.5 px-2">
                                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700">
                                            {it.kategoriProduk || "FARMA"}
                                          </span>
                                        </td>
                                        <td className="py-1.5 px-2 text-slate-800 font-medium">{it.itemDescription}</td>
                                        <td className="py-1.5 px-2 text-right font-mono font-semibold text-slate-900">{it.qty}</td>
                                        <td className="py-1.5 px-2 text-slate-500">{it.uom}</td>
                                        <td className="py-1.5 px-2 font-mono text-slate-600">{it.lotNumber}</td>
                                        <td className="py-1.5 px-2 text-right font-medium text-slate-900">{formatRupiah(it.totalHarga)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {totalPages > 1 && (
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Halaman <strong>{page + 1}</strong> dari <strong>{totalPages}</strong> ({filtered.length} total faktur)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-50"
                >
                  Sebelumnya
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-50"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Master Modals */}
      <MasterApotekModal
        isOpen={showApotekModal}
        onClose={() => setShowApotekModal(false)}
        categoryOverrides={categoryOverrides}
      />
      <MasterProductModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
      />
    </div>
  );
}
